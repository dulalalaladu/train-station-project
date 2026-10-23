import { describe, expect, it } from 'vitest';
import { applySegment, emptyMergeState, mergedText, type IatSegment } from '../src/merger/wpgs-merger.ts';

const run = (segments: readonly IatSegment[]) =>
  mergedText(segments.reduce(applySegment, emptyMergeState));

describe('wpgs dynamic-correction merger', () => {
  it('appends apd segments in order', () => {
    expect(run([
      { sn: 1, text: '今天', pgs: 'apd' },
      { sn: 2, text: '天气', pgs: 'apd' },
    ])).toBe('今天天气');
  });

  it('replaces the rg range on rpl', () => {
    expect(run([
      { sn: 1, text: '今天', pgs: 'apd' },
      { sn: 2, text: '天气', pgs: 'apd' },
      { sn: 3, text: '今天天气', pgs: 'rpl', rg: [1, 2] },
      { sn: 4, text: '很好', pgs: 'apd' },
    ])).toBe('今天天气很好');
  });

  it('replaces only part of the history', () => {
    expect(run([
      { sn: 1, text: 'a', pgs: 'apd' },
      { sn: 2, text: 'b', pgs: 'apd' },
      { sn: 3, text: 'c', pgs: 'apd' },
      { sn: 4, text: 'BC', pgs: 'rpl', rg: [2, 3] },
    ])).toBe('aBC');
  });

  it('treats segments without pgs as appends (wpgs off)', () => {
    expect(run([{ sn: 1, text: 'x' }, { sn: 2, text: 'y' }])).toBe('xy');
  });

  it('a repeated sn overwrites rather than duplicates', () => {
    expect(run([{ sn: 1, text: 'a', pgs: 'apd' }, { sn: 1, text: 'b', pgs: 'apd' }])).toBe('b');
  });

  it('rejects rpl without rg', () => {
    expect(() => applySegment(emptyMergeState, { sn: 1, text: 'x', pgs: 'rpl' })).toThrow(/no rg/);
  });

  it('is immutable', () => {
    const s1 = applySegment(emptyMergeState, { sn: 1, text: 'a', pgs: 'apd' });
    applySegment(s1, { sn: 2, text: 'b', pgs: 'apd' });
    expect(mergedText(s1)).toBe('a');
    expect(emptyMergeState.entries).toHaveLength(0);
  });
});
