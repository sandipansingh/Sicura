import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validate, parseStrictJson } from '../packages/contracts/src/index';
import { transitionFinding } from '../packages/contracts/src/lifecycle';
import { withReplica } from '../packages/core/src/replica/manager';
import { admitSql } from '../packages/core/src/intake/admit';
import { introspect } from '../packages/core/src/rls/introspect';
import { analyzeRls } from '../packages/core/src/rls/analyze';
import { resolveExpectations } from '../packages/core/src/expectations/resolve';
import { planSeeds, restoreSeeds } from '../packages/core/src/verification/seed';
import { runMatrix } from '../packages/core/src/verification/run';
import { renderPatch, approvePatch } from '../packages/core/src/remediation/render';
import { retestPatch } from '../packages/core/src/remediation/retest';
import { errorCode } from '../packages/core/src/errors';

let stage = 'admit';
async function smoke() {
  const sql = await admitSql(await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'));
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile('eval/fixtures/rls/R-01/expectations.json', 'utf8'), 65536),
  );
  const before = await withReplica(async (replica) => {
    await replica.apply(sql);
    stage = 'introspect';
    const snapshot = await introspect(replica);
    assert.equal(snapshot.tables.length, 2);
    console.log('PASS introspect');
    stage = 'seed';
    const plan = planSeeds(snapshot);
    await restoreSeeds(replica, plan);
    assert.equal(plan.tables.length, 2);
    console.log('PASS seed');
    stage = 'analyze';
    const expectations = resolveExpectations(snapshot, manifest.expectations);
    const findings = await analyzeRls(snapshot, expectations, 'smoke');
    const finding = findings.find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!;
    assert(finding.evidence.rule_ids.includes('RLS-002'));
    console.log('PASS analyze');
    stage = 'hypothesis';
    assert.equal(finding.attack_hypothesis?.test_id, 'rls.cross_user_read.v1');
    console.log('PASS hypothesis (deterministic)');
    stage = 'verify';
    const baseline = await runMatrix(replica, snapshot, expectations, 'smoke');
    assert.equal(baseline.run.status, 'complete');
    assert.equal(baseline.results.filter((r) => r.resource.table === 'profiles').length, 22);
    const confirmed = transitionFinding(finding, {
      type: 'verification',
      run_id: baseline.run.id,
      results: baseline.results.filter((r) => r.expectation_id === finding.expectation!.id),
      current: true,
    });
    assert.equal(confirmed.state, 'confirmed');
    console.log('PASS verify (real replica, 22 profile cases)');
    return { snapshot, expectations, baseline, finding: confirmed };
  });
  stage = 'approve';
  const proposed = renderPatch(before.finding, before.snapshot, before.baseline.run);
  const patch = approvePatch(
    proposed,
    {
      patch_digest: proposed.patch_digest,
      baseline_digest: proposed.baseline_schema_digest,
      expectation_revision_ids: proposed.expectation_revision_ids,
    },
    before.baseline.run,
  );
  console.log('PASS approve (synthetic smoke approval)');
  stage = 'apply/retest';
  const after = await retestPatch(sql, patch, before.baseline, before.expectations);
  console.log('PASS apply');
  assert.equal(after.comparison.status, 'passed');
  const pending = transitionFinding(before.finding, { type: 'patch_applied', approved: true });
  const fixed = transitionFinding(pending, {
    type: 'retest',
    approved: true,
    current: true,
    result: after.comparison,
  });
  assert.equal(fixed.state, 'fixed');
  console.log('PASS retest (identical scenarios and all regressions)');
}
smoke().catch((e) => {
  console.error(`FAIL ${stage} ${errorCode(e)}`);
  process.exitCode = 1;
});
