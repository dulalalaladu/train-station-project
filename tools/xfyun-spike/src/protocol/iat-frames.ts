import { z } from 'zod';
import type { IatSegment } from '../merger/wpgs-merger.ts';

export interface IatParameters {
  readonly domain: string;
  readonly language: string;
  readonly accent: string;
  /** Silence timeout in ms. */
  readonly eos?: number;
  readonly dwa?: 'wpgs';
  /** 1 no filter / 2 Chinese only / 3 English only (slm interface). */
  readonly ltc?: 1 | 2 | 3;
  /** Session hot words: `utf-8;词1|词2`, <= 1024 bytes. */
  readonly dhw?: string;
}

export interface IatStartOptions {
  readonly appId: string;
  readonly resId?: string;
  readonly parameters: IatParameters;
}

const MAX_DHW_BYTES = 1024;

export function buildDhw(words: readonly string[]): string {
  const dhw = `utf-8;${words.join('|')}`;
  if (Buffer.byteLength(dhw, 'utf8') > MAX_DHW_BYTES) {
    throw new Error(`dhw exceeds ${MAX_DHW_BYTES} bytes`);
  }
  return dhw;
}

function audioBlock(seq: number, status: 0 | 1 | 2, frame: Buffer) {
  return {
    encoding: 'raw',
    sample_rate: 16000,
    channels: 1,
    bit_depth: 16,
    seq,
    status,
    audio: frame.toString('base64'),
  };
}

/** First frame (status 0) carries app_id, res_id, parameter.iat and the first audio chunk. */
export function buildFirstFrame(opts: IatStartOptions, frame: Buffer): string {
  const header: Record<string, unknown> = { app_id: opts.appId, status: 0 };
  if (opts.resId) header['res_id'] = opts.resId;
  const iat = {
    ...opts.parameters,
    result: { encoding: 'utf8', compress: 'raw', format: 'json' },
  };
  return JSON.stringify({ header, parameter: { iat }, payload: { audio: audioBlock(1, 0, frame) } });
}

export function buildMiddleFrame(appId: string, seq: number, frame: Buffer): string {
  return JSON.stringify({
    header: { app_id: appId, status: 1 },
    payload: { audio: audioBlock(seq, 1, frame) },
  });
}

/** Last frame (status 2) closes the stream; the audio field is empty. */
export function buildLastFrame(appId: string, seq: number): string {
  return JSON.stringify({
    header: { app_id: appId, status: 2 },
    payload: { audio: audioBlock(seq, 2, Buffer.alloc(0)) },
  });
}

const decodedSchema = z.object({
  sn: z.number(),
  ls: z.boolean().optional(),
  pgs: z.enum(['apd', 'rpl']).optional(),
  rg: z.tuple([z.number(), z.number()]).optional(),
  ws: z.array(z.object({ cw: z.array(z.object({ w: z.string() })).default([]) })).default([]),
});

/** Decodes the base64 JSON blob into a segment; text is the first candidate of every word. */
export function decodeResultText(base64: string): IatSegment {
  const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as unknown;
  const d = decodedSchema.parse(json);
  const text = d.ws.map((w) => w.cw[0]?.w ?? '').join('');
  return {
    sn: d.sn,
    text,
    ...(d.pgs ? { pgs: d.pgs } : {}),
    ...(d.rg ? { rg: d.rg } : {}),
    ...(d.ls !== undefined ? { ls: d.ls } : {}),
  };
}

const responseSchema = z.object({
  header: z.object({
    code: z.number(),
    message: z.string().default(''),
    sid: z.string().optional(),
    status: z.number().optional(),
  }),
  payload: z.object({ result: z.object({ text: z.string().default('') }).optional() }).optional(),
});

export interface IatResponse {
  readonly code: number;
  readonly message: string;
  readonly sid: string | undefined;
  /** header.status: 0 start / 1 middle / 2 end. */
  readonly status: number | undefined;
  readonly segment: IatSegment | undefined;
}

export function parseIatResponse(raw: string): IatResponse {
  const r = responseSchema.parse(JSON.parse(raw));
  const text = r.payload?.result?.text;
  return {
    code: r.header.code,
    message: r.header.message,
    sid: r.header.sid,
    status: r.header.status,
    segment: text ? decodeResultText(text) : undefined,
  };
}
