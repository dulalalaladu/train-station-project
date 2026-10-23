// PCM helpers: level metering, the local silence gate, and conversion for WebAudio playback.

export const SAMPLE_RATE = 16000;

/** Root-mean-square level of a PCM16 frame, normalised to 0..1 of full scale. */
export function rmsLevel(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const sample of pcm) sum += sample * sample;
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** PCM16 to the Float32 range WebAudio expects. */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) out[i] = (pcm[i] ?? 0) / 32768;
  return out;
}

export function pcmDurationSec(sampleCount: number, sampleRate: number): number {
  return sampleCount / sampleRate;
}

export interface GateConfig {
  /** RMS (0..1) above which a frame counts as speech. */
  readonly threshold: number;
  /** Frames still sent after the last loud frame, so word tails are not clipped. */
  readonly hangoverFrames: number;
}

export interface GateState {
  readonly open: boolean;
  /** Consecutive quiet frames since the gate opened. */
  readonly quiet: number;
}

export interface GateStep {
  readonly send: boolean;
  /** True on the single frame where the gate closes (caller sends an end-of-stream marker). */
  readonly endOfSpeech: boolean;
  readonly state: GateState;
}

export const DEFAULT_GATE: GateConfig = { threshold: 0.01, hangoverFrames: 4 };

export function initialGate(): GateState {
  return { open: false, quiet: 0 };
}

/** One step of the energy gate. Pure: returns the next state instead of mutating. */
export function stepGate(state: GateState, level: number, cfg: GateConfig): GateStep {
  if (level >= cfg.threshold) {
    return { send: true, endOfSpeech: false, state: { open: true, quiet: 0 } };
  }
  if (!state.open) return { send: false, endOfSpeech: false, state };
  const quiet = state.quiet + 1;
  if (quiet >= cfg.hangoverFrames) {
    return { send: true, endOfSpeech: true, state: initialGate() };
  }
  return { send: true, endOfSpeech: false, state: { open: true, quiet } };
}

export interface SineSpec {
  readonly samples: number;
  readonly freqHz: number;
  /** 0..1 of full scale. */
  readonly amplitude: number;
  /** Index of the first sample, so consecutive frames stay phase-continuous. */
  readonly startSample?: number;
}

/** Synthetic tone, used where the recorder is unavailable (developer tool, automated runs). */
export function sineFrame(spec: SineSpec): Int16Array {
  const start = spec.startSample ?? 0;
  const out = new Int16Array(spec.samples);
  for (let i = 0; i < spec.samples; i += 1) {
    const t = (start + i) / SAMPLE_RATE;
    out[i] = Math.round(Math.sin(2 * Math.PI * spec.freqHz * t) * spec.amplitude * 32767);
  }
  return out;
}
