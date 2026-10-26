import { expect, it } from 'vitest';
import patchFixture from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
import { verifyPatchIntegrity } from '../../packages/core/src/remediation/integrity';
import { hash } from '../../packages/core/src/hash';
it('rejects altered SQL, baseline, expectations and approval bindings before apply', () => {
  const f = validate('Finding', patchFixture);
  const metadata = {
    migration_sql:
      'BEGIN;\nALTER POLICY "profiles_select" ON "public"."profiles" USING ((SELECT auth.uid()) = "user_id");\nCOMMIT;\n',
    resource: f.expectation!.resource,
    baseline_schema_digest: 'a'.repeat(64),
    expectation_revision_ids: ['exp_r1'],
    template_id: 'owner_select_v1' as const,
  };
  const patch = validate('MigrationPatch', {
    ...metadata,
    schema_version: '1.0',
    id: 'patch',
    finding_id: f.id,
    project_id: f.project_id,
    input_revision: 1,
    baseline_run_id: 'run',
    policy_name: 'profiles_select',
    owner_column: 'user_id',
    patch_digest: hash(metadata),
    preconditions: [],
    rationale: 'test',
    risks: [],
    origin: 'deterministic_template',
    status: 'approved',
    approval: {
      actor_id: 'operator',
      approved_at: new Date().toISOString(),
      patch_digest: hash(metadata),
      baseline_schema_digest: metadata.baseline_schema_digest,
      expectation_revision_ids: metadata.expectation_revision_ids,
    },
    created_at: new Date().toISOString(),
  });
  expect(() => verifyPatchIntegrity(patch)).not.toThrow();
  expect(() =>
    verifyPatchIntegrity({ ...patch, migration_sql: patch.migration_sql.replace('user_id', 'id') }),
  ).toThrow('PATCH_DIGEST_INVALID');
  expect(() =>
    verifyPatchIntegrity({
      ...patch,
      approval: { ...patch.approval!, baseline_schema_digest: 'b'.repeat(64) },
    }),
  ).toThrow('STALE_APPROVAL');
});
