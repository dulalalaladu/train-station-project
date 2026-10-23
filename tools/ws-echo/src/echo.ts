// Pure echo logic for the T-005 audio spike (plan §6.2 binary frame, §6.2 JSON frames).
// Frame layout: [channel:u8][flags:u8][seq:u16 big-endian][PCM16LE 16 kHz payload].
import { z } from 'zod';

export const HEADER_BYTES = 4;
export const CHANNEL_ASR = 1;
export const CHANNEL_TALK = 2;

/** Re-label an uplink ASR frame (channel 1) as a downlink talk frame (channel 2). */
export function echoBinary(frame: Uint8Array): Uint8Array | null {
  if (frame.length < HEADER_BYTES) return null;
  if (frame[0] !== CHANNEL_ASR) return null;
  if ((frame.length - HEADER_BYTES) % 2 !== 0) return null;
  const out = Uint8Array.from(frame);
  out[0] = CHANNEL_TALK;
  return out;
}

const textMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), ts: z.number() }),
  z.object({ type: z.literal('cmd.submit'), command_id: z.string().min(1), ts: z.number() }),
]);

function errorReply(message: string): string {
  return JSON.stringify({ type: 'error', code: 'BAD_MESSAGE', message });
}

/** Answer one JSON text frame; always returns a JSON string (errors become `error` frames). */
export function replyToText(raw: string, nowMs: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorReply('invalid JSON');
  }
  const result = textMessage.safeParse(parsed);
  if (!result.success) return errorReply('unsupported or malformed message');
  const msg = result.data;
  if (msg.type === 'ping') {
    return JSON.stringify({ type: 'pong', ts: msg.ts, server_ts: nowMs });
  }
  return JSON.stringify({
    type: 'cmd.state',
    command_id: msg.command_id,
    state: 'received',
    ts: nowMs,
    echo_ts: msg.ts,
  });
}

const impairmentSettings = z.object({
  delayMs: z.number().min(0).default(0),
  jitterMs: z.number().min(0).default(0),
  dropPct: z.number().min(0).max(100).default(0),
});

export type ImpairmentInput = z.input<typeof impairmentSettings>;
export interface ImpairmentPlan {
  readonly drop: boolean;
  readonly delayMs: number;
}

/** Network impairment for the audio echo path only (lets the jitter buffer be tuned on a LAN). */
export function createImpairment(input: ImpairmentInput, random: () => number) {
  const { delayMs, jitterMs, dropPct } = impairmentSettings.parse(input);
  return {
    plan(): ImpairmentPlan {
      if (dropPct > 0 && random() * 100 < dropPct) return { drop: true, delayMs: 0 };
      return { drop: false, delayMs: delayMs + random() * jitterMs };
    },
  };
}
