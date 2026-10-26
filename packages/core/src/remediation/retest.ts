import type {
  Expectation,
  MigrationPatch,
  RetestResult,
  Run,
  TestResult,
} from '../../../contracts/src/index';
import { withReplica } from '../replica/manager';
import { introspect } from '../rls/introspect';
import { runMatrix } from '../verification/run';
import { AppError } from '../errors';
import { hash } from '../hash';
import { parse, deparse } from 'pgsql-parser';
import { verifyPatchIntegrity } from './integrity';
import { quoteIdentifier, tableSql } from '../rls/introspect';

export function compareRetest(
  baseline: { run: Run; results: TestResult[] },
  after: { run: Run; results: TestResult[] },
): RetestResult {
  const identical =
    baseline.run.seed_digest === after.run.seed_digest &&
    baseline.run.claims_digest === after.run.claims_digest &&
    baseline.run.registry_version === after.run.registry_version &&
    hash(baseline.results.map((r) => r.scenario_key).sort()) ===
      hash(after.results.map((r) => r.scenario_key).sort());
  const regressions =
    after.results.every((r) => r.outcome === 'match') && after.run.status === 'complete';
  return {
    kind: 'rls',
    baseline_run_id: baseline.run.id,
    run_id: after.run.id,
    status: identical && regressions ? 'passed' : 'failed',
    identical_scenarios: identical,
    regressions_passed: regressions,
    failed_result_ids: after.results.filter((r) => r.outcome !== 'match').map((r) => r.id),
    scope: 'Recorded local replica scenarios; synthetic data and role simulation',
    completed_at: new Date().toISOString(),
  };
}
export async function retestPatch(
  sql: string,
  patch: MigrationPatch,
  baseline: { run: Run; results: TestResult[] },
  expectations: Expectation[],
  selectOnly = false,
  checkCancelled: () => void = () => {},
  profile: 'repository-v2' | 'repository-v3' = 'repository-v2',
): Promise<{ run: Run; results: TestResult[]; comparison: RetestResult }> {
  verifyPatchIntegrity(patch);
  if (
    patch.status !== 'approved' ||
    !patch.approval ||
    patch.approval.patch_digest !== patch.patch_digest ||
    patch.baseline_run_id !== baseline.run.id ||
    hash(expectations.map((e) => e.revision_id)) !== hash(patch.expectation_revision_ids)
  )
    throw new AppError('APPROVAL_REQUIRED', 409);
  return withReplica(async (replica) => {
    await replica.apply(sql);
    const before = await introspect(replica);
    if (before.digest !== patch.baseline_schema_digest) throw new AppError('BASELINE_DRIFT', 409);
    const ast = await parse(patch.migration_sql);
    if (ast.stmts.length !== 3 || !ast.stmts[1]?.stmt?.AlterPolicyStmt)
      throw new AppError('PATCH_SCOPE_INVALID');
    const expected = await parse(
      `ALTER POLICY ${quoteIdentifier(patch.policy_name!)} ON ${tableSql({ schema: patch.resource.schema, name: patch.resource.table })} USING ((SELECT auth.uid()) = ${quoteIdentifier(patch.owner_column!)});`,
    );
    const statement = await deparse({ version: ast.version, stmts: [ast.stmts[1]] });
    if (statement !== (await deparse(expected))) throw new AppError('PATCH_SCOPE_INVALID');
    checkCancelled();
    await replica.apply(statement);
    const snapshot = await introspect(replica);
    // A normalized diff may only change the selected USING expression.
    const restored = structuredClone(snapshot.tables);
    const original = before.tables.find(
      (t) => t.schema === patch.resource.schema && t.name === patch.resource.table,
    );
    const changed = restored
      .find((t) => t.schema === patch.resource.schema && t.name === patch.resource.table)
      ?.policies.find((p) => p.name === patch.policy_name);
    if (!original || !changed) throw new AppError('PATCH_SCOPE_INVALID');
    changed.using = original.policies.find((p) => p.name === patch.policy_name)!.using;
    if (hash(restored) !== hash(before.tables)) throw new AppError('PATCH_SCOPE_INVALID');
    const after = await runMatrix(
      replica,
      snapshot,
      expectations,
      patch.project_id,
      patch.input_revision,
      selectOnly,
      baseline.run,
      patch.patch_digest,
      checkCancelled,
    );
    return { ...after, comparison: compareRetest(baseline, after) };
  }, profile);
}
