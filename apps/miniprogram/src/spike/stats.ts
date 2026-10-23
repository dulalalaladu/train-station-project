// Immutable measurement helpers: every update returns a new value.

export interface RunningStats {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
}

export function emptyStats(): RunningStats {
  return { count: 0, sum: 0, min: 0, max: 0 };
}

export function addSample(stats: RunningStats, value: number): RunningStats {
  const first = stats.count === 0;
  return {
    count: stats.count + 1,
    sum: stats.sum + value,
    min: first ? value : Math.min(stats.min, value),
    max: first ? value : Math.max(stats.max, value),
  };
}

export function meanOf(stats: RunningStats): number {
  return stats.count === 0 ? 0 : stats.sum / stats.count;
}

export interface RateWindow {
  readonly windowMs: number;
  readonly events: readonly { readonly t: number; readonly bytes: number }[];
}

export function emptyRate(windowMs: number): RateWindow {
  return { windowMs, events: [] };
}

export function addBytes(rate: RateWindow, t: number, bytes: number): RateWindow {
  const events = [...rate.events, { t, bytes }].filter((e) => t - e.t < rate.windowMs);
  return { windowMs: rate.windowMs, events };
}

/** Average bytes/second over the trailing window ending at `now`. */
export function bytesPerSec(rate: RateWindow, now: number): number {
  const total = rate.events
    .filter((e) => now - e.t < rate.windowMs)
    .reduce((a, e) => a + e.bytes, 0);
  return (total * 1000) / rate.windowMs;
}

export interface SeqState {
  readonly last: number | undefined;
  readonly received: number;
  readonly lost: number;
  readonly duplicate: number;
  readonly reordered: number;
}

export function emptySeq(): SeqState {
  return { last: undefined, received: 0, lost: 0, duplicate: 0, reordered: 0 };
}

const HALF_SEQ_SPACE = 0x8000;

/** Track u16 sequence numbers: gaps count as lost, backwards steps as reordered. */
export function trackSeq(state: SeqState, seq: number): SeqState {
  const received = state.received + 1;
  if (state.last === undefined) return { ...state, last: seq, received };
  const delta = (seq - state.last + 0x10000) % 0x10000;
  if (delta === 0) return { ...state, received, duplicate: state.duplicate + 1 };
  if (delta >= HALF_SEQ_SPACE) {
    return {
      ...state,
      received,
      reordered: state.reordered + 1,
      lost: Math.max(0, state.lost - 1),
    };
  }
  return { ...state, last: seq, received, lost: state.lost + delta - 1 };
}

const MAX_PENDING = 256;

export interface SentLog {
  readonly size: number;
  readonly entries: ReadonlyMap<number, number>;
}

export function emptySent(): SentLog {
  return { size: 0, entries: new Map() };
}

export function recordSent(log: SentLog, seq: number, t: number): SentLog {
  const entries = new Map(log.entries);
  entries.set(seq, t);
  while (entries.size > MAX_PENDING) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return { size: entries.size, entries };
}

export interface Resolution {
  readonly rtt: number | undefined;
  readonly pending: SentLog;
}

/** Match an echoed frame to its send time; each sent frame resolves at most once. */
export function resolveSent(log: SentLog, seq: number, now: number): Resolution {
  const sentAt = log.entries.get(seq);
  if (sentAt === undefined) return { rtt: undefined, pending: log };
  const entries = new Map(log.entries);
  entries.delete(seq);
  return { rtt: now - sentAt, pending: { size: entries.size, entries } };
}
