import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
import { transitionFinding } from '../../packages/contracts/src/lifecycle';
import { withReplica } from '../../packages/core/src/replica/manager';
import { admitSql } from '../../packages/core/src/intake/admit';
import { introspect } from '../../packages/core/src/rls/introspect';
import { analyzeRls } from '../../packages/core/src/rls/analyze';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { runMatrix } from '../../packages/core/src/verification/run';
import { renderPatch, approvePatch } from '../../packages/core/src/remediation/render';
import { retestPatch, compareRetest } from '../../packages/core/src/remediation/retest';

it('reproduces real low-privilege access, approves an exact patch, and passes identical full retest', async () => {
  const sql = await admitSql(await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'));
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile('eval/fixtures/rls/R-01/expectations.json', 'utf8'), 65536),
  );
  const before = await withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica);
    expect(snapshot.tables[0]!.policies[0]!.roles).toBeInstanceOf(Array);
    const expectations = resolveExpectations(snapshot, manifest.expectations);
    const finding = (await analyzeRls(snapshot, expectations, 'integration')).find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!;
    const baseline = await runMatrix(replica, snapshot, expectations, 'integration');
    expect(baseline.run.status).toBe('complete');
    expect(baseline.results.filter((r) => r.resource.table === 'profiles')).toHaveLength(22);
    expect(
      baseline.results
        .filter((r) => r.test_id === 'rls.cross_user_read.v1' && r.resource.table === 'profiles')
        .map((r) => r.observed),
    ).toEqual(['allow', 'allow']);
    expect(
      baseline.results.every((r) => r.role_assertion_passed && r.target_existence_passed),
    ).toBe(true);
    const confirmed = transitionFinding(finding, {
      type: 'verification',
      run_id: baseline.run.id,
      results: baseline.results.filter((r) => r.expectation_id === finding.expectation!.id),
      current: true,
    });
    expect(confirmed.state).toBe('confirmed');
    const p = await replica.connectVerifier();
    await expect(p.query('SET ROLE schema_loader')).rejects.toMatchObject({ code: '42501' });
    await p.end();
    return { snapshot, expectations, finding: confirmed, baseline };
  });
  const proposed = renderPatch(before.finding, before.snapshot, before.baseline.run);
  expect(proposed.migration_sql).toContain(
    '-- Baseline schema digest: ' + before.baseline.run.schema_digest,
  );
  expect(proposed.migration_sql).toContain(
    '-- Expectation revisions: ' + before.baseline.run.expectation_revision_ids.join(', '),
  );
  expect(() =>
    approvePatch(
      proposed,
      {
        patch_digest: 'a'.repeat(64),
        baseline_digest: proposed.baseline_schema_digest,
        expectation_revision_ids: proposed.expectation_revision_ids,
      },
      before.baseline.run,
    ),
  ).toThrow('STALE_APPROVAL');
  const approved = approvePatch(
    proposed,
    {
      patch_digest: proposed.patch_digest,
      baseline_digest: proposed.baseline_schema_digest,
      expectation_revision_ids: proposed.expectation_revision_ids,
    },
    before.baseline.run,
  );
  const after = await retestPatch(sql, approved, before.baseline, before.expectations);
  expect(after.comparison.status).toBe('passed');
  expect(after.run.status).toBe('complete');
  expect(
    after.results.filter((r) => r.test_id === 'rls.cross_user_read.v1').map((r) => r.observed),
  ).toEqual(['deny', 'deny']);
  const broken = structuredClone(after);
  const control = broken.results.find(
    (r) => r.test_id === 'rls.own_row_access.v1' && r.expected === 'allow',
  )!;
  control.observed = 'deny';
  control.outcome = 'mismatch';
  control.denial_mechanism = 'rls_filter';
  expect(compareRetest(before.baseline, broken).status).toBe('failed');
});
