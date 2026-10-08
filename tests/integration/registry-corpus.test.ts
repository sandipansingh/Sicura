import { it, expect } from 'vitest';
import { runRlsFixture } from '../../eval/harness/rls';
for (const id of Array.from({ length: 13 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`))
  it(`${id}: agrees with independent labels in a fresh pinned replica`, async () => {
    const result = await runRlsFixture(id);
    expect(result.failures).toEqual([]);
    expect(result.agreement).toBe(result.gold_testable);
    expect(result.correct_inconclusive).toBe(result.expected_inconclusive);
  });
