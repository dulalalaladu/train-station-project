import { describe, expect, it } from 'vitest';
import { FRAME_BYTES, chunkPcm, pcmDurationMs, sendPaced, toRawPcm, type Pacer } from '../src/audio/pcm.ts';
import { percentile, summarize } from '../src/metrics.ts';
import { IAT_ENV_NAMES, MissingCredentialsError, loadIatCredentials, loadRtasrCredentials } from '../src/config.ts';

function wavHeader(dataBytes: number, rate = 16000, channels = 1, bits = 16): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE((rate * channels * bits) / 8, 28);
  h.writeUInt16LE((channels * bits) / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

describe('chunkPcm / toRawPcm', () => {
  it('cuts 1280 B frames with a short tail', () => {
    const frames = chunkPcm(Buffer.alloc(FRAME_BYTES * 2 + 100));
    expect(frames.map((f) => f.length)).toEqual([1280, 1280, 100]);
  });

  it('returns one empty frame for empty input', () => {
    expect(chunkPcm(Buffer.alloc(0))).toHaveLength(1);
  });

  it('computes duration at 32 B/ms', () => {
    expect(pcmDurationMs(Buffer.alloc(32_000))).toBe(1000);
  });

  it('passes bare PCM through and strips a valid WAV header', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    expect(toRawPcm(pcm)).toBe(pcm);
    expect(toRawPcm(Buffer.concat([wavHeader(4), pcm])).equals(pcm)).toBe(true);
  });

  it('rejects WAV in the wrong format', () => {
    expect(() => toRawPcm(Buffer.concat([wavHeader(4, 8000), Buffer.alloc(4)]))).toThrow(/16 kHz/);
    expect(() => toRawPcm(Buffer.concat([wavHeader(4, 16000, 2), Buffer.alloc(4)]))).toThrow(/mono/);
  });

  it('rejects a WAV without data chunk', () => {
    expect(() => toRawPcm(wavHeader(0).subarray(0, 36))).toThrow(/no data chunk/);
  });
});

describe('sendPaced', () => {
  it('schedules frame i at start + i*40 ms without drift', async () => {
    let clock = 1000;
    const sleeps: number[] = [];
    const pacer: Pacer = {
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms + 3; }, // 3 ms oversleep each time
    };
    const sent: number[] = [];
    await sendPaced([Buffer.alloc(1), Buffer.alloc(1), Buffer.alloc(1), Buffer.alloc(1)], (_f, i) => sent.push(clock + 0 * i), pacer);
    expect(sent).toHaveLength(4);
    // frame 1 at 1040 (wait 40), frame 2 at 1080: wait 80-43=37, frame 3 at 1120: wait 120-83=37
    expect(sleeps).toEqual([40, 37, 37]);
  });

  it('flags the last frame', async () => {
    const flags: boolean[] = [];
    const pacer: Pacer = { now: () => 0, sleep: async () => undefined };
    await sendPaced([Buffer.alloc(1), Buffer.alloc(1)], (_f, _i, last) => flags.push(last), pacer, 0);
    expect(flags).toEqual([false, true]);
  });
});

describe('metrics', () => {
  it('computes nearest-rank percentiles', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(10);
    expect(percentile(v, 95)).toBe(19);
    expect(summarize(v)).toEqual({ n: 20, p50: 10, p95: 19, min: 1, max: 20 });
  });

  it('throws on empty samples', () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe('credentials', () => {
  it('throws naming every missing variable, never a placeholder', () => {
    try {
      loadIatCredentials({ XFYUN_APP_ID: 'x' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCredentialsError);
      expect((err as MissingCredentialsError).missing).toEqual(['XFYUN_API_KEY', 'XFYUN_API_SECRET']);
    }
  });

  it('treats blank values as missing', () => {
    expect(() => loadRtasrCredentials({ XFYUN_APP_ID: 'a', XFYUN_RTASR_ACCESS_KEY_ID: '  ', XFYUN_RTASR_ACCESS_KEY_SECRET: 's' })).toThrow(/ACCESS_KEY_ID/);
  });

  it('loads and trims complete sets', () => {
    expect(loadIatCredentials({ XFYUN_APP_ID: ' a ', XFYUN_API_KEY: 'k', XFYUN_API_SECRET: 's' })).toEqual({ appId: 'a', apiKey: 'k', apiSecret: 's' });
    expect(IAT_ENV_NAMES).toHaveLength(3);
  });
});
