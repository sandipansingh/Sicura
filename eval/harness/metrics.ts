import type { EvalCase, EvalCounts } from '../../packages/contracts/src/index';
export const counts = (): EvalCounts => ({
  tp: 0,
  fp: 0,
  fn: 0,
  tn: 0,
  gold_testable: 0,
  agreement: 0,
  expected_inconclusive: 0,
  correct_inconclusive: 0,
  response_attempts: 0,
  accepted_responses: 0,
  inspected_sinks: 0,
  leaked_canaries: 0,
  unsafe_actions: 0,
});
export function confusion(
  expected: boolean,
  actual: boolean,
): Pick<EvalCounts, 'tp' | 'fp' | 'fn' | 'tn'> {
  return {
    tp: Number(expected && actual),
    fp: Number(!expected && actual),
    fn: Number(expected && !actual),
    tn: Number(!expected && !actual),
  };
}
export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
export function totals(cases: EvalCase[]): EvalCounts {
  const sum = counts();
  for (const c of cases)
    for (const key of Object.keys(sum) as (keyof EvalCounts)[]) sum[key] += c.counts[key];
  return sum;
}
export function latency(values: number[]): {
  n: number;
  median: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    median: n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1]! : null,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}
