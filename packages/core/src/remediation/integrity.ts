import { validate, type MigrationPatch } from '../../../contracts/src/index';
import { hash } from '../hash';
import { AppError } from '../errors';
export function patchDigest(
  p: Pick<
    MigrationPatch,
    | 'migration_sql'
    | 'resource'
    | 'baseline_schema_digest'
    | 'expectation_revision_ids'
    | 'template_id'
  >,
): string {
  return hash({
    migration_sql: p.migration_sql,
    resource: p.resource,
    baseline_schema_digest: p.baseline_schema_digest,
    expectation_revision_ids: p.expectation_revision_ids,
    template_id: p.template_id,
  });
}
export function verifyPatchIntegrity(p: MigrationPatch): void {
  validate('MigrationPatch', p);
  if (p.patch_digest !== patchDigest(p)) throw new AppError('PATCH_DIGEST_INVALID', 409);
  if (
    p.approval &&
    (p.approval.patch_digest !== p.patch_digest ||
      p.approval.baseline_schema_digest !== p.baseline_schema_digest ||
      hash(p.approval.expectation_revision_ids) !== hash(p.expectation_revision_ids))
  )
    throw new AppError('STALE_APPROVAL', 409);
}
