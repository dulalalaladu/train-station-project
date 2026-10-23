export const FRAME_BYTES = 1280; // 40 ms of 16 kHz / 16 bit / mono PCM
export const FRAME_INTERVAL_MS = 40;
export const SAMPLE_RATE = 16_000;
export const BYTES_PER_MS = 32;

/** Splits PCM into 1280 B frames; the last frame may be shorter. Never returns zero frames. */
export function chunkPcm(pcm: Buffer, frameBytes = FRAME_BYTES): readonly Buffer[] {
  if (pcm.length === 0) return [Buffer.alloc(0)];
  const frames: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    frames.push(pcm.subarray(offset, offset + frameBytes));
  }
  return frames;
}

export function pcmDurationMs(pcm: Buffer): number {
  return pcm.length / BYTES_PER_MS;
}

/**
 * Returns raw PCM from either a bare .pcm buffer or a RIFF/WAVE file.
 * WAV input must already be 16 kHz / 16 bit / mono; no resampling here.
 */
export function toRawPcm(input: Buffer): Buffer {
  if (input.length < 12 || input.toString('ascii', 0, 4) !== 'RIFF') return input;
  let offset = 12;
  let formatOk = false;
  while (offset + 8 <= input.length) {
    const id = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      assertFormat(input, body);
      formatOk = true;
    } else if (id === 'data') {
      if (!formatOk) throw new Error('WAV data chunk before fmt chunk');
      return input.subarray(body, Math.min(body + size, input.length));
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}

function assertFormat(wav: Buffer, body: number): void {
  const tag = wav.readUInt16LE(body);
  const channels = wav.readUInt16LE(body + 2);
  const rate = wav.readUInt32LE(body + 4);
  const bits = wav.readUInt16LE(body + 14);
  if (tag !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
    throw new Error(
      `WAV must be PCM 16 kHz/16 bit/mono, got tag=${tag} ch=${channels} rate=${rate} bits=${bits}`,
    );
  }
}

export interface Pacer {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const realPacer: Pacer = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Sends frames at a constant 40 ms cadence. Each frame is scheduled against the
 * start time (not the previous send) so timer jitter does not accumulate.
 * The vendor rejects audio that is sent faster than real time (plan §7.2 item 1).
 */
export async function sendPaced(
  frames: readonly Buffer[],
  send: (frame: Buffer, index: number, isLast: boolean) => void,
  pacer: Pacer = realPacer,
  intervalMs = FRAME_INTERVAL_MS,
): Promise<void> {
  const start = pacer.now();
  for (let i = 0; i < frames.length; i += 1) {
    const wait = start + i * intervalMs - pacer.now();
    if (wait > 0) await pacer.sleep(wait);
    send(frames[i] as Buffer, i, i === frames.length - 1);
  }
}
