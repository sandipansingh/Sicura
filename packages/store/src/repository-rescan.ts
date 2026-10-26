import { Store } from './index';
import { validate } from '../../contracts/src/index';
import { emptyImportReport } from '../../core/src/repository/import';
import { AppError } from '../../core/src/errors';

export function enqueueRepositoryRescan(store: Store, id: string, data: unknown, key: string) {
  const request = validate('ProjectInvestigateRequest', data),
    p = store.get('Project', id);
  const existing = store.jobs(id).find((j) => j.idempotency_key === key);
  if (existing) {
    if (
      existing.input_revision !== request.input_revision ||
      store.jobPayload(existing.id).expectation_set_revision !== request.expectation_set_revision
    )
      throw new AppError('IMPORT_IDEMPOTENCY_CONFLICT', 409);
    return { job: existing };
  }
  if (
    p.input_revision !== request.input_revision ||
    p.expectation_set_revision !== request.expectation_set_revision
  )
    throw new AppError('STALE_REVISION', 409);
  const prior = store
    .jobs(id)
    .findLast((j) => j.kind === 'import' || j.kind === 'rescan_repository');
  const source = prior ? store.jobPayload(prior.id).import_request : null;
  if (!source) throw new AppError('IMPORT_REQUEST_MISSING', 409);
  // Local filesystem paths come only from the CLI-owned original request.
  return store.transaction(() => {
    const job = store.enqueue(p, 'rescan_repository', 'intake', key, {
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: p.expectation_set_revision,
      import_request: { ...source, retry_of: null },
    });
    store.put(
      'ImportReport',
      job.id,
      id,
      emptyImportReport(id, job.id, source, p.input_revision + 1),
    );
    return { job };
  });
}
