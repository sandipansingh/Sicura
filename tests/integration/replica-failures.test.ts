import { readFile } from 'node:fs/promises';
import { it, expect } from 'vitest';
import { validate, parseStrictJson } from '../../packages/contracts/src/index';
import { transitionFinding } from '../../packages/contracts/src/lifecycle';
import { withReplica } from '../../packages/core/src/replica/manager';
import { admitSql } from '../../packages/core/src/intake/admit';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../packages/core/src/rls/analyze';
import { runMatrix } from '../../packages/core/src/verification/run';
import { renderPatch, approvePatch } from '../../packages/core/src/remediation/render';
import { retestPatch } from '../../packages/core/src/remediation/retest';

it('rolls back an admitted schema that fails during apply without a partial table', async () => {
  const sql = await admitSql(
    'CREATE TABLE public.first_table(id uuid PRIMARY KEY); CREATE TABLE public.second_table(id uuid PRIMARY KEY, other_id uuid REFERENCES public.absent(id));',
  );
  await withReplica(async (r) => {
    await expect(r.apply(sql)).rejects.toMatchObject({ code: 'SCHEMA_APPLY_FAILED' });
    expect(
      (await r.setup.query('SELECT to_regclass($1) AS name', ['public.first_table'])).rows[0]?.name,
    ).toBeNull();
  });
});
it('runs a real reviewed patch but refuses fixed when allowed UPDATE regressions break', async () => {
  let source = await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8');
  source = source.replace(
    'FOR UPDATE TO authenticated\n  USING ((SELECT auth.uid()) = user_id)\n  WITH CHECK ((SELECT auth.uid()) = user_id)',
    'FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
  );
  const sql = await admitSql(source);
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile('eval/fixtures/rls/R-01/expectations.json', 'utf8'), 65536),
  );
  manifest.expectations.find(
    (e) =>
      e.resource.table === 'profiles' && e.actor === 'authenticated' && e.operation === 'UPDATE',
  )!.expected = 'all_rows';
  const before = await withReplica(async (r) => {
    await r.apply(sql);
    const snapshot = await introspect(r);
    const expectations = resolveExpectations(snapshot, manifest.expectations);
    const finding = (await analyzeRls(snapshot, expectations, 'regression')).find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!;
    const baseline = await runMatrix(r, snapshot, expectations, 'regression');
    const confirmed = transitionFinding(finding, {
      type: 'verification',
      run_id: baseline.run.id,
      current: true,
      results: baseline.results.filter((x) => x.expectation_id === finding.expectation!.id),
    });
    return { snapshot, expectations, baseline, finding: confirmed };
  });
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
  const after = await retestPatch(sql, patch, before.baseline, before.expectations);
  expect(after.comparison.identical_scenarios).toBe(true);
  expect(after.comparison.status).toBe('failed');
  expect(
    after.results.some(
      (r) => r.operation === 'UPDATE' && r.expected === 'allow' && r.outcome !== 'match',
    ),
  ).toBe(true);
  expect(
    transitionFinding(
      transitionFinding(before.finding, { type: 'patch_applied', approved: true }),
      { type: 'retest', approved: true, current: true, result: after.comparison },
    ).state,
  ).toBe('fix_not_verified');
});
