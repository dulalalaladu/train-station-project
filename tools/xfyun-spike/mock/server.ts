import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { handleIat, newSession, type ReceivedSession, type Scenario } from './iat-handler.ts';
import { handleRtasr } from './rtasr-handler.ts';
import { verifyIatHandshake, verifyRtasrHandshake, type AuthFailure } from './verify.ts';

export interface MockServerOptions {
  readonly scenario?: Scenario;
  readonly port?: number;
  readonly now?: () => Date;
}

export interface MockXfyun {
  /** ws://127.0.0.1:<port> — append /v1 (IAT) or /ast/communicate/v1 (RTASR). */
  readonly baseUrl: string;
  readonly sessions: readonly ReceivedSession[];
  close(): Promise<void>;
}

const IAT_PATH = '/v1';
const RTASR_PATH = '/ast/communicate/v1';

function reject(socket: Duplex, failure: AuthFailure): void {
  socket.write(`HTTP/1.1 ${failure.status} Rejected\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${failure.reason}`);
  socket.destroy();
}

function authFailure(req: IncomingMessage, now: Date): AuthFailure | undefined {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === IAT_PATH) return verifyIatHandshake(req, now);
  if (path === RTASR_PATH) return verifyRtasrHandshake(req);
  return { status: 404, reason: 'unknown path' };
}

/** Local replay server for the three interfaces; verifies signatures like the vendor would. */
export async function startMockXfyun(opts: MockServerOptions = {}): Promise<MockXfyun> {
  const scenario = opts.scenario ?? 'ok';
  const now = opts.now ?? (() => new Date());
  const sessions: ReceivedSession[] = [];
  const wss = new WebSocketServer({ noServer: true });
  const http: Server = createServer((_req, res) => res.writeHead(426).end());
  http.on('upgrade', (req, socket, head) => {
    const failure = authFailure(req, now());
    if (failure) return reject(socket, failure);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = newSession(req);
      sessions.push(session);
      if (session.path === IAT_PATH) handleIat(ws, session, scenario);
      else handleRtasr(ws, session, scenario);
    });
  });
  await new Promise<void>((resolve) => http.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `ws://127.0.0.1:${port}`,
    sessions,
    close: () => closeAll(wss, http),
  };
}

async function closeAll(wss: WebSocketServer, http: Server): Promise<void> {
  for (const client of wss.clients) client.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => http.close(() => resolve()));
}
