import { expect, it } from 'vitest';
import rls from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
import { badge } from '../../apps/web/components/state-copy';

it('keeps an intentionally-public suppression visible in the finding detail badge', () => {
  const finding = validate('Finding', {
    ...rls,
    state: 'suspected',
    expectation: {
      ...rls.expectation,
      expected: 'all_rows',
      owner_column: null,
      intentionally_public: true,
    },
    suppression: {
      reason: 'intentionally_public',
      rationale: 'Declared public SELECT access',
      actor_id: 'local_operator',
      expectation_revision: 1,
      created_at: rls.timestamps.created_at,
    },
    verification: {
      status: 'not_requested',
      latest_run_id: null,
      evidence: [],
      stale: false,
    },
  });
  expect(badge(finding)).toBe('Intentionally public — declared SELECT access');
  expect(badge({ ...finding, suppression: null })).toBe('Suspected');
});
