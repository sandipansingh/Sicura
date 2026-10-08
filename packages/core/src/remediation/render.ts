import type { Finding, MigrationPatch, Run, ApproveRequest } from '../../../contracts/src/index';
import { validate } from '../../../contracts/src/index';
import type { SchemaSnapshot } from '../rls/introspect';
import { quoteIdentifier, tableSql } from '../rls/introspect';
import { hash, newId } from '../hash';
import { AppError } from '../errors';
import { verifyPatchIntegrity } from './integrity';

export function renderPatch(
  finding: Finding,
  snapshot: SchemaSnapshot,
  baseline: Run,
  origin: MigrationPatch['origin'] = 'deterministic_template',
): MigrationPatch {
  validate('Run', baseline);
  const e = finding.expectation;
  if (
    finding.state !== 'confirmed' ||
    finding.verification.stale ||
    !e ||
    e.operation !== 'SELECT' ||
    e.expected !== 'own_rows_only' ||
    e.actor !== 'authenticated' ||
    !e.owner_column
  )
    throw new AppError('PATCH_UNSUPPORTED');
  const table = snapshot.tables.find(
    (t) => t.schema === e.resource.schema && t.name === e.resource.table,
  );
  if (
    !table ||
    !table.rls_enabled ||
    !table.columns.some((c) => c.name === e.owner_column && c.type === 'uuid')
  )
    throw new AppError('PATCH_UNSUPPORTED');
  const applicable = table.policies.filter(
    (p) =>
      (p.command === 'SELECT' || p.command === 'ALL') &&
      (p.roles.includes('authenticated') || p.roles.includes('public')),
  );
  const permissive = applicable.filter((p) => p.permissive);
  const policy = permissive[0];
  if (
    permissive.length !== 1 ||
    !policy ||
    policy.command !== 'SELECT' ||
    policy.roles.length !== 1 ||
    policy.roles[0] !== 'authenticated'
  )
    throw new AppError('PATCH_UNSUPPORTED');
  const migration_sql = `-- Review in your project workflow; this application applies only to a disposable replica.\n-- Baseline run: ${baseline.id}\n-- Baseline schema digest: ${baseline.schema_digest}\n-- Expectation revisions: ${baseline.expectation_revision_ids.join(', ')}\n-- Preconditions: current confirmed baseline; single authenticated permissive SELECT policy; unchanged schema and expectations.\nBEGIN;\nALTER POLICY ${quoteIdentifier(policy.name)} ON ${tableSql(table)}\n  USING ((SELECT auth.uid()) = ${quoteIdentifier(e.owner_column)});\nCOMMIT;\n`;
  const metadata = {
    migration_sql,
    resource: e.resource,
    baseline_schema_digest: baseline.schema_digest,
    expectation_revision_ids: baseline.expectation_revision_ids,
    template_id: 'owner_select_v1',
  };
  return validate('MigrationPatch', {
    schema_version: '1.0',
    id: newId('patch'),
    finding_id: finding.id,
    project_id: finding.project_id,
    input_revision: finding.input_revision,
    baseline_run_id: baseline.id,
    baseline_schema_digest: baseline.schema_digest,
    expectation_revision_ids: baseline.expectation_revision_ids,
    template_id: 'owner_select_v1',
    resource: e.resource,
    policy_name: policy.name,
    owner_column: e.owner_column,
    migration_sql,
    patch_digest: hash(metadata),
    preconditions: [
      'Current confirmed baseline',
      'Single authenticated permissive SELECT policy',
      'Frozen expectation and schema revisions',
    ],
    rationale: 'Restrict the existing permissive policy to the established owner binding',
    risks: [
      'The replica scenarios do not establish production behavior',
      'Synthetic rows do not exercise every business predicate',
    ],
    origin,
    status: 'proposed',
    approval: null,
    created_at: new Date().toISOString(),
  });
}
export function approvePatch(
  patch: MigrationPatch,
  request: ApproveRequest,
  current: Run,
): MigrationPatch {
  validate('ApproveRequest', request);
  verifyPatchIntegrity(patch);
  if (
    patch.status !== 'proposed' ||
    request.patch_digest !== patch.patch_digest ||
    request.baseline_digest !== patch.baseline_schema_digest ||
    current.id !== patch.baseline_run_id ||
    current.schema_digest !== patch.baseline_schema_digest ||
    hash(request.expectation_revision_ids) !== hash(patch.expectation_revision_ids) ||
    hash(current.expectation_revision_ids) !== hash(patch.expectation_revision_ids)
  )
    throw new AppError('STALE_APPROVAL', 409);
  return validate('MigrationPatch', {
    ...patch,
    status: 'approved',
    approval: {
      actor_id: 'local_operator',
      approved_at: new Date().toISOString(),
      patch_digest: patch.patch_digest,
      baseline_schema_digest: patch.baseline_schema_digest,
      expectation_revision_ids: patch.expectation_revision_ids,
    },
  });
}
