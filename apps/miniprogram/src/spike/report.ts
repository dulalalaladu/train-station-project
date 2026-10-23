// Shareable run report: the tester copies this JSON from the page and pastes it into the
// result table (docs/test-plans/miniprogram-audio-spike.md). It must never carry credentials.
import type { SpikeConfig } from './config';
import type { Snapshot } from './controller';

export type AudioSource = 'mic' | 'synthetic';
export type InterruptionMode = 'none' | 'start' | 'resume';

export interface ReportInput {
  readonly env: Readonly<Record<string, string>>;
  readonly config: SpikeConfig;
  readonly source: AudioSource;
  readonly interruptionMode: InterruptionMode;
  readonly durationMs: number;
  readonly snapshot: Snapshot;
}

/** Keep scheme + host + path only: drops userinfo, query (tokens) and fragment. */
export function redactUrl(url: string): string {
  const match = /^(wss?:\/\/)(?:[^@/?#]*@)?([^/?#]*)([^?#]*)/.exec(url);
  return match ? `${match[1]}${match[2]}${match[3]}` : '[invalid url]';
}

export function buildReport(input: ReportInput): string {
  const { snapshot, config } = input;
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      env: input.env,
      source: input.source,
      interruptionMode: input.interruptionMode,
      durationSec: Math.round(input.durationMs / 1000),
      config: { ...config, url: redactUrl(config.url) },
      metrics: {
        phase: snapshot.phase,
        interval: snapshot.interval,
        uplink: snapshot.uplink,
        downlink: snapshot.downlink,
        playback: snapshot.playback,
        rtt: snapshot.rtt,
        json: snapshot.json,
      },
      events: snapshot.events,
    },
    null,
    2,
  );
}
