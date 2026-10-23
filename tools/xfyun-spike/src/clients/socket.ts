import WebSocket, { type RawData } from 'ws';
import { HandshakeError, SessionTimeoutError } from '../errors.ts';

export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const SESSION_TIMEOUT_MS = 90_000;

/**
 * Opens a WebSocket. A non-101 upgrade response (401 bad signature, 403 clock
 * skew / no quota, ...) becomes a HandshakeError. The URL carries the signature
 * and is never logged or put into error messages.
 */
export function openSocket(url: string, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    bufferEarlyMessages(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').slice(0, 300);
        reject(new HandshakeError(res.statusCode ?? 0, body));
        ws.terminate();
      });
    });
  });
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

/** Promise that rejects with SessionTimeoutError unless settled within `ms`. */
export function deferredWithTimeout<T>(what: string, ms: number): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new SessionTimeoutError(what, ms)), ms);
  const clear = () => clearTimeout(timer);
  promise.then(clear, clear);
  return { promise, resolve, reject };
}

export function sendIfOpen(ws: WebSocket, data: string | Buffer): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
}



type MessageHandler = (data: RawData, isBinary: boolean) => void;

interface EarlyBuffer {
  readonly queue: Array<[RawData, boolean]>;
  handler: MessageHandler | undefined;
}

const earlyBuffers = new WeakMap<WebSocket, EarlyBuffer>();

/**
 * Servers may send a frame right after the upgrade (RTASR `started`) before the
 * caller has attached a listener. Queue those messages until onMessage() runs.
 */
function bufferEarlyMessages(ws: WebSocket): void {
  const buffer: EarlyBuffer = { queue: [], handler: undefined };
  earlyBuffers.set(ws, buffer);
  ws.on('message', (data, isBinary) => {
    if (buffer.handler) buffer.handler(data, isBinary);
    else buffer.queue.push([data, isBinary]);
  });
}

/** Registers the single message handler and replays anything received so far. */
export function onMessage(ws: WebSocket, handler: MessageHandler): void {
  const buffer = earlyBuffers.get(ws);
  if (!buffer) throw new Error('socket was not opened via openSocket');
  buffer.handler = handler;
  for (const [data, isBinary] of buffer.queue.splice(0)) handler(data, isBinary);
}
