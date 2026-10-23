import type WebSocket from 'ws';
import { buildRtasrUrl } from '../auth/rtasr-auth.ts';
import { chunkPcm, realPacer, sendPaced, toRawPcm, type Pacer } from '../audio/pcm.ts';
import type { RtasrCredentials } from '../config.ts';
import { XfyunApiError } from '../errors.ts';
import {
  RTASR_END_MESSAGE,
  mergeRtasr,
  parseRtasrMessage,
  rtasrText,
} from '../protocol/rtasr-frames.ts';
import {
  HANDSHAKE_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
  deferredWithTimeout,
  openSocket,
  onMessage,
  sendIfOpen,
  type Deferred,
} from './socket.ts';

export interface RtasrRunOptions {
  readonly endpoint: string;
  readonly credentials: RtasrCredentials;
  readonly audio: Buffer;
  /** eng_vad_mdn: 1 far field / 2 near field. */
  readonly vadMode?: 1 | 2;
  readonly pacer?: Pacer;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export interface RtasrResult {
  readonly text: string;
  readonly sessionId: string | undefined;
  readonly segmentCount: number;
  /** First non-empty text, measured from the first audio frame sent. */
  readonly firstResultMs: number | undefined;
  /** Stream close after `{"end":true}`, measured from the end message. */
  readonly finalMs: number;
}

interface Marks {
  firstSent: number;
  endSent: number;
  firstText: number | undefined;
}

/** Handshake params: lang=autodialect, pcm_s16le @ 16 kHz, eng_vad_mdn (plan §4.4.1). */
function handshakeParams(vadMode: 1 | 2): Record<string, string> {
  return {
    lang: 'autodialect',
    audio_encode: 'pcm_s16le',
    samplerate: '16000',
    eng_vad_mdn: String(vadMode),
  };
}

export async function runRtasrSession(opts: RtasrRunOptions): Promise<RtasrResult> {
  const timeoutMs = opts.timeoutMs ?? SESSION_TIMEOUT_MS;
  const pacer = opts.pacer ?? realPacer;
  const url = buildRtasrUrl({
    endpoint: opts.endpoint,
    appId: opts.credentials.appId,
    accessKeyId: opts.credentials.accessKeyId,
    accessKeySecret: opts.credentials.accessKeySecret,
    now: (opts.now ?? (() => new Date()))(),
    params: handshakeParams(opts.vadMode ?? 1),
  });
  const ws = await openSocket(url, Math.min(timeoutMs, HANDSHAKE_TIMEOUT_MS));
  const marks: Marks = { firstSent: 0, endSent: 0, firstText: undefined };
  const done = collectRtasr(ws, marks, pacer, timeoutMs);
  const frames = chunkPcm(toRawPcm(opts.audio));
  const sending = sendPaced(
    frames,
    (frame, i, isLast) => {
      if (i === 0) marks.firstSent = pacer.now();
      sendIfOpen(ws, frame);
      if (isLast) {
        sendIfOpen(ws, RTASR_END_MESSAGE);
        marks.endSent = pacer.now();
      }
    },
    pacer,
  );
  try {
    const [, result] = await Promise.all([sending, done.promise]);
    return result;
  } finally {
    ws.terminate();
  }
}

function collectRtasr(
  ws: WebSocket,
  marks: Marks,
  pacer: Pacer,
  timeoutMs: number,
): Deferred<RtasrResult> {
  const done = deferredWithTimeout<RtasrResult>('RTASR stream close', timeoutMs);
  let state: ReadonlyMap<number, string> = new Map();
  let sessionId: string | undefined;
  onMessage(ws, (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = parseRtasrMessage(data.toString());
      if (msg.kind === 'started') sessionId = msg.sessionId;
      if (msg.kind === 'error') done.reject(new XfyunApiError(msg.code, msg.message, sessionId));
      if (msg.kind === 'result') {
        state = mergeRtasr(state, msg);
        if (marks.firstText === undefined && msg.text) marks.firstText = pacer.now();
      }
    } catch (err) {
      done.reject(err);
    }
  });
  ws.on('error', done.reject);
  ws.on('close', () => {
    if (marks.endSent === 0) return done.reject(new Error('socket closed before end of audio'));
    done.resolve({
      text: rtasrText(state),
      sessionId,
      segmentCount: state.size,
      firstResultMs: marks.firstText === undefined ? undefined : marks.firstText - marks.firstSent,
      finalMs: pacer.now() - marks.endSent,
    });
  });
  return done;
}


