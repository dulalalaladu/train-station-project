import { describe, expect, it } from 'vitest';

import {
  CHANNEL_ASR,
  CHANNEL_TALK,
  createImpairment,
  echoBinary,
  replyToText,
} from '../src/echo.ts';

function frame(channel: number, flags: number, seq: number, payload: number[]): Uint8Array {
  return Uint8Array.from([channel, flags, (seq >> 8) & 0xff, seq & 0xff, ...payload]);
}

describe('echoBinary', () => {
  it('re-labels channel 1 as channel 2 and keeps flags, seq and payload', () => {
    const out = echoBinary(frame(CHANNEL_ASR, 1, 0x0102, [9, 8, 7, 6]));
    expect(Array.from(out ?? [])).toEqual([CHANNEL_TALK, 1, 1, 2, 9, 8, 7, 6]);
  });

  it('does not mutate its input', () => {
    const input = frame(CHANNEL_ASR, 0, 1, [1, 2]);
    echoBinary(input);
    expect(input[0]).toBe(CHANNEL_ASR);
  });

  it('accepts a header-only frame (end marker without payload)', () => {
    expect(echoBinary(frame(CHANNEL_ASR, 1, 5, []))?.length).toBe(4);
  });

  it('rejects frames shorter than the header', () => {
    expect(echoBinary(Uint8Array.from([1, 0, 0]))).toBeNull();
  });

  it('rejects frames that are not channel 1', () => {
    expect(echoBinary(frame(CHANNEL_TALK, 0, 1, [1, 2]))).toBeNull();
    expect(echoBinary(frame(7, 0, 1, [1, 2]))).toBeNull();
  });

  it('rejects an odd-length PCM16 payload', () => {
    expect(echoBinary(frame(CHANNEL_ASR, 0, 1, [1, 2, 3]))).toBeNull();
  });
});

describe('replyToText', () => {
  it('answers ping with pong carrying the client timestamp', () => {
    const reply = replyToText(JSON.stringify({ type: 'ping', ts: 1234 }), 9999);
    expect(JSON.parse(reply)).toEqual({ type: 'pong', ts: 1234, server_ts: 9999 });
  });

  it('answers cmd.submit with a cmd.state received receipt', () => {
    const raw = JSON.stringify({ type: 'cmd.submit', command_id: 'c-1', ts: 77 });
    expect(JSON.parse(replyToText(raw, 5000))).toEqual({
      type: 'cmd.state',
      command_id: 'c-1',
      state: 'received',
      ts: 5000,
      echo_ts: 77,
    });
  });

  it('returns an error message for malformed JSON', () => {
    const reply = JSON.parse(replyToText('{nope', 1));
    expect(reply).toMatchObject({ type: 'error', code: 'BAD_MESSAGE' });
  });

  it('returns an error message for an unknown type or bad fields', () => {
    expect(JSON.parse(replyToText('{"type":"x"}', 1))).toMatchObject({ code: 'BAD_MESSAGE' });
    expect(JSON.parse(replyToText('{"type":"ping","ts":"a"}', 1))).toMatchObject({
      code: 'BAD_MESSAGE',
    });
  });
});

describe('createImpairment', () => {
  it('is a no-op by default', () => {
    expect(createImpairment({}, () => 0.5).plan()).toEqual({ drop: false, delayMs: 0 });
  });

  it('drops when the random draw is below the drop probability', () => {
    expect(createImpairment({ dropPct: 10 }, () => 0.05).plan().drop).toBe(true);
    expect(createImpairment({ dropPct: 10 }, () => 0.5).plan().drop).toBe(false);
  });

  it('adds base delay plus uniform jitter', () => {
    const low = createImpairment({ delayMs: 50, jitterMs: 40 }, () => 0).plan();
    const high = createImpairment({ delayMs: 50, jitterMs: 40 }, () => 0.99).plan();
    expect(low.delayMs).toBe(50);
    expect(high.delayMs).toBeCloseTo(50 + 39.6, 5);
  });

  it('rejects out-of-range settings', () => {
    expect(() => createImpairment({ dropPct: 101 }, () => 0)).toThrow();
    expect(() => createImpairment({ delayMs: -1 }, () => 0)).toThrow();
  });
});
