import { it, expect } from 'vitest';
import { frozenDataset } from '../../eval/harness/dataset';
import { runAdversarial } from '../../eval/harness/adversarial';
it('preserves the frozen dataset and rejects or contains every achieved adversarial fixture', async () => {
  const { manifest } = await frozenDataset();
  for (const id of manifest.suites.adversarial) {
    const result = await runAdversarial(id);
    expect(result.failures).toEqual([]);
    expect(result.counts.unsafe_actions).toBe(0);
    expect(result.counts.leaked_canaries).toBe(0);
  }
});
