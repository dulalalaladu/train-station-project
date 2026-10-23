// Pure formatting of controller snapshots into the strings the spike page shows.
import type { Snapshot } from './controller';

/** Plan acceptance criterion: recorder frame interval must stay under 200 ms. */
export const MAX_INTERVAL_MS = 200;

export interface View {
  readonly phase: string;
  readonly interval: string;
  readonly intervalOk: boolean;
  readonly uplink: string;
  readonly downlink: string;
  readonly underruns: string;
  readonly rtt: string;
  readonly jsonRtt: string;
  readonly events: readonly string[];
}

const DASH = '—';

function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function meanMax(stats: { count: number; meanMs: number; maxMs: number }): string {
  return `${stats.meanMs.toFixed(1)}/${round1(stats.maxMs)} ms`;
}

function withCount(stats: { count: number; meanMs: number; maxMs: number }): string {
  if (stats.count === 0) return DASH;
  return `${stats.meanMs.toFixed(1)} / ${round1(stats.maxMs)} ms (n=${stats.count})`;
}

function jsonText(s: Snapshot['json']): string {
  if (s.ping.count === 0 && s.cmd.count === 0) return DASH;
  return `ping ${meanMax(s.ping)} · cmd ${meanMax(s.cmd)}`;
}

export function toView(s: Snapshot): View {
  const pct = (s.playback.underrunRate * 100).toFixed(1);
  return {
    phase: s.phase,
    interval: withCount(s.interval),
    intervalOk: s.interval.count > 0 && s.interval.maxMs < MAX_INTERVAL_MS,
    uplink: `${(s.uplink.bytesPerSec / 1024).toFixed(1)} KB/s · 发送 ${s.uplink.sent} · 静音跳过 ${s.uplink.skipped}`,
    downlink: `收到 ${s.downlink.received} · 丢 ${s.downlink.lost} · 乱序 ${s.downlink.reordered} · 重复 ${s.downlink.duplicate}`,
    underruns: `${s.playback.underruns} / ${s.playback.scheduled} (${pct}%)`,
    rtt: withCount(s.rtt),
    jsonRtt: jsonText(s.json),
    events: [...s.events]
      .reverse()
      .map((e) => `+${(e.t / 1000).toFixed(1)}s ${e.kind} ${e.detail}`),
  };
}
