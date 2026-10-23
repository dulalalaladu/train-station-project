import { DEFAULT_GATE, type GateConfig } from './pcm';

export const FRAME_SIZES_KB = [1, 2, 4, 8] as const;
export type FrameSizeKb = (typeof FRAME_SIZES_KB)[number];

export interface SpikeConfig {
  /** ws:// for the local echo server (developer tool / debug build), wss:// for a real gateway. */
  readonly url: string;
  /** RecorderManager frameSize, in KB (2 KB ≈ 64 ms of 16 kHz mono PCM16). */
  readonly frameSizeKb: FrameSizeKb;
  /** Playback jitter buffer; plan §3.4 targets 120～200 ms. */
  readonly jitterMs: number;
  /** Drop silent frames locally instead of uploading them. */
  readonly silenceGate: boolean;
  readonly gate: GateConfig;
  readonly heartbeatMs: number;
  /** Cadence of the simulated cmd.submit while audio flows (0 disables). */
  readonly cmdIntervalMs: number;
}

export const DEFAULT_CONFIG: SpikeConfig = {
  url: 'ws://127.0.0.1:8787',
  frameSizeKb: 2,
  jitterMs: 160,
  silenceGate: true,
  gate: DEFAULT_GATE,
  heartbeatMs: 15000,
  cmdIntervalMs: 2000,
};

const MAX_JITTER_MS = 500;

function fail(field: string, why: string): never {
  throw new RangeError(`${field}: ${why}`);
}

function pickUrl(raw: unknown, fallback: string): string {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^wss?:\/\/\S+$/.test(raw)) {
    return fail('url', 'must be a ws:// or wss:// address');
  }
  return raw;
}

function pickFrameSize(raw: unknown, fallback: FrameSizeKb): FrameSizeKb {
  if (raw === undefined) return fallback;
  const match = FRAME_SIZES_KB.find((kb) => kb === raw);
  return match ?? fail('frameSizeKb', `must be one of ${FRAME_SIZES_KB.join('/')}`);
}

function pickNumber(
  field: string,
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    return fail(field, `must be a number in ${min}..${max}`);
  }
  return raw;
}

function pickGate(raw: unknown): GateConfig {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    threshold: pickNumber('gate.threshold', src['threshold'], DEFAULT_GATE.threshold, 0, 1),
    hangoverFrames: pickNumber(
      'gate.hangoverFrames',
      src['hangoverFrames'],
      DEFAULT_GATE.hangoverFrames,
      0,
      100,
    ),
  };
}

/** Validate untrusted page input into a complete config; throws RangeError naming the bad field. */
export function parseSpikeConfig(input: unknown): SpikeConfig {
  if (typeof input !== 'object' || input === null) throw new TypeError('config must be an object');
  const src = input as Record<string, unknown>;
  return {
    url: pickUrl(src['url'], DEFAULT_CONFIG.url),
    frameSizeKb: pickFrameSize(src['frameSizeKb'], DEFAULT_CONFIG.frameSizeKb),
    jitterMs: pickNumber('jitterMs', src['jitterMs'], DEFAULT_CONFIG.jitterMs, 0, MAX_JITTER_MS),
    silenceGate:
      typeof src['silenceGate'] === 'boolean' ? src['silenceGate'] : DEFAULT_CONFIG.silenceGate,
    gate: pickGate(src['gate']),
    heartbeatMs: pickNumber(
      'heartbeatMs',
      src['heartbeatMs'],
      DEFAULT_CONFIG.heartbeatMs,
      1000,
      120000,
    ),
    cmdIntervalMs: pickNumber(
      'cmdIntervalMs',
      src['cmdIntervalMs'],
      DEFAULT_CONFIG.cmdIntervalMs,
      0,
      60000,
    ),
  };
}
