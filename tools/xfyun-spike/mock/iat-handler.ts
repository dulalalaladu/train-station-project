import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { FRAME_BYTES } from '../src/audio/pcm.ts';

export interface ReceivedFrame {
  readonly status: number;
  readonly bytes: number;
  readonly atMs: number;
}

export interface ReceivedSession {
  readonly path: string;
  readonly frames: ReceivedFrame[];
  /** Parsed parameter.iat of the first IAT frame, or the handshake query of RTASR. */
  params: Record<string, unknown>;
  headerResId: string | undefined;
  ended: boolean;
  violations: string[];
}

export type Scenario = 'ok' | 'api-error';

interface ScriptedSegment {
  readonly sn: number;
  readonly text: string;
  readonly pgs: 'apd' | 'rpl';
  readonly rg?: readonly [number, number];
}

const ZH_SCRIPT: readonly ScriptedSegment[] = [
  { sn: 1, text: '今天', pgs: 'apd' },
  { sn: 2, text: '天气', pgs: 'apd' },
  { sn: 3, text: '今天天气', pgs: 'rpl', rg: [1, 2] },
  { sn: 4, text: '很好', pgs: 'apd' },
];
const EN_SCRIPT: readonly ScriptedSegment[] = [
  { sn: 1, text: 'return', pgs: 'apd' },
  { sn: 2, text: 'to', pgs: 'apd' },
  { sn: 3, text: 'return to', pgs: 'rpl', rg: [1, 2] },
  { sn: 4, text: ' base', pgs: 'apd' },
];

const FRAMES_PER_RESULT = 5;
export const MOCK_ERROR_CODE = 10163;

export function newSession(req: IncomingMessage): ReceivedSession {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  return { path, frames: [], params: {}, headerResId: undefined, ended: false, violations: [] };
}

function encodeSegment(seg: ScriptedSegment): string {
  const body = {
    sn: seg.sn,
    ls: false,
    pgs: seg.pgs,
    ...(seg.rg ? { rg: seg.rg } : {}),
    ws: [{ bg: 0, cw: [{ w: seg.text }] }],
  };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

function reply(ws: WebSocket, status: 1 | 2, seg: ScriptedSegment, code = 0): void {
  ws.send(
    JSON.stringify({
      header: { code, message: code === 0 ? 'success' : 'mock error', sid: 'mock-sid', status },
      payload: { result: { encoding: 'utf8', compress: 'raw', format: 'json', seq: seg.sn, status, text: encodeSegment(seg) } },
    }),
  );
}

interface IatFrame {
  header: { status: number; res_id?: string };
  parameter?: { iat?: Record<string, unknown> };
  payload: { audio: { audio: string; seq: number } };
}

function recordFrame(session: ReceivedSession, frame: IatFrame, t0: number): void {
  const bytes = Buffer.from(frame.payload.audio.audio, 'base64').length;
  if (bytes > FRAME_BYTES) session.violations.push(`frame of ${bytes} B exceeds ${FRAME_BYTES}`);
  if (session.frames.length === 0 && frame.header.status !== 0) session.violations.push('first frame status != 0');
  session.frames.push({ status: frame.header.status, bytes, atMs: performance.now() - t0 });
}

/** Wires up one IAT (slm / multilingual) connection: audio in, scripted wpgs results out. */
export function handleIat(ws: WebSocket, session: ReceivedSession, scenario: Scenario): void {
  const t0 = performance.now();
  let script: readonly ScriptedSegment[] = ZH_SCRIPT;
  let sent = 0;
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as IatFrame;
    if (frame.parameter?.iat) {
      session.params = frame.parameter.iat;
      session.headerResId = frame.header.res_id;
      script = String(frame.parameter.iat['language']).startsWith('en') ? EN_SCRIPT : ZH_SCRIPT;
    }
    recordFrame(session, frame, t0);
    if (scenario === 'api-error') return failIat(ws);
    if (frame.header.status === 2) return finishIat(ws, script, sent);
    if (session.frames.length % FRAMES_PER_RESULT === 0 && sent < script.length - 1) {
      reply(ws, 1, script[sent] as ScriptedSegment);
      sent += 1;
    }
  });
}

function failIat(ws: WebSocket): void {
  reply(ws, 2, ZH_SCRIPT[0] as ScriptedSegment, MOCK_ERROR_CODE);
  ws.close(1000);
}

function finishIat(ws: WebSocket, script: readonly ScriptedSegment[], sent: number): void {
  for (let i = sent; i < script.length - 1; i += 1) reply(ws, 1, script[i] as ScriptedSegment);
  reply(ws, 2, script[script.length - 1] as ScriptedSegment);
  ws.close(1000);
}
