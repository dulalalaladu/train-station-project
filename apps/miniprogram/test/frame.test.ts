import { describe, expect, it } from 'vitest';

import {
  CHANNEL_ASR,
  CHANNEL_TALK,
  FLAG_END,
  HEADER_BYTES,
  decodeFrame,
  encodeFrame,
  nextSeq,
} from '../src/spike/frame';

describe('encodeFrame', () => {
  it('writes [channel][flags][seq u16 BE][PCM16LE]', () => {
    const buf = encodeFrame({
      channel: CHANNEL_ASR,
      flags: 0,
      seq: 0x0102,
      pcm: Int16Array.from([1, -2]),
    });
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 0, 1, 2, 1, 0, 0xfe, 0xff]);
  });

  it('encodes an end marker as a header-only frame', () => {
    const buf = encodeFrame({
      channel: CHANNEL_ASR,
      flags: FLAG_END,
      seq: 9,
      pcm: new Int16Array(0),
    });
    expect(buf.byteLength).toBe(HEADER_BYTES);
    expect(new Uint8Array(buf)[1]).toBe(FLAG_END);
  });

  it('does not alias the caller PCM buffer', () => {
    const pcm = Int16Array.from([5]);
    const buf = encodeFrame({ channel: CHANNEL_ASR, flags: 0, seq: 0, pcm });
    pcm[0] = 99;
    expect(new Int16Array(buf.slice(HEADER_BYTES))[0]).toBe(5);
  });

  it('rejects out-of-range header fields', () => {
    const pcm = new Int16Array(0);
    expect(() => encodeFrame({ channel: 256, flags: 0, seq: 0, pcm })).toThrow(RangeError);
    expect(() => encodeFrame({ channel: 1, flags: -1, seq: 0, pcm })).toThrow(RangeError);
    expect(() => encodeFrame({ channel: 1, flags: 0, seq: 65536, pcm })).toThrow(RangeError);
  });
});

describe('decodeFrame', () => {
  it('round-trips an encoded frame', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768]);
    const frame = decodeFrame(
      encodeFrame({ channel: CHANNEL_TALK, flags: FLAG_END, seq: 65535, pcm }),
    );
    expect(frame.channel).toBe(CHANNEL_TALK);
    expect(frame.flags).toBe(FLAG_END);
    expect(frame.seq).toBe(65535);
    expect(Array.from(frame.pcm)).toEqual(Array.from(pcm));
  });

  it('rejects buffers shorter than the header', () => {
    expect(() => decodeFrame(new ArrayBuffer(3))).toThrow(/header/);
  });

  it('rejects an odd payload length', () => {
    const raw = new Uint8Array(HEADER_BYTES + 3);
    raw[0] = CHANNEL_ASR;
    expect(() => decodeFrame(raw.buffer)).toThrow(/odd/);
  });

  it('rejects unknown channels', () => {
    const raw = new Uint8Array([9, 0, 0, 0, 0, 0]);
    expect(() => decodeFrame(raw.buffer)).toThrow(/channel/);
  });
});

describe('nextSeq', () => {
  it('increments and wraps at 16 bits', () => {
    expect(nextSeq(0)).toBe(1);
    expect(nextSeq(65535)).toBe(0);
  });
});
