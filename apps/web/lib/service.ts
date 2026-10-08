import { staticExpectations, staticFindings } from '../../../packages/core/src/rls/static-findings';
import {
  enqueueProjectAnalysis,
  enqueueAutomaticAnalysis,
} from '../../../packages/store/src/project-analysis';
import { Store } from '../../../packages/store/src/index';
import {
  validate,
  type ContractMap,
  type Project,
  type JobPayload,
} from '../../../packages/contracts/src/index';
import { admitInputs, checkInputLimits } from '../../../packages/core/src/intake/inputs';
import { AppError } from '../../../packages/core/src/errors';
import { hash, newId } from '../../../packages/core/src/hash';
import { redactText } from '../../../packages/core/src/secrets/redact';
import { resolveExpectations, tuple } from '../../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../../packages/core/src/rls/analyze';
import { renderPatch, approvePatch } from '../../../packages/core/src/remediation/render';
import { assertCompleteScope } from '../../../packages/core/src/secrets/rescan';

export const store = new Store();
const payload = (p: Project): JobPayload => ({
  finding_id: null,
  patch_id: null,
  expected_finding_revision: null,
  expectation_set_revision: p.expectation_set_revision,
});
export function view(id: string): ContractMap['ProjectView'] {
  // Keep findings and job status in one WAL snapshot so completion cannot
  // stop client polling while it still holds pre-commit findings.
  return store.db
    .transaction(() => {
      const project = store.get('Project', id);
      return validate('ProjectView', {
        project,
        findings: store
          .list('Finding', id)
          .filter((f) => f.input_revision === project.input_revision),
        expectations: store
          .list('Expectation', id)
          .filter((e) =>
            store.inputs(id).sql_analysis
              ? store
                  .inputs(id)
                  .sql_analysis!.tables.some(
                    (t) => t.schema === e.resource.schema && t.name === e.resource.table,
                  )
              : true,
          ),
        jobs: store.jobs(id),
        patches: store.list('MigrationPatch', id),
        runs: store.list('Run', id),
        snapshot: store.currentSnapshot(id),
        sql_analysis: project.input_revision ? (store.inputs(id).sql_analysis ?? null) : null,
        summary: store.list('ProjectSummary', id).at(-1) ?? null,
        input_manifest: project.input_revision ? store.inputs(id).manifest : [],
        imports: store.list('ImportReport', id),
      });
    })
    .deferred();
}
export function createProject(data: unknown): Project {
  const { name } = validate('CreateProjectRequest', data);
  const now = new Date().toISOString();
  const id = newId('project');
  const p = validate('Project', {
    id,
    name: redactText(name),
    input_revision: 0,
    expectation_set_revision: 0,
    admitted_schema_digest: null,
    created_at: now,
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
  });
  store.saveProject(p);
  return p;
}
export async function upload(
  id: string,
  data: unknown,
  key: string,
): Promise<ContractMap['JobEnvelope']> {
  const p = store.get('Project', id);
  const existing = store.jobs(id).find((j) => j.idempotency_key === key);
  if (existing) return { job: existing };
  store.assertIdle(id);
  if (p.input_revision > 0) throw new AppError('INPUT_REPLACEMENT_UNSUPPORTED', 409);
  checkInputLimits(data);
  const input = await admitInputs(
    validate('InputRequest', data),
    id,
    p.input_revision + 1,
    store.projectKey(id),
  );
  return store.transaction(() => {
    store.assertIdle(id);
    const latest = store.get('Project', id);
    if (latest.input_revision !== p.input_revision) throw new AppError('STALE_REVISION', 409);
    const updated = validate('Project', {
      ...p,
      input_revision: p.input_revision + 1,
      admitted_schema_digest: input.schema_sql ? hash(input.schema_sql) : null,
    });
    store.setInputs(id, input);
    store.saveProject(updated);
    input.credential_findings.forEach((f) => store.put('Finding', f.id, id, f, f.revision));
    input.credential_fingerprints.forEach((fp) =>
      store.put('CredentialFingerprint', fp.finding_id, id, fp),
    );
    return { job: store.enqueue(updated, 'scan', 'replica', key, payload(updated)) };
  });
}
export async function rescanCredentials(
  id: string,
  data: unknown,
  key: string,
): Promise<ContractMap['JobEnvelope']> {
  checkInputLimits(data);
  const request = validate('RescanRequest', data);
  const p = store.get('Project', id);
  const existing = store.jobs(id).find((j) => j.idempotency_key === key);
  if (existing) return { job: existing };
  store.assertIdle(id);
  if (request.expected_input_revision !== p.input_revision)
    throw new AppError('STALE_REVISION', 409);
  const previous = store.inputs(id);
  const admitted = await admitInputs(
    { files: request.files, sql_order: [], expectations: null },
    id,
    p.input_revision + 1,
    store.projectKey(id),
  );
  assertCompleteScope(previous, admitted.manifest, request.deleted_paths);
  return store.transaction(() => {
    store.assertIdle(id);
    if (store.get('Project', id).input_revision !== p.input_revision)
      throw new AppError('STALE_REVISION', 409);
    store.setInputs(id, {
      ...previous,
      manifest: [...previous.manifest.filter((f) => f.kind === 'sql'), ...admitted.manifest],
      credential_findings: [
        ...previous.credential_findings.filter(
          (f) =>
            f.location.kind === 'file' &&
            previous.manifest.some(
              (m) =>
                m.kind === 'sql' &&
                m.path === (f.location.kind === 'file' ? f.location.path : null),
            ),
        ),
        ...admitted.credential_findings,
      ],
      credential_fingerprints: [
        ...previous.credential_fingerprints.filter((fp) =>
          previous.credential_findings.some(
            (f) =>
              f.id === fp.finding_id &&
              f.location.kind === 'file' &&
              previous.manifest.some(
                (m) =>
                  m.kind === 'sql' &&
                  m.path === (f.location.kind === 'file' ? f.location.path : null),
              ),
          ),
        ),
        ...admitted.credential_fingerprints,
      ],
      ...(previous.sql_analysis
        ? { sql_analysis: { ...previous.sql_analysis, input_revision: p.input_revision + 1 } }
        : {}),
    });
    const updated = { ...p, input_revision: p.input_revision + 1 };
    store.saveProject(updated);
    return { job: store.enqueue(updated, 'rescan_credentials', 'analyze', key, payload(updated)) };
  });
}
export function verifyProject(id: string, data: unknown, key: string): ContractMap['JobEnvelope'] {
  const request = validate('VerifyRequest', data);
  const p = store.get('Project', id);
  if (
    request.input_revision !== p.input_revision ||
    hash(request.expectation_revision_ids) !== hash(view(id).expectations.map((e) => e.revision_id))
  )
    throw new AppError('STALE_REVISION', 409);
  if (!store.inputs(id).schema_sql) throw new AppError('SCHEMA_MISSING', 409);
  return store.transaction(() => ({ job: store.enqueue(p, 'verify', 'verify', key, payload(p)) }));
}
export function investigateFinding(
  id: string,
  data: unknown,
  key: string,
): ContractMap['JobEnvelope'] {
  const request = validate('InvestigateRequest', data);
  const f = store.get('Finding', id);
  const p = store.get('Project', f.project_id);
  if (f.revision !== request.expected_revision) throw new AppError('STALE_REVISION', 409);
  return store.transaction(() => ({
    job: store.enqueue(p, 'scan', 'investigate', key, {
      ...payload(p),
      finding_id: id,
      expected_finding_revision: f.revision,
    }),
  }));
}
export function proposePatch(id: string, data: unknown): ContractMap['MigrationPatch'] {
  const request = validate('PatchRequest', data);
  const f = store.get('Finding', id);
  store.assertIdle(f.project_id);
  if (f.revision !== request.expected_revision) throw new AppError('STALE_REVISION', 409);
  const snapshot = store.list('SchemaSnapshot', f.project_id).at(-1);
  if (!snapshot || !f.verification.latest_run_id) throw new AppError('BASELINE_MISSING', 409);
  const intent = f.ai_analysis.output?.remediation_intent;
  if (
    request.intent_index !== 0 ||
    (request.analysis_id &&
      (request.analysis_id !== f.ai_analysis.analysis_id ||
        !intent ||
        intent.template_id !== 'owner_select_v1' ||
        intent.owner_column !== f.expectation?.owner_column))
  )
    throw new AppError('PATCH_UNSUPPORTED');
  const patch = renderPatch(
    f,
    snapshot,
    store.get('Run', f.verification.latest_run_id),
    request.analysis_id ? 'gemma_intent' : 'deterministic_template',
  );
  if (request.analysis_id && intent?.policy_name !== patch.policy_name)
    throw new AppError('PATCH_UNSUPPORTED');
  store.transaction(() => {
    store.put('MigrationPatch', patch.id, f.project_id, patch);
    store.put(
      'Finding',
      f.id,
      f.project_id,
      validate('Finding', {
        ...f,
        revision: f.revision + 1,
        remediation: {
          status: 'proposed',
          patch_id: patch.id,
          patch_digest: patch.patch_digest,
          summary: patch.rationale,
          approved_by: null,
          approved_at: null,
        },
      }),
      f.revision + 1,
    );
  });
  return patch;
}
export function approve(id: string, data: unknown, key: string): ContractMap['JobEnvelope'] {
  return store.transaction(() => {
    const patch = store.get('MigrationPatch', id);
    const p = store.get('Project', patch.project_id);
    const f = store.get('Finding', patch.finding_id);
    const prior = store.jobs(p.id).find((j) => j.idempotency_key === key);
    if (prior) return { job: prior };
    store.assertIdle(p.id);
    if (
      f.remediation.patch_id !== id ||
      f.verification.latest_run_id !== patch.baseline_run_id ||
      hash(store.list('Expectation', p.id).map((e) => e.revision_id)) !==
        hash(patch.expectation_revision_ids) ||
      f.verification.stale ||
      patch.input_revision !== p.input_revision
    )
      throw new AppError('STALE_APPROVAL', 409);
    const approved = approvePatch(
      patch,
      validate('ApproveRequest', data),
      store.get('Run', patch.baseline_run_id),
    );
    store.put('MigrationPatch', id, p.id, approved, 2);
    const next = validate('Finding', {
      ...f,
      revision: f.revision + 1,
      remediation: {
        ...f.remediation,
        status: 'approved',
        approved_by: 'local_operator',
        approved_at: approved.approval!.approved_at,
      },
    });
    store.put('Finding', f.id, p.id, next, next.revision);
    return {
      job: store.enqueue(p, 'retest', 'retest', key, {
        ...payload(p),
        finding_id: f.id,
        patch_id: id,
        expected_finding_revision: next.revision,
      }),
    };
  });
}
export async function editExpectations(
  id: string,
  data: unknown,
): Promise<ContractMap['ProjectView']> {
  const request = validate('ExpectationUpdateRequest', data);
  const p = store.get('Project', id);
  store.assertIdle(id);
  if (p.expectation_set_revision !== request.expected_revision)
    throw new AppError('STALE_REVISION', 409);
  const snapshot = store.currentSnapshot(id);
  const analysis = store.inputs(id).sql_analysis;
  if (!snapshot && !analysis?.tables.length) throw new AppError('SNAPSHOT_MISSING', 409);
  const previous = store.list('Expectation', id);
  const current = snapshot
    ? resolveExpectations(snapshot, request.changes, previous, 'user')
    : staticExpectations(analysis!, request.changes, previous, id);
  const findings = snapshot
    ? await analyzeRls(snapshot, current, id, p.input_revision)
    : staticFindings(analysis!, current, id);
  store.transaction(() => {
    store.assertIdle(id);
    if (store.get('Project', id).expectation_set_revision !== p.expectation_set_revision)
      throw new AppError('STALE_REVISION', 409);
    const prior = store.list('Finding', id).filter((f) => f.category === 'RLS_MISCONFIGURATION');
    for (const e of current)
      if (!previous.some((old) => old.revision_id === e.revision_id))
        store.put('Expectation', e.id, id, e, e.revision);
    for (const f of findings) {
      const old = prior.find(
        (o) => o.expectation && tuple(o.expectation) === tuple(f.expectation!),
      );
      if (old) {
        if (old.expectation!.revision_id === f.expectation!.revision_id) continue;
        f.id = old.id;
        f.revision = old.revision + 1;
        f.verification.stale = true;
      }
      store.put('Finding', f.id, id, validate('Finding', f), f.revision);
    }
    for (const patch of store.list('MigrationPatch', id))
      if (patch.status !== 'superseded')
        store.put(
          'MigrationPatch',
          patch.id,
          id,
          validate('MigrationPatch', { ...patch, status: 'superseded' }),
          Date.now(),
        );
    store.saveProject({ ...p, expectation_set_revision: p.expectation_set_revision + 1 });
  });
  enqueueAutomaticAnalysis(store, id);
  return view(id);
}
export function investigateProject(
  id: string,
  data: unknown,
  key: string,
): ContractMap['JobEnvelope'] {
  const request = validate('ProjectInvestigateRequest', data),
    p = store.get('Project', id);
  if (
    request.input_revision !== p.input_revision ||
    request.expectation_set_revision !== p.expectation_set_revision
  )
    throw new AppError('STALE_REVISION', 409);
  return store.transaction(() => enqueueProjectAnalysis(store, id, key));
}
