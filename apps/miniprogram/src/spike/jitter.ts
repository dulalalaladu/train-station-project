// Playback scheduling for continuous WebAudio playback (plan §3.4: jitter buffer 120～200 ms).
// Each decoded chunk is started at `startAt` (AudioContext time); chunks chain back-to-back so
// playback is gapless as long as data arrives before the previous chunk finishes.

export interface PlaybackState {
  /** AudioContext time at which the already-scheduled audio ends; undefined = idle. */
  readonly nextStart: number | undefined;
  readonly underruns: number;
  readonly scheduled: number;
  /** Largest scheduled-ahead distance seen (queue depth, i.e. added latency). */
  readonly maxLeadSec: number;
}

export interface ScheduleResult {
  readonly startAt: number;
  /** How far ahead of `now` this chunk starts. */
  readonly leadSec: number;
  readonly state: PlaybackState;
}

export function initialPlayback(): PlaybackState {
  return { nextStart: undefined, underruns: 0, scheduled: 0, maxLeadSec: 0 };
}

/**
 * Decide when a chunk of `durationSec` should start. `now` is AudioContext.currentTime.
 * - idle (stream start / after end marker): prime one jitter buffer ahead, not an underrun
 * - queue ran dry mid-stream (nextStart < now): count an underrun and re-prime
 * - otherwise: chain after the previous chunk
 */
export function scheduleChunk(
  state: PlaybackState,
  now: number,
  durationSec: number,
  jitterSec: number,
): ScheduleResult {
  const dry = state.nextStart !== undefined && state.nextStart < now;
  const idle = state.nextStart === undefined;
  const startAt = idle || dry ? now + jitterSec : (state.nextStart as number);
  const leadSec = startAt - now;
  return {
    startAt,
    leadSec,
    state: {
      nextStart: startAt + durationSec,
      underruns: state.underruns + (dry ? 1 : 0),
      scheduled: state.scheduled + 1,
      maxLeadSec: Math.max(state.maxLeadSec, leadSec),
    },
  };
}

/** An end-of-stream marker arrived: the next chunk starts a fresh stream, not an underrun. */
export function endStream(state: PlaybackState): PlaybackState {
  return { ...state, nextStart: undefined };
}
