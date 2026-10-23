import type WebSocket from 'ws';
import { buildIatAuthUrl } from '../auth/iat-auth.ts';
import { chunkPcm, realPacer, sendPaced, toRawPcm, type Pacer } from '../audio/pcm.ts';
import type { IatCredentials } from '../config.ts';
import { XfyunApiError } from '../errors.ts';
import { applySegment, emptyMergeState, mergedText, type MergeState } from '../merger/wpgs-merger.ts';
import {
  buildFirstFrame,
  buildLastFrame,
  buildMiddleFrame,
  parseIatResponse,
  type IatParameters,
} from '../protocol/iat-frames.ts';
import { HANDSHAKE_TIMEOUT_MS, SESSION_TIMEOUT_MS, deferredWithTimeout, openSocket, onMessage, sendIfOpen, type Deferred } from './socket.ts';

export interface IatRunOptions {
  readonly endpoint: string;
  readonly credentials: IatCredentials;
  readonly parameters: IatParameters;
  readonly resId?: string;
  /** Raw 16 kHz/16 bit/mono PCM, or a WAV file in that format. */
  readonly audio: Buffer;
  readonly pacer?: Pacer;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export interface RecognitionResult {
  readonly text: string;
  readonly sid: string | undefined;
  readonly resultCount: number;
  /** First non-empty text, measured from the first audio frame sent (首字延迟). */
  readonly firstResultMs: number | undefined;
  /** Final (header.status 2) arrival, measured from the last frame sent (最终延迟). */
  readonly finalMs: number;
}

interface Marks {
  firstSent: number;
  lastSent: number;
  firstText: number | undefined;
}

/** Runs one recognition session against an IAT-style endpoint (slm or multilingual). */
export async function runIatSession(opts: IatRunOptions): Promise<RecognitionResult> {
  const timeoutMs = opts.timeoutMs ?? SESSION_TIMEOUT_MS;
  const pacer = opts.pacer ?? realPacer;
  const url = buildIatAuthUrl({
    endpoint: opts.endpoint,
    apiKey: opts.credentials.apiKey,
    apiSecret: opts.credentials.apiSecret,
    now: (opts.now ?? (() => new Date()))(),
  });
  const ws = await openSocket(url, Math.min(timeoutMs, HANDSHAKE_TIMEOUT_MS));
  const marks: Marks = { firstSent: 0, lastSent: 0, firstText: undefined };
  const done = collectIat(ws, marks, pacer, timeoutMs);
  const sending = streamAudio(ws, opts, marks, pacer);
  try {
    const [, result] = await Promise.all([sending, done.promise]);
    return result;
  } finally {
    ws.terminate();
  }
}

async function streamAudio(
  ws: WebSocket,
  opts: IatRunOptions,
  marks: Marks,
  pacer: Pacer,
): Promise<void> {
  const frames = chunkPcm(toRawPcm(opts.audio));
  const appId = opts.credentials.appId;
  const start = { appId, resId: opts.resId, parameters: opts.parameters };
  await sendPaced(
    frames,
    (frame, i, isLast) => {
      if (i === 0) marks.firstSent = pacer.now();
      sendIfOpen(ws, i === 0 ? buildFirstFrame(start, frame) : buildMiddleFrame(appId, i + 1, frame));
      if (isLast) {
        sendIfOpen(ws, buildLastFrame(appId, frames.length + 1));
        marks.lastSent = pacer.now();
      }
    },
    pacer,
  );
}

function collectIat(
  ws: WebSocket,
  marks: Marks,
  pacer: Pacer,
  timeoutMs: number,
): Deferred<RecognitionResult> {
  const done = deferredWithTimeout<RecognitionResult>('final IAT result', timeoutMs);
  let state: MergeState = emptyMergeState;
  let count = 0;
  onMessage(ws, (data) => {
    try {
      const res = parseIatResponse(data.toString());
      if (res.code !== 0) throw new XfyunApiError(res.code, res.message, res.sid);
      if (res.segment) {
        state = applySegment(state, res.segment);
        count += 1;
        if (marks.firstText === undefined && res.segment.text) marks.firstText = pacer.now();
      }
      if (res.status === 2) done.resolve(toResult(state, count, marks, res.sid, pacer));
    } catch (err) {
      done.reject(err);
    }
  });
  ws.on('error', done.reject);
  ws.on('close', () => done.reject(new Error('socket closed before final IAT result')));
  return done;
}

function toResult(
  state: MergeState,
  count: number,
  marks: Marks,
  sid: string | undefined,
  pacer: Pacer,
): RecognitionResult {
  return {
    text: mergedText(state),
    sid,
    resultCount: count,
    firstResultMs: marks.firstText === undefined ? undefined : marks.firstText - marks.firstSent,
    finalMs: pacer.now() - marks.lastSent,
  };
}


