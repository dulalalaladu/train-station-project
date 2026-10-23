import { z } from 'zod';

export type RtasrMessage =
  | { readonly kind: 'started'; readonly sessionId: string | undefined }
  | { readonly kind: 'result'; readonly segId: number; readonly final: boolean; readonly text: string }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }
  | { readonly kind: 'unknown' };

/**
 * ⚠️ The large-model RTASR response layout is assumed from the vendor demo
 * (msg_type action/result, data.cn.st.rt[].ws[].cw[].w, st.type 0 = final, 1 = interim).
 * Re-check against a real key; the parser is deliberately tolerant.
 */
const wordSchema = z.object({ w: z.string() });
const stSchema = z.object({
  type: z.union([z.string(), z.number()]).optional(),
  rt: z.array(z.object({ ws: z.array(z.object({ cw: z.array(wordSchema).default([]) })).default([]) })).default([]),
});
const envelopeSchema = z.object({
  msg_type: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  desc: z.string().optional(),
  data: z.unknown().optional(),
});

function resultText(st: z.infer<typeof stSchema>): string {
  return st.rt.flatMap((r) => r.ws.map((w) => w.cw[0]?.w ?? '')).join('');
}

function parseData(data: unknown): RtasrMessage {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d['action'] === 'started') {
    return { kind: 'started', sessionId: typeof d['sessionId'] === 'string' ? d['sessionId'] : undefined };
  }
  if (d['action'] === 'error') {
    return { kind: 'error', code: String(d['code'] ?? 'unknown'), message: String(d['desc'] ?? '') };
  }
  const st = stSchema.safeParse((d['cn'] as { st?: unknown } | undefined)?.st);
  if (!st.success) return { kind: 'unknown' };
  return {
    kind: 'result',
    segId: typeof d['seg_id'] === 'number' ? d['seg_id'] : 0,
    final: String(st.data.type) === '0',
    text: resultText(st.data),
  };
}

export function parseRtasrMessage(raw: string): RtasrMessage {
  const env = envelopeSchema.parse(JSON.parse(raw));
  if (env.code !== undefined && String(env.code) !== '0') {
    return { kind: 'error', code: String(env.code), message: env.desc ?? '' };
  }
  return parseData(env.data);
}

export const RTASR_END_MESSAGE = JSON.stringify({ end: true });

/** Latest text per seg_id; later messages for the same segment replace earlier ones. */
export function mergeRtasr(
  state: ReadonlyMap<number, string>,
  msg: Extract<RtasrMessage, { kind: 'result' }>,
): ReadonlyMap<number, string> {
  return new Map([...state, [msg.segId, msg.text]]);
}

export function rtasrText(state: ReadonlyMap<number, string>): string {
  return [...state.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join('');
}
