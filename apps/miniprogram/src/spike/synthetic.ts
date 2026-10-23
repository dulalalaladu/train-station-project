// Stand-in recorder for environments without a microphone (WeChat developer tool, automated runs).
// Emits a 440 Hz tone for `toneMs`, then silence for `pauseMs`, repeating, at the same frame size
// and cadence a real RecorderManager would use, so the gate / echo / playback path is exercised.
import { SAMPLE_RATE, sineFrame } from './pcm';
import type { RecorderHandlers, RecorderPort, TimerPort } from './ports';

export interface SyntheticOptions {
  readonly toneMs?: number;
  readonly pauseMs?: number;
}

const BYTES_PER_SAMPLE = 2;
const AMPLITUDE = 0.4;
const TONE_HZ = 440;

export function createSyntheticRecorder(
  timers: TimerPort,
  options: SyntheticOptions = {},
): RecorderPort {
  const toneMs = options.toneMs ?? 3000;
  const pauseMs = options.pauseMs ?? 1000;
  let cancel: (() => void) | undefined;

  return {
    start(frameSizeKb: number, handlers: RecorderHandlers): void {
      cancel?.();
      const samples = (frameSizeKb * 1024) / BYTES_PER_SAMPLE;
      const frameMs = (samples * 1000) / SAMPLE_RATE;
      let index = 0;
      cancel = timers.every(frameMs, () => {
        const phaseMs = (index * frameMs) % (toneMs + pauseMs);
        const frame =
          phaseMs < toneMs
            ? sineFrame({
                samples,
                freqHz: TONE_HZ,
                amplitude: AMPLITUDE,
                startSample: index * samples,
              })
            : new Int16Array(samples);
        index += 1;
        handlers.onFrame(frame.buffer as ArrayBuffer);
      });
    },
    stop(): void {
      cancel?.();
      cancel = undefined;
    },
  };
}
