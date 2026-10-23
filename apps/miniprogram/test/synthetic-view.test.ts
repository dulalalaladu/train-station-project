import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/spike/config';
import type { Snapshot } from '../src/spike/controller';
import { rmsLevel } from '../src/spike/pcm';
import type { RecorderHandlers, TimerPort } from '../src/spike/ports';
import { buildReport } from '../src/spike/report';
import { createSyntheticRecorder } from '../src/spike/synthetic';
import { toView } from '../src/spike/view-model';

function fakeTimers() {
  const ticks: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const port: TimerPort = {
    every: (ms, fn) => {
      const t = { ms, fn, cancelled: false };
      ticks.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
  return { port, ticks };
}

function handlers(frames: ArrayBuffer[]): RecorderHandlers {
  return {
    onFrame: (f) => frames.push(f),
    onError: () => undefined,
    onStop: () => undefined,
    onInterruptionBegin: () => undefined,
    onInterruptionEnd: () => undefined,
  };
}

describe('createSyntheticRecorder', () => {
  it('ticks at the frame duration and emits frameSize KB of PCM per tick', () => {
    const { port, ticks } = fakeTimers();
    const frames: ArrayBuffer[] = [];
    createSyntheticRecorder(port).start(2, handlers(frames));
    expect(ticks[0]?.ms).toBe(64);
    ticks[0]?.fn();
    expect(frames[0]?.byteLength).toBe(2048);
  });

  it('alternates tone and silence so the energy gate has something to do', () => {
    const { port, ticks } = fakeTimers();
    const frames: ArrayBuffer[] = [];
    createSyntheticRecorder(port, { toneMs: 128, pauseMs: 128 }).start(2, handlers(frames));
    for (let i = 0; i < 4; i += 1) ticks[0]?.fn();
    const levels = frames.map((f) => rmsLevel(new Int16Array(f)) > 0.01);
    expect(levels).toEqual([true, true, false, false]);
  });

  it('stop cancels the tick timer', () => {
    const { port, ticks } = fakeTimers();
    const recorder = createSyntheticRecorder(port);
    recorder.start(1, handlers([]));
    recorder.stop();
    expect(ticks[0]?.cancelled).toBe(true);
  });
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  phase: 'running',
  events: [{ t: 12, kind: 'hide', detail: 'x' }],
  interval: { count: 100, meanMs: 64.234, minMs: 60, maxMs: 188.9 },
  uplink: { sent: 90, skipped: 10, bytesPerSec: 32768 },
  downlink: { received: 90, lost: 0, duplicate: 0, reordered: 0 },
  playback: { scheduled: 90, underruns: 3, underrunRate: 3 / 90, maxLeadMs: 224 },
  rtt: { count: 90, meanMs: 120.5, maxMs: 310 },
  json: { ping: { count: 2, meanMs: 40, maxMs: 55 }, cmd: { count: 5, meanMs: 42, maxMs: 90 } },
  ...over,
});

describe('toView', () => {
  it('formats the headline metrics for display', () => {
    const v = toView(snapshot());
    expect(v.interval).toBe('64.2 / 188.9 ms (n=100)');
    expect(v.uplink).toBe('32.0 KB/s · 发送 90 · 静音跳过 10');
    expect(v.underruns).toBe('3 / 90 (3.3%)');
    expect(v.rtt).toBe('120.5 / 310 ms (n=90)');
    expect(v.jsonRtt).toBe('ping 40.0/55 ms · cmd 42.0/90 ms');
  });

  it('marks the interval criterion (max < 200 ms) as pass or fail', () => {
    expect(toView(snapshot()).intervalOk).toBe(true);
    const bad = snapshot({ interval: { count: 5, meanMs: 70, minMs: 60, maxMs: 250 } });
    expect(toView(bad).intervalOk).toBe(false);
  });

  it('shows dashes before any data', () => {
    const empty = snapshot({
      interval: { count: 0, meanMs: 0, minMs: 0, maxMs: 0 },
      rtt: { count: 0, meanMs: 0, maxMs: 0 },
    });
    const v = toView(empty);
    expect(v.interval).toBe('—');
    expect(v.rtt).toBe('—');
  });

  it('renders the newest events first with relative seconds', () => {
    const v = toView(
      snapshot({
        events: [
          { t: 1000, kind: 'start', detail: 'a' },
          { t: 2500, kind: 'hide', detail: 'b' },
        ],
      }),
    );
    expect(v.events).toEqual(['+2.5s hide b', '+1.0s start a']);
  });
});

describe('buildReport', () => {
  it('captures environment, config, metrics and events as JSON text', () => {
    const text = buildReport({
      env: { model: 'TestPhone', system: 'iOS 99', wechat: '9.9.9', sdk: '3.0.0' },
      config: DEFAULT_CONFIG,
      source: 'mic',
      interruptionMode: 'start',
      durationMs: 31000,
      snapshot: snapshot(),
    });
    const parsed = JSON.parse(text);
    expect(parsed.env.model).toBe('TestPhone');
    expect(parsed.config.frameSizeKb).toBe(2);
    expect(parsed.source).toBe('mic');
    expect(parsed.durationSec).toBe(31);
    expect(parsed.metrics.playback.underruns).toBe(3);
    expect(parsed.events[0].kind).toBe('hide');
  });

  it('never includes the connection URL query/credentials', () => {
    const text = buildReport({
      env: {},
      config: { ...DEFAULT_CONFIG, url: 'wss://user:pw@host.test/ws?token=SECRET' },
      source: 'synthetic',
      interruptionMode: 'none',
      durationMs: 0,
      snapshot: snapshot(),
    });
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('pw@');
    expect(JSON.parse(text).config.url).toBe('wss://host.test/ws');
  });
});
