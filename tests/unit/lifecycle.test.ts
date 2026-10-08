import { expect, it } from 'vitest';
import fixture from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
import { transitionFinding, TRANSITIONS } from '../../packages/contracts/src/lifecycle';

it('guards every state and forbids suspected to fixed', () => {
  expect(Object.keys(TRANSITIONS)).toHaveLength(8);
  const f = validate('Finding', { ...fixture, state: 'suspected' });
  expect(() =>
    transitionFinding(f, {
      type: 'retest',
      approved: true,
      current: true,
      result: {
        kind: 'rls',
        baseline_run_id: 'before',
        run_id: 'after',
        status: 'passed',
        identical_scenarios: true,
        regressions_passed: true,
        failed_result_ids: [],
        scope: 'SELECT',
        completed_at: new Date().toISOString(),
      },
    }),
  ).toThrow('INVALID_TRANSITION');
});
it('requires approval and all retest gates', () => {
  const f = validate('Finding', fixture);
  expect(() => transitionFinding(f, { type: 'patch_applied', approved: false })).toThrow(
    'APPROVAL_REQUIRED',
  );
  const pending = transitionFinding(f, { type: 'patch_applied', approved: true });
  const result = {
    kind: 'rls' as const,
    baseline_run_id: 'before',
    run_id: 'after',
    status: 'passed' as const,
    identical_scenarios: true,
    regressions_passed: false,
    failed_result_ids: [],
    scope: 'SELECT',
    completed_at: new Date().toISOString(),
  };
  expect(
    transitionFinding(pending, { type: 'retest', approved: true, current: true, result }).state,
  ).toBe('fix_not_verified');
  expect(() =>
    transitionFinding(pending, { type: 'retest', approved: true, current: false, result }),
  ).toThrow();
  expect(
    transitionFinding(pending, {
      type: 'retest',
      approved: true,
      current: true,
      result: { ...result, regressions_passed: true },
    }).state,
  ).toBe('fixed');
});
it('does not erase confirmed evidence after infrastructure failure', () => {
  const f = validate('Finding', fixture);
  expect(transitionFinding(f, { type: 'infrastructure_failed' })).toEqual(f);
});
it('rejects AI state events and stale or missing controls', () => {
  const f = validate('Finding', { ...fixture, state: 'suspected' });
  const r = f.verification.evidence[0]!;
  expect(() =>
    transitionFinding(f, { type: 'verification', results: [r], run_id: r.run_id, current: true }),
  ).toThrow('POSITIVE_CONTROL_FAILED');
  expect(() =>
    transitionFinding(f, { type: 'verification', results: [r], run_id: r.run_id, current: false }),
  ).toThrow();
});
