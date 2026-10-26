import type { Finding, FindingState, RetestResult, TestResult } from './generated';
import { validate } from './index';

export const TRANSITIONS: Record<FindingState, readonly FindingState[]> = {
  needs_expectation: ['suspected', 'blocked'],
  suspected: ['confirmed', 'not_reproduced', 'blocked', 'not_testable'],
  confirmed: ['fix_not_verified'],
  not_reproduced: ['confirmed', 'blocked', 'not_testable'],
  blocked: ['suspected', 'needs_expectation', 'confirmed', 'not_reproduced', 'not_testable'],
  not_testable: ['suspected', 'needs_expectation', 'confirmed', 'not_reproduced', 'blocked'],
  fixed: ['confirmed'],
  fix_not_verified: ['fixed'],
};
export type FindingEvent =
  | {
      type: 'verification';
      results: TestResult[];
      control_results?: TestResult[];
      run_id: string;
      current: boolean;
    }
  | { type: 'infrastructure_failed' }
  | { type: 'unsupported' }
  | { type: 'prerequisites_repaired' }
  | { type: 'patch_applied'; approved: boolean }
  | { type: 'retest'; result: RetestResult; approved: boolean; current: boolean }
  | { type: 'static_exposure'; established: boolean };

export function transitionFinding(finding: Finding, event: FindingEvent): Finding {
  const f = structuredClone(finding);
  let next = f.state;
  if (event.type === 'verification') {
    if (
      f.category !== 'RLS_MISCONFIGURATION' ||
      !event.current ||
      !f.expectation ||
      f.expectation.source === 'unknown'
    )
      throw new Error('INVALID_TRANSITION');
    event.results.forEach((r) => {
      validate('TestResult', r);
      if (
        r.run_id !== event.run_id ||
        r.expectation_id !== f.expectation?.id ||
        r.expectation_revision !== f.expectation?.revision
      )
        throw new Error('STALE_REVISION');
    });
    f.verification = {
      status: 'complete',
      latest_run_id: event.run_id,
      evidence: event.results,
      stale: false,
    };
    const controlsValid = event.results
      .filter((r) => r.outcome !== 'inconclusive')
      .every((r) =>
        r.control_result_ids.every((id) =>
          (event.control_results ?? event.results).some(
            (control) =>
              control.id === id &&
              control.run_id === event.run_id &&
              control.actor === r.actor &&
              control.resource.schema === r.resource.schema &&
              control.resource.table === r.resource.table &&
              control.expected === 'allow' &&
              control.observed === 'allow' &&
              control.outcome === 'match',
          ),
        ),
      );
    if (!controlsValid) throw new Error('POSITIVE_CONTROL_FAILED');
    if (
      event.results.some(
        (r) => r.expected === 'deny' && r.observed === 'allow' && r.outcome === 'mismatch',
      )
    )
      next = 'confirmed';
    else if (
      event.results.length &&
      event.results.every((r) => r.outcome === 'match') &&
      event.results.some((r) => r.expected === 'deny')
    )
      next = 'not_reproduced';
    else next = 'not_testable';
  } else if (event.type === 'infrastructure_failed') {
    if (f.state === 'confirmed' || f.state === 'fixed' || f.state === 'fix_not_verified') return f;
    next = 'blocked';
  } else if (event.type === 'unsupported') next = 'not_testable';
  else if (event.type === 'prerequisites_repaired')
    next = f.expectation?.source === 'unknown' ? 'needs_expectation' : 'suspected';
  else if (event.type === 'patch_applied') {
    if (!event.approved) throw new Error('APPROVAL_REQUIRED');
    next = 'fix_not_verified';
  } else if (event.type === 'retest') {
    if (!event.approved || !event.current) throw new Error('INVALID_TRANSITION');
    f.retest_result = event.result;
    next =
      event.result.status === 'passed' &&
      event.result.identical_scenarios &&
      event.result.regressions_passed
        ? 'fixed'
        : 'fix_not_verified';
  } else if (event.type === 'static_exposure') {
    if (f.category !== 'CREDENTIAL_EXPOSURE' || !event.established)
      throw new Error('INVALID_TRANSITION');
    next = 'confirmed';
  }
  if (next !== f.state && !TRANSITIONS[f.state].includes(next))
    throw new Error('INVALID_TRANSITION');
  f.state = next;
  f.revision++;
  f.timestamps.updated_at = new Date().toISOString();
  if (next === 'confirmed') f.timestamps.confirmed_at = f.timestamps.updated_at;
  if (next === 'fixed') f.timestamps.fixed_at = f.timestamps.updated_at;
  return validate('Finding', f);
}
