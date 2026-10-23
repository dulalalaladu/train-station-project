import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { createImpairment, echoBinary, replyToText, type ImpairmentInput } from './echo.ts';

export interface EchoServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly impairment?: ImpairmentInput;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface EchoServer {
  readonly port: number;
  close(): Promise<void>;
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data);
}

/** Delayed sender that remembers its timers so close() can cancel them. */
function createDelayedSender() {
  const pending = new Set<NodeJS.Timeout>();
  return {
    send(socket: WebSocket, bytes: Uint8Array, delayMs: number): void {
      const deliver = (): void => {
        if (socket.readyState === socket.OPEN) socket.send(bytes, { binary: true });
      };
      if (delayMs <= 0) return deliver();
      const timer = setTimeout(() => {
        pending.delete(timer);
        deliver();
      }, delayMs);
      pending.add(timer);
    },
    cancelAll(): void {
      pending.forEach(clearTimeout);
      pending.clear();
    },
  };
}

function createMessageHandler(
  options: EchoServerOptions,
  sender: ReturnType<typeof createDelayedSender>,
) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const impairment = createImpairment(options.impairment ?? {}, options.random ?? Math.random);
  return (socket: WebSocket, data: RawData, isBinary: boolean): void => {
    if (!isBinary) {
      socket.send(replyToText(data.toString(), now()));
      return;
    }
    const echoed = echoBinary(toBytes(data));
    if (echoed === null) {
      log('dropped malformed or non-ASR binary frame');
      return;
    }
    const plan = impairment.plan();
    if (!plan.drop) sender.send(socket, echoed, plan.delayMs);
  };
}

/** Start the echo server; resolves once it is listening (port 0 picks a free port). */
export function startEchoServer(options: EchoServerOptions): Promise<EchoServer> {
  const log = options.log ?? (() => undefined);
  const sender = createDelayedSender();
  const onMessage = createMessageHandler(options, sender);
  const host = options.host ?? '0.0.0.0';

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port, host });
    wss.once('error', reject);
    wss.on('connection', (socket, request) => {
      log(`client connected from ${request.socket.remoteAddress ?? 'unknown'}`);
      socket.on('message', (data, isBinary) => onMessage(socket, data, isBinary));
      socket.on('close', () => log('client disconnected'));
    });
    wss.once('listening', () => {
      const address = wss.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      log(`ws-echo listening on ${host}:${port}`);
      const close = (): Promise<void> =>
        new Promise((done) => {
          sender.cancelAll();
          wss.clients.forEach((client) => client.terminate());
          wss.close(() => done());
        });
      resolve({ port, close });
    });
  });
}
