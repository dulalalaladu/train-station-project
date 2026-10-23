import { describe, expect, it } from 'vitest';

import {
  addBytes,
  addSample,
  bytesPerSec,
  emptyRate,
  emptySeq,
  emptySent,
  emptyStats,
  meanOf,
  recordSent,
  resolveSent,
  trackSeq,
} from '../src/spike/stats';

describe('running stats', () => {
  it('starts empty with mean 0', () => {
    expect(emptyStats()).toEqual({ count: 0, sum: 0, min: 0, max: 0 });
    expect(meanOf(emptyStats())).toBe(0);
  });

  it('accumulates count, mean, min and max without mutating', () => {
    const s0 = emptyStats();
    const s1 = addSample(addSample(addSample(s0, 60), 70), 190);
    expect(s0.count).toBe(0);
    expect(s1).toEqual({ count: 3, sum: 320, min: 60, max: 190 });
    expect(meanOf(s1)).toBeCloseTo(106.667, 2);
  });
});

describe('rate window', () => {
  it('reports bytes per second over the window', () => {
    let rate = emptyRate(1000);
    rate = addBytes(rate, 100, 2000);
    rate = addBytes(rate, 500, 2000);
    expect(bytesPerSec(rate, 1000)).toBe(4000);
  });

  it('forgets samples older than the window', () => {
    let rate = emptyRate(1000);
    rate = addBytes(rate, 0, 5000);
    rate = addBytes(rate, 1500, 1000);
    expect(bytesPerSec(rate, 1500)).toBe(1000);
  });

  it('is 0 when nothing was sent recently', () => {
    expect(bytesPerSec(addBytes(emptyRate(1000), 0, 100), 5000)).toBe(0);
  });
});

describe('trackSeq', () => {
  const feed = (seqs: number[]) => seqs.reduce(trackSeq, emptySeq());

  it('counts in-order frames with no loss', () => {
    expect(feed([1, 2, 3])).toMatchObject({ received: 3, lost: 0, duplicate: 0, reordered: 0 });
  });

  it('counts gaps as lost frames', () => {
    expect(feed([1, 2, 5])).toMatchObject({ received: 3, lost: 2 });
  });

  it('handles u16 wrap-around', () => {
    expect(feed([65534, 65535, 0, 1])).toMatchObject({ received: 4, lost: 0 });
  });

  it('flags duplicates and late (reordered) frames', () => {
    expect(feed([1, 2, 2])).toMatchObject({ duplicate: 1 });
    const late = feed([1, 2, 4, 3]);
    expect(late.reordered).toBe(1);
    // the late frame did arrive, so it no longer counts as lost
    expect(late.lost).toBe(0);
  });
});

describe('round-trip tracker', () => {
  it('resolves the rtt of a sent frame once', () => {
    const sent = recordSent(emptySent(), 7, 1000);
    const hit = resolveSent(sent, 7, 1180);
    expect(hit.rtt).toBe(180);
    expect(resolveSent(hit.pending, 7, 1200).rtt).toBeUndefined();
  });

  it('returns undefined for frames that were never sent', () => {
    expect(resolveSent(emptySent(), 3, 10).rtt).toBeUndefined();
  });

  it('bounds memory by evicting the oldest entries', () => {
    let sent = emptySent();
    for (let i = 0; i < 400; i += 1) sent = recordSent(sent, i, i);
    expect(sent.size).toBeLessThanOrEqual(256);
    expect(resolveSent(sent, 0, 500).rtt).toBeUndefined();
    expect(resolveSent(sent, 399, 500).rtt).toBe(101);
  });
});
