import type { Expectation, Run, TestResult } from '../../../contracts/src/index';
import { validate } from '../../../contracts/src/index';
import type { SchemaSnapshot } from '../rls/introspect';
import type { Replica } from '../replica/manager';
import lock from '../../../../config/runtime-lock.json';
import { newId } from '../hash';
import { planSeeds } from './seed';
import { planMatrix, CLAIMS_DIGEST } from './registry';
import { executeScenario } from './execute';
import { prepareRepositorySeeds } from './repository-seed';

export async function runMatrix(
  replica: Replica,
  snapshot: SchemaSnapshot,
  expectations: Expectation[],
  project_id: string,
  input_revision = 1,
  selectOnly = false,
  baseline?: Run,
  patch_digest: string | null = null,
  checkCancelled: () => void = () => {},
): Promise<{ run: Run; results: TestResult[] }> {
  const plan =
    replica.profile === 'repository-v3'
      ? await prepareRepositorySeeds(replica, snapshot)
      : planSeeds(snapshot);
  const scenarios = planMatrix(expectations, plan, selectOnly);
  const run_id = newId('run');
  const results: TestResult[] = [];
  const started = Date.now();
  for (const scenario of scenarios) {
    checkCancelled();
    if (Date.now() - started > 300_000) scenario.reason = 'JOB_DEADLINE';
    results.push(await executeScenario(replica, plan, scenario, run_id, results));
  }
  const executed = results.filter((r) => r.role_assertion_passed).length;
  const run = validate('Run', {
    id: run_id,
    project_id,
    kind: baseline ? 'retest' : 'baseline',
    baseline_run_id: baseline?.id ?? null,
    status: results.every((r) => r.outcome !== 'inconclusive') ? 'complete' : 'partial',
    mode: 'postgres_role_simulation',
    schema_digest: snapshot.digest,
    patch_digest,
    seed_digest: plan.digest,
    registry_version: '1',
    harness_version: replica.profile === 'repository-v3' ? '2.0.0' : '1.0.0',
    ...(replica.profile === 'repository-v3'
      ? {
          replay_profile: replica.profile,
          bootstrap_version: 'supabase-database-v1',
          replay_sql_digest: snapshot.replay_sql_digest!,
        }
      : {}),
    postgres_version: snapshot.postgres_version,
    image_digest: lock.postgres_image,
    claims_digest: CLAIMS_DIGEST,
    expectation_revision_ids: expectations.map((e) => e.revision_id),
    input_revision,
    schema_snapshot_id: snapshot.id,
    coverage: {
      planned: results.length,
      executed,
      skipped: results.length - executed,
      errored: results.filter((r) => r.observed === 'error').length,
      not_testable: results.filter(
        (r) => r.outcome === 'inconclusive' && r.reason_code !== 'EXPECTATION_UNKNOWN',
      ).length,
    },
    fidelity_gaps: [
      'Synthetic data; local PostgreSQL role simulation',
      'JWT authentication, auth hooks and production application routes were not tested',
      replica.profile === 'repository-v3'
        ? 'Admitted database helpers/triggers/extensions were replayed; Storage HTTP, edge functions and arbitrary RPC endpoints were not tested'
        : 'No storage, edge functions, custom helpers or extensions tested',
    ],
    result_ids: results.map((r) => r.id),
    created_at: new Date().toISOString(),
  });
  return { run, results };
}
