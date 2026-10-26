import { readFile } from 'node:fs/promises';
import {
  validate,
  parseStrictJson,
  type RlsFixtureLabels,
  type RlsFixtureResult,
  type TestResult,
} from '../../packages/contracts/src/index';
import { admitSql } from '../../packages/core/src/intake/admit';
import { withReplica } from '../../packages/core/src/replica/manager';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../packages/core/src/rls/analyze';
import { runMatrix } from '../../packages/core/src/verification/run';

const resourceKey = (r: TestResult) =>
  `${r.resource.table}:${r.actor === 'anon' ? 'anon' : 'authenticated'}:${r.operation}`;
/** Independent labels describe database semantics, not analyzer output or Gemma. */
function goldObservation(r: TestResult, gold: RlsFixtureLabels['gold']): TestResult['observed'] {
  if (gold.unknown_all) return 'not_run';
  if (
    gold.inferred_select &&
    !(r.resource.table === 'profiles' && r.actor !== 'anon' && r.operation === 'SELECT')
  )
    return 'not_run';
  if (
    gold.broken_controls &&
    r.resource.table === 'profiles' &&
    r.actor !== 'anon' &&
    ['SELECT', 'UPDATE', 'DELETE'].includes(r.operation)
  )
    return r.test_id === 'rls.own_row_access.v1' ? 'deny' : 'not_run';
  if (r.resource.table === 'posts') return r.operation === 'SELECT' ? 'allow' : 'deny';
  if (r.actor === 'anon') return gold.profiles_all_anon ?? 'deny';
  if (gold.profiles_all_auth) return gold.profiles_all_auth;
  const observations: Partial<Record<TestResult['test_id'], 'allow' | 'deny'>> = {
    'rls.cross_user_read.v1': gold.cross_read ?? 'deny',
    'rls.cross_user_delete.v1': gold.cross_delete ?? 'deny',
    'rls.insert_as_other.v1': gold.foreign_insert ?? 'deny',
    'rls.reassign_owner.v1': gold.reassign ?? 'deny',
    'rls.cross_user_update.v1': 'deny',
    'rls.own_row_access.v1': 'allow',
  };
  return observations[r.test_id] ?? 'deny';
}
export async function runRlsFixture(id: string): Promise<RlsFixtureResult> {
  if (!/^R-\d{2}$/.test(id)) throw new Error('EVAL_FIXTURE_INVALID');
  const started = performance.now();
  const path = `eval/fixtures/rls/${id}`;
  const labels = validate(
    'RlsFixtureLabels',
    parseStrictJson(await readFile(`${path}/labels.json`, 'utf8'), 65536),
  );
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile(`${path}/expectations.json`, 'utf8'), 65536),
  );
  const sql = await admitSql(await readFile(`${path}/schema.sql`, 'utf8'));
  return withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica, id);
    const expectations = resolveExpectations(snapshot, manifest.expectations, [], 'manifest', id);
    const findings = await analyzeRls(snapshot, expectations, id);
    const baseline = await runMatrix(replica, snapshot, expectations, id);
    let gold_testable = 0,
      agreement = 0,
      expected_inconclusive = 0,
      correct_inconclusive = 0,
      tp = 0,
      fp = 0,
      fn = 0,
      tn = 0;
    const failures: string[] = [];
    for (const result of baseline.results) {
      const expected = goldObservation(result, labels.gold);
      if (expected === 'not_run') {
        expected_inconclusive++;
        if (result.observed === 'not_run' && result.outcome === 'inconclusive')
          correct_inconclusive++;
      } else {
        gold_testable++;
        if (result.observed === expected && result.outcome !== 'inconclusive') agreement++;
      }
      if (result.observed !== expected)
        failures.push(
          `${result.test_id}:${result.actor}:${result.resource.table}:${result.operation}: gold ${expected}, observed ${result.observed}`,
        );
    }
    for (const e of expectations) {
      const key = `${e.resource.table}:${e.actor}:${e.operation}`;
      const actual = baseline.results.some(
        (r) =>
          resourceKey(r) === key &&
          r.expected === 'deny' &&
          r.observed === 'allow' &&
          r.outcome === 'mismatch',
      );
      const gold = labels.gold.vulnerability.includes(key);
      if (actual && gold) tp++;
      else if (actual) fp++;
      else if (gold) fn++;
      else tn++;
      if (actual !== gold) failures.push(`${key}: gold vulnerability ${gold}, mismatch ${actual}`);
    }
    const static_rules_found = labels.gold.rules.filter((rule) =>
      findings.some((f) => f.source.rule_ids.includes(rule)),
    ).length;
    if (static_rules_found !== labels.gold.rules.length)
      failures.push('Missing required static rule');
    if (
      labels.gold.public_suppressed &&
      findings
        .filter(
          (f) => f.expectation?.resource.table === 'posts' && f.expectation.operation === 'SELECT',
        )
        .some((f) => f.suppression?.reason !== 'intentionally_public')
    )
      failures.push('Public SELECT suppression missing');
    if (labels.gold.unknown_all && findings.some((f) => f.state !== 'needs_expectation'))
      failures.push('Unknown intent state changed');
    if (labels.gold.inferred_select && !findings.some((f) => f.expectation?.source === 'inferred'))
      failures.push('Inferred qualifier missing');
    return validate('RlsFixtureResult', {
      id,
      duration_ms: performance.now() - started,
      failures,
      gold_testable,
      agreement,
      expected_inconclusive,
      correct_inconclusive,
      tp,
      fp,
      fn,
      tn,
      static_rules_required: labels.gold.rules.length,
      static_rules_found,
      run: baseline.run,
      results: baseline.results,
    });
  });
}
