/** One decoded IAT result segment (the base64 JSON in payload.result.text). */
export interface IatSegment {
  readonly sn: number;
  readonly text: string;
  readonly pgs?: 'apd' | 'rpl';
  /** Inclusive sn range replaced when pgs === 'rpl'. */
  readonly rg?: readonly [number, number];
  readonly ls?: boolean;
}

interface Entry {
  readonly sn: number;
  readonly text: string;
}

/** Immutable accumulator for wpgs (dynamic correction) results. */
export interface MergeState {
  readonly entries: readonly Entry[];
}

export const emptyMergeState: MergeState = { entries: [] };

/**
 * apd: append the segment. rpl: drop every entry whose sn lies in `rg`, then
 * insert the segment at its own sn. A segment without `pgs` (wpgs off) appends.
 */
export function applySegment(state: MergeState, seg: IatSegment): MergeState {
  if (seg.pgs === 'rpl') {
    if (!seg.rg) throw new Error(`rpl segment sn=${seg.sn} has no rg`);
    const [from, to] = seg.rg;
    const kept = state.entries.filter((e) => e.sn < from || e.sn > to);
    return { entries: insertSorted(kept, { sn: seg.sn, text: seg.text }) };
  }
  return { entries: insertSorted(state.entries, { sn: seg.sn, text: seg.text }) };
}

function insertSorted(entries: readonly Entry[], entry: Entry): readonly Entry[] {
  const without = entries.filter((e) => e.sn !== entry.sn);
  return [...without, entry].sort((a, b) => a.sn - b.sn);
}

export function mergedText(state: MergeState): string {
  return state.entries.map((e) => e.text).join('');
}
