export interface LatencySummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

/** Nearest-rank percentile on a non-empty sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

export function summarize(values: readonly number[]): LatencySummary {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
