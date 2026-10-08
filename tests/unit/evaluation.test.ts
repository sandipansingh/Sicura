import { expect, it } from 'vitest';
import { ratio, confusion, latency } from '../../eval/harness/metrics';
import { runDetector, runContext } from '../../eval/harness/credentials';
import { runAdversarial } from '../../eval/harness/adversarial';
it('reports zero denominators honestly and counts FP/FN independently', () => {
  expect(ratio(0, 0)).toBeNull();
  expect(confusion(true, false).fn).toBe(1);
  expect(confusion(false, true).fp).toBe(1);
  expect(latency([4, 1, 2, 3])).toEqual({ n: 4, median: 2.5, p95: 4, min: 1, max: 4 });
});
it('agrees with the independent synthetic detector/context labels', async () => {
  for (let i = 1; i <= 12; i++)
    expect((await runDetector(`CD-${String(i).padStart(2, '0')}`)).failures).toEqual([]);
  for (let i = 1; i <= 20; i++)
    expect((await runContext(`CC-${String(i).padStart(2, '0')}`)).failures).toEqual([]);
});
it('rejects oversized input with the stable limit code before analysis', async () => {
  expect((await runAdversarial('ADV-08')).failures).toEqual([]);
});
