import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, parseSpikeConfig, type SpikeConfig } from '../src/spike/config';
import { SpikeController } from '../src/spike/controller';
import { CHANNEL_ASR, CHANNEL_TALK, FLAG_END, decodeFrame, encodeFrame } from '../src/spike/frame';
import type { Ports, RecorderHandlers, SocketHandlers } from '../src/spike/ports';
import { sineFrame } from '../src/spike/pcm';

interface Fakes {
  ports: Ports;
  now: { ms: number; audio: number };
  sentBinary: ArrayBuffer[];
  sentText: string[];
  scheduled: { samples: Float32Array; startAt: number }[];
  socket: { handlers?: SocketHandlers; closed: boolean };
  recorder: { handlers?: RecorderHandlers; frameSizeKb?: number; stopped: boolean };
  timers: { fn: () => void; ms: number; cancelled: boolean }[];
}

function makeFakes(): Fakes {
  const f: Fakes = {
    now: { ms: 1000, audio: 5 },
    sentBinary: [],
    sentText: [],
    scheduled: [],
    socket: { closed: false },
    recorder: { stopped: false },
    timers: [],
    ports: undefined as unknown as Ports,
  };
  f.ports = {
    clock: () => f.now.ms,
    socket: {
      open: (_url, handlers) => {
        f.socket.handlers = handlers;
      },
      sendBinary: (d) => f.sentBinary.push(d),
      sendText: (d) => f.sentText.push(d),
      close: () => {
        f.socket.closed = true;
      },
    },
    recorder: {
      start: (kb, handlers) => {
        f.recorder.frameSizeKb = kb;
        f.recorder.handlers = handlers;
      },
      stop: () => {
        f.recorder.stopped = true;
      },
    },
    player: {
      currentTime: () => f.now.audio,
      schedule: (samples, startAt) => f.scheduled.push({ samples, startAt }),
      close: () => undefined,
    },
    timers: {
      every: (ms, fn) => {
        const t = { fn, ms, cancelled: false };
        f.timers.push(t);
        return () => {
          t.cancelled = true;
        };
      },
    },
  };
  return f;
}

const loud = (n = 1024): ArrayBuffer =>
  sineFrame({ samples: n, freqHz: 440, amplitude: 0.5 }).buffer as ArrayBuffer;
const silent = (n = 1024): ArrayBuffer => new Int16Array(n).buffer;

function startRunning(f: Fakes, overrides: Partial<SpikeConfig> = {}): SpikeController {
  const c = new SpikeController(f.ports);
  c.start(parseSpikeConfig({ ...DEFAULT_CONFIG, ...overrides }));
  f.socket.handlers?.onOpen();
  return c;
}

describe('SpikeController lifecycle', () => {
  let f: Fakes;
  beforeEach(() => {
    f = makeFakes();
  });

  it('is connecting after start and running after the socket opens', () => {
    const c = new SpikeController(f.ports);
    c.start(DEFAULT_CONFIG);
    expect(c.snapshot().phase).toBe('connecting');
    f.socket.handlers?.onOpen();
    expect(c.snapshot().phase).toBe('running');
    expect(f.recorder.frameSizeKb).toBe(2);
  });

  it('runs heartbeat and simulated cmd timers at the configured cadence', () => {
    startRunning(f);
    expect(f.timers.map((t) => t.ms).sort((a, b) => a - b)).toEqual([2000, 15000]);
  });

  it('skips the cmd timer when cmdIntervalMs is 0', () => {
    startRunning(f, { cmdIntervalMs: 0 });
    expect(f.timers.map((t) => t.ms)).toEqual([15000]);
  });

  it('sends a ping on every heartbeat tick and a cmd.submit on every cmd tick', () => {
    startRunning(f);
    f.timers.forEach((t) => t.fn());
    const types = f.sentText.map((s) => JSON.parse(s).type).sort();
    expect(types).toEqual(['cmd.submit', 'ping']);
  });

  it('stop cancels timers, stops the recorder and closes the socket', () => {
    const c = startRunning(f);
    c.stop();
    expect(f.timers.every((t) => t.cancelled)).toBe(true);
    expect(f.recorder.stopped).toBe(true);
    expect(f.socket.closed).toBe(true);
    expect(c.snapshot().phase).toBe('idle');
  });

  it('a socket close tears the session down and records why', () => {
    const c = startRunning(f);
    f.socket.handlers?.onClose('1006 abnormal');
    const snap = c.snapshot();
    expect(snap.phase).toBe('closed');
    expect(f.recorder.stopped).toBe(true);
    expect(snap.events.at(-1)?.detail).toContain('1006');
  });

  it('a socket error moves to the error phase', () => {
    const c = startRunning(f);
    f.socket.handlers?.onError('connect fail');
    expect(c.snapshot().phase).toBe('error');
  });

  it('ignores callbacks that arrive after stop', () => {
    const c = startRunning(f);
    c.stop();
    f.recorder.handlers?.onFrame(loud());
    f.socket.handlers?.onBinary(new ArrayBuffer(8));
    expect(f.sentBinary).toHaveLength(0);
    expect(c.snapshot().playback.scheduled).toBe(0);
  });
});

describe('uplink', () => {
  let f: Fakes;
  beforeEach(() => {
    f = makeFakes();
  });

  it('sends loud frames as channel-1 frames with incrementing seq', () => {
    startRunning(f);
    f.recorder.handlers?.onFrame(loud());
    f.recorder.handlers?.onFrame(loud());
    const frames = f.sentBinary.map(decodeFrame);
    expect(frames.map((x) => x.channel)).toEqual([CHANNEL_ASR, CHANNEL_ASR]);
    expect(frames.map((x) => x.seq)).toEqual([0, 1]);
    expect(frames[0]?.pcm.length).toBe(1024);
  });

  it('does not send silent frames while the gate is closed', () => {
    const c = startRunning(f);
    f.recorder.handlers?.onFrame(silent());
    f.recorder.handlers?.onFrame(silent());
    expect(f.sentBinary).toHaveLength(0);
    expect(c.snapshot().uplink.skipped).toBe(2);
  });

  it('flags the last frame of an utterance after the hangover', () => {
    startRunning(f, { gate: { threshold: 0.01, hangoverFrames: 2 } });
    f.recorder.handlers?.onFrame(loud());
    f.recorder.handlers?.onFrame(silent());
    f.recorder.handlers?.onFrame(silent());
    f.recorder.handlers?.onFrame(silent());
    const flags = f.sentBinary.map((b) => decodeFrame(b).flags);
    expect(flags).toEqual([0, 0, FLAG_END]);
  });

  it('sends everything when the silence gate is disabled', () => {
    startRunning(f, { silenceGate: false });
    f.recorder.handlers?.onFrame(silent());
    expect(f.sentBinary).toHaveLength(1);
  });

  it('on stop, closes an open utterance with a header-only end frame', () => {
    const c = startRunning(f);
    f.recorder.handlers?.onFrame(loud());
    c.stop();
    const last = decodeFrame(f.sentBinary.at(-1) as ArrayBuffer);
    expect(last.flags).toBe(FLAG_END);
    expect(last.pcm.length).toBe(0);
  });

  it('measures recorder frame intervals (mean and max)', () => {
    const c = startRunning(f, { silenceGate: false });
    for (const dt of [0, 64, 66, 190]) {
      f.now.ms += dt;
      f.recorder.handlers?.onFrame(silent());
    }
    const { interval } = c.snapshot();
    expect(interval.count).toBe(3);
    expect(interval.maxMs).toBe(190);
    expect(interval.meanMs).toBeCloseTo((64 + 66 + 190) / 3, 5);
  });

  it('reports uplink bytes per second over the last second', () => {
    const c = startRunning(f, { silenceGate: false });
    f.recorder.handlers?.onFrame(loud(1024));
    f.now.ms += 500;
    f.recorder.handlers?.onFrame(loud(1024));
    const bps = c.snapshot().uplink.bytesPerSec;
    expect(bps).toBe((2048 + 4) * 2);
  });

  it('drops and logs an odd-length frame instead of throwing', () => {
    const c = startRunning(f);
    expect(() => f.recorder.handlers?.onFrame(new ArrayBuffer(5))).not.toThrow();
    expect(f.sentBinary).toHaveLength(0);
    expect(c.snapshot().events.at(-1)?.kind).toBe('bad-frame');
  });

  it('logs recorder errors and interruption begin/end', () => {
    const c = startRunning(f);
    f.recorder.handlers?.onInterruptionBegin();
    f.recorder.handlers?.onInterruptionEnd();
    f.recorder.handlers?.onError('permission denied');
    const kinds = c.snapshot().events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['interruption-begin', 'interruption-end', 'recorder-error']),
    );
  });
});

describe('downlink', () => {
  let f: Fakes;
  beforeEach(() => {
    f = makeFakes();
  });

  const echoFrame = (seq: number, flags = 0, n = 1024): ArrayBuffer =>
    encodeFrame({
      channel: CHANNEL_TALK,
      flags,
      seq,
      pcm: sineFrame({ samples: n, freqHz: 440, amplitude: 0.5 }),
    });

  it('schedules decoded audio one jitter buffer ahead', () => {
    const c = startRunning(f, { jitterMs: 160 });
    f.socket.handlers?.onBinary(echoFrame(0));
    expect(f.scheduled).toHaveLength(1);
    expect(f.scheduled[0]?.startAt).toBeCloseTo(5.16, 6);
    expect(f.scheduled[0]?.samples.length).toBe(1024);
    expect(c.snapshot().playback.scheduled).toBe(1);
  });

  it('counts an underrun when audio arrives after the queue drained', () => {
    const c = startRunning(f);
    f.socket.handlers?.onBinary(echoFrame(0));
    f.now.audio = 9;
    f.socket.handlers?.onBinary(echoFrame(1));
    expect(c.snapshot().playback.underruns).toBe(1);
  });

  it('does not count an underrun across an end-of-stream flag', () => {
    const c = startRunning(f);
    f.socket.handlers?.onBinary(echoFrame(0, FLAG_END));
    f.now.audio = 9;
    f.socket.handlers?.onBinary(echoFrame(1));
    expect(c.snapshot().playback.underruns).toBe(0);
  });

  it('measures audio round-trip from the sent frame to the echoed frame', () => {
    const c = startRunning(f, { silenceGate: false });
    f.recorder.handlers?.onFrame(loud());
    f.now.ms += 180;
    f.socket.handlers?.onBinary(echoFrame(0));
    const { rtt } = c.snapshot();
    expect(rtt.count).toBe(1);
    expect(rtt.meanMs).toBe(180);
  });

  it('tracks downlink sequence loss', () => {
    const c = startRunning(f);
    f.socket.handlers?.onBinary(echoFrame(0));
    f.socket.handlers?.onBinary(echoFrame(3));
    expect(c.snapshot().downlink.lost).toBe(2);
  });

  it('logs and ignores undecodable or wrong-channel binary frames', () => {
    const c = startRunning(f);
    f.socket.handlers?.onBinary(new ArrayBuffer(2));
    f.socket.handlers?.onBinary(
      encodeFrame({ channel: CHANNEL_ASR, flags: 0, seq: 0, pcm: new Int16Array(2) }),
    );
    expect(f.scheduled).toHaveLength(0);
    expect(c.snapshot().events.filter((e) => e.kind === 'bad-frame')).toHaveLength(2);
  });

  it('times JSON replies independently of the audio path', () => {
    const c = startRunning(f);
    f.now.ms = 2000;
    f.socket.handlers?.onText(JSON.stringify({ type: 'pong', ts: 1950, server_ts: 1 }));
    f.socket.handlers?.onText(
      JSON.stringify({
        type: 'cmd.state',
        command_id: 'x',
        echo_ts: 1900,
        ts: 1,
        state: 'received',
      }),
    );
    f.socket.handlers?.onText('garbage');
    const { json } = c.snapshot();
    expect(json.ping.count).toBe(1);
    expect(json.ping.maxMs).toBe(50);
    expect(json.cmd.maxMs).toBe(100);
  });

  it('logs server error frames', () => {
    const c = startRunning(f);
    f.socket.handlers?.onText(JSON.stringify({ type: 'error', code: 'ASR_BUSY', message: 'x' }));
    expect(c.snapshot().events.at(-1)?.detail).toContain('ASR_BUSY');
  });
});

describe('background / foreground', () => {
  it('records hide and show with socket state and frames received while hidden', () => {
    const f = makeFakes();
    const c = startRunning(f, { silenceGate: false });
    c.onHide();
    f.now.ms += 100;
    f.recorder.handlers?.onFrame(silent());
    f.now.ms += 100;
    c.onShow();
    const events = c.snapshot().events;
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['hide', 'show']));
    expect(events.at(-1)?.detail).toContain('framesWhileHidden=1');
    expect(events.at(-1)?.detail).toContain('ws=open');
  });

  it('still logs show with ws=closed when the socket died in the background', () => {
    const f = makeFakes();
    const c = startRunning(f);
    c.onHide();
    f.socket.handlers?.onClose('1006 abnormal');
    c.onShow();
    expect(c.snapshot().events.at(-1)?.detail).toContain('ws=closed');
  });

  it('ignores hide/show before any run', () => {
    const c = new SpikeController(makeFakes().ports);
    c.onHide();
    c.onShow();
    expect(c.snapshot().events).toEqual([]);
  });

  it('flags a stall when a recorder gap exceeds 500 ms', () => {
    const f = makeFakes();
    const c = startRunning(f, { silenceGate: false });
    f.recorder.handlers?.onFrame(silent());
    f.now.ms += 800;
    f.recorder.handlers?.onFrame(silent());
    expect(c.snapshot().events.some((e) => e.kind === 'stall')).toBe(true);
  });

  it('resetStats clears metrics but keeps the session running', () => {
    const f = makeFakes();
    const c = startRunning(f, { silenceGate: false });
    f.recorder.handlers?.onFrame(loud());
    f.now.ms += 64;
    f.recorder.handlers?.onFrame(loud());
    c.resetStats();
    const snap = c.snapshot();
    expect(snap.interval.count).toBe(0);
    expect(snap.uplink.sent).toBe(0);
    expect(snap.phase).toBe('running');
  });
});
