import { describe, expect, it } from 'vitest';

import { endStream, initialPlayback, scheduleChunk } from '../src/spike/jitter';

const JITTER = 0.16;
const CHUNK = 0.064;

describe('scheduleChunk', () => {
  it('primes the first chunk one jitter-buffer ahead of now', () => {
    const r = scheduleChunk(initialPlayback(), 10, CHUNK, JITTER);
    expect(r.startAt).toBeCloseTo(10.16, 6);
    expect(r.leadSec).toBeCloseTo(0.16, 6);
    expect(r.state.underruns).toBe(0);
  });

  it('chains following chunks back-to-back without gaps', () => {
    const first = scheduleChunk(initialPlayback(), 10, CHUNK, JITTER);
    const second = scheduleChunk(first.state, 10.064, CHUNK, JITTER);
    expect(second.startAt).toBeCloseTo(first.startAt + CHUNK, 9);
    expect(second.state.underruns).toBe(0);
  });

  it('counts an underrun and re-primes when the queue ran dry mid-stream', () => {
    const first = scheduleChunk(initialPlayback(), 10, CHUNK, JITTER);
    // next chunk arrives long after the first one finished playing (10.16 + 0.064)
    const late = scheduleChunk(first.state, 11, CHUNK, JITTER);
    expect(late.state.underruns).toBe(1);
    expect(late.startAt).toBeCloseTo(11.16, 6);
  });

  it('does not count an underrun after an explicit end of stream', () => {
    const first = scheduleChunk(initialPlayback(), 10, CHUNK, JITTER);
    const ended = endStream(first.state);
    const next = scheduleChunk(ended, 20, CHUNK, JITTER);
    expect(next.state.underruns).toBe(0);
    expect(next.startAt).toBeCloseTo(20.16, 6);
  });

  it('reports a growing lead when chunks arrive in a burst', () => {
    let state = initialPlayback();
    let lead = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = scheduleChunk(state, 10, CHUNK, JITTER);
      state = r.state;
      lead = r.leadSec;
    }
    expect(lead).toBeCloseTo(0.16 + 4 * CHUNK, 6);
    expect(state.maxLeadSec).toBeCloseTo(lead, 9);
  });

  it('keeps counts of scheduled chunks', () => {
    const r = scheduleChunk(
      scheduleChunk(initialPlayback(), 1, CHUNK, JITTER).state,
      1.01,
      CHUNK,
      JITTER,
    );
    expect(r.state.scheduled).toBe(2);
  });

  it('never mutates the previous state', () => {
    const before = initialPlayback();
    scheduleChunk(before, 5, CHUNK, JITTER);
    expect(before).toEqual(initialPlayback());
  });
});
