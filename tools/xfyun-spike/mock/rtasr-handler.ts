import type { WebSocket } from 'ws';
import { FRAME_BYTES } from '../src/audio/pcm.ts';
import type { ReceivedSession, Scenario } from './iat-handler.ts';
import { MOCK_ERROR_CODE } from './iat-handler.ts';

const FRAMES_PER_INTERIM = 10;

function resultMessage(segId: number, text: string, final: boolean): string {
  return JSON.stringify({
    msg_type: 'result',
    res_type: 'asr',
    data: {
      seg_id: segId,
      cn: { st: { type: final ? '0' : '1', rt: [{ ws: [{ cw: [{ w: text }] }] }] } },
    },
  });
}

/** One RTASR connection: `started` on open, interim every 10 frames, final + close on {"end":true}. */
export function handleRtasr(ws: WebSocket, session: ReceivedSession, scenario: Scenario): void {
  const t0 = performance.now();
  ws.send(JSON.stringify({ msg_type: 'action', data: { action: 'started', sessionId: 'mock-session' } }));
  ws.on('message', (raw, isBinary) => {
    if (!isBinary) return onText(ws, session, raw.toString());
    if (scenario === 'api-error') return failRtasr(ws);
    const bytes = (raw as Buffer).length;
    if (bytes > FRAME_BYTES) session.violations.push(`frame of ${bytes} B exceeds ${FRAME_BYTES}`);
    session.frames.push({ status: 1, bytes, atMs: performance.now() - t0 });
    if (session.frames.length % FRAMES_PER_INTERIM === 0) ws.send(resultMessage(0, '停下', false));
  });
}

function onText(ws: WebSocket, session: ReceivedSession, text: string): void {
  const msg = JSON.parse(text) as { end?: boolean };
  if (!msg.end) return;
  session.ended = true;
  ws.send(resultMessage(0, '停下', true));
  ws.send(resultMessage(1, '回巢', true));
  ws.close(1000);
}

function failRtasr(ws: WebSocket): void {
  ws.send(JSON.stringify({ msg_type: 'action', data: { action: 'error', code: String(MOCK_ERROR_CODE), desc: 'mock error' } }));
  ws.close(1000);
}
