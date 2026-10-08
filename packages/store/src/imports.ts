import { resolve } from 'node:path';
import { Store } from './index';
import { validate, type ImportSelection, type ImportStatus } from '../../contracts/src/index';
import { githubRepository, safeRef } from '../../core/src/repository/github';
import { emptyImportReport } from '../../core/src/repository/import';
import { redactValue } from '../../core/src/secrets/sink';
import { hash, newId } from '../../core/src/hash';
import { AppError } from '../../core/src/errors';

export function enqueueImport(
  store: Store,
  data: unknown,
  key: string,
  allowLocal = false,
): ImportStatus {
  const request = validate('ImportRequest', data);
  if (request.source.kind === 'local') {
    if (!allowLocal) throw new AppError('IMPORT_LOCAL_CLI_ONLY', 400);
    request.source.directory = resolve(request.source.directory);
  } else {
    request.source.url = githubRepository(request.source.url).url;
    if (request.source.ref !== null) safeRef(request.source.ref);
  }
  if (JSON.stringify(redactValue(request)) !== JSON.stringify(request))
    throw new AppError('IMPORT_METADATA_INVALID', 400);
  return store.transaction(() => {
    const identity = hash(request);
    const duplicates = store.jobs().filter((j) => j.kind === 'import');
    for (const job of duplicates) {
      const prior = store.jobPayload(job.id);
      const same = hash(prior.import_request) === identity;
      if (job.idempotency_key === key && !same)
        throw new AppError('IMPORT_IDEMPOTENCY_CONFLICT', 409);
      if (job.idempotency_key === key || (same && ['queued', 'running'].includes(job.status)))
        return validate('ImportStatus', { job, report: store.get('ImportReport', job.id) });
    }
    let project;
    if (request.retry_of) {
      const prior = store.job(request.retry_of);
      if (prior.kind !== 'import' || ['running', 'queued'].includes(prior.status))
        throw new AppError('IMPORT_RETRY_INVALID', 409);
      const report = store.get('ImportReport', prior.id);
      if (prior.status === 'succeeded' && report.rls.status === 'ready')
        throw new AppError('IMPORT_RETRY_INVALID', 409);
      if (
        report.provenance.kind !== request.source.kind ||
        (request.source.kind === 'github' && report.provenance.label !== request.source.url)
      )
        throw new AppError('IMPORT_RETRY_INVALID', 409);
      project = store.get('Project', prior.project_id);
      store.assertIdle(project.id);
      if (store.list('Run', project.id).length)
        throw new AppError('INPUT_REPLACEMENT_UNSUPPORTED', 409);
      project = validate('Project', {
        ...project,
        input_revision: project.input_revision + 1,
        expectation_set_revision: 0,
        admitted_schema_digest: null,
      });
    } else {
      const now = new Date().toISOString();
      project = validate('Project', {
        id: newId('project'),
        name:
          request.source.kind === 'github'
            ? 'Repository ' + githubRepository(request.source.url).repo
            : 'Local repository',
        input_revision: 1,
        expectation_set_revision: 0,
        admitted_schema_digest: null,
        created_at: now,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
    }
    store.saveProject(project);
    store.setInputs(
      project.id,
      validate('AdmittedInputs', {
        schema_sql: '',
        expectation_edits: [],
        manifest: [],
        credential_findings: [],
        credential_fingerprints: [],
        synthetic_demo: false,
      }),
    );
    const job = store.enqueue(project, 'import', 'intake', key, {
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: project.expectation_set_revision,
      import_request: request,
    });
    const report = emptyImportReport(project.id, job.id, request, project.input_revision);
    saveImportReport(store, report);
    return validate('ImportStatus', { job, report });
  });
}
export function retryImport(
  store: Store,
  job_id: string,
  selection: ImportSelection | null,
  key: string,
): ImportStatus {
  const request = store.jobPayload(job_id).import_request;
  if (!request) throw new AppError('IMPORT_RETRY_INVALID', 409);
  const report = store.get('ImportReport', job_id);
  if (request.source.kind === 'github' && report.provenance.commit)
    request.source.ref = report.provenance.commit;
  return enqueueImport(
    store,
    { ...request, selection: selection ?? request.selection, retry_of: job_id },
    key,
    true,
  );
}
export function saveImportReport(store: Store, report: ImportStatus['report']): void {
  const row = store.db
    .prepare('SELECT MAX(revision) AS revision FROM records WHERE kind=? AND id=?')
    .get('ImportReport', report.id) as { revision: number | null };
  store.put('ImportReport', report.id, report.project_id, report, (row.revision ?? 0) + 1);
}
