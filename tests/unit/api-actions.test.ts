import { afterAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
import { hash } from '../../packages/core/src/hash';
const directory = await mkdtemp(join(tmpdir(), 'proofsec-export-'));
process.env.PROOFSEC_DATA_DIR = directory;
const { store, createProject } = await import('../../apps/web/lib/service');
const { handle } = await import('../../apps/web/lib/api');
const finding = validate('Finding', fixture);
store.put('Finding', finding.id, finding.project_id, finding, finding.revision);
const session = await handle(
  new Request('http://127.0.0.1:3000/api/session', { headers: { host: '127.0.0.1:3000' } }),
  ['session'],
);
const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
const csrf = (await session.json()).csrf_token;
const cancel = (id: string, body = '{}') =>
  handle(
    new Request(`http://127.0.0.1:3000/api/jobs/${id}/cancel`, {
      method: 'POST',
      body,
      headers: {
        cookie,
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
    }),
    ['jobs', id, 'cancel'],
  );
const queued = () => {
  const p = { ...createProject({ name: 'Cancellation regression' }), input_revision: 1 };
  store.saveProject(p);
  return store.enqueue(p, 'verify', 'verify', 'cancel-test', {
    finding_id: null,
    patch_id: null,
    expected_finding_revision: null,
    expectation_set_revision: 0,
  });
};
const request = (format: string) =>
  handle(
    new Request(`http://127.0.0.1:3000/api/findings/${finding.id}/export?format=${format}`, {
      headers: { cookie, host: '127.0.0.1:3000' },
    }),
    ['findings', finding.id, 'export'],
  );
afterAll(async () => {
  store.close();
  delete process.env.PROOFSEC_DATA_DIR;
  await rm(directory, { recursive: true, force: true });
});
it('downloads a human-readable report that separates advisory AI from observed replica evidence', async () => {
  const response = await request('md');
  expect(response.headers.get('content-type')).toContain('text/markdown');
  expect(response.headers.get('content-disposition')).toContain('report.md');
  const body = await response.text();
  expect(body).toContain('Expected Access Model');
  expect(body).toContain('declared');
  expect(body).toContain('Verified Evidence');
  expect(body.replaceAll('\\', '')).toContain('result_cross_read');
  expect(body).toContain('AI Analysis — advisory');
  expect(body).toContain('not available');
});
it('requires an approved exact patch before downloading executable migration SQL', async () => {
  const metadata = {
    migration_sql:
      'BEGIN;\nALTER POLICY "profiles_select" ON "public"."profiles" USING ((SELECT auth.uid()) = "user_id");\nCOMMIT;\n',
    resource: finding.expectation!.resource,
    baseline_schema_digest: 'a'.repeat(64),
    expectation_revision_ids: ['exp_profiles_select_r1'],
    template_id: 'owner_select_v1' as const,
  };
  const patch = validate('MigrationPatch', {
    ...metadata,
    schema_version: '1.0',
    id: 'patch_export',
    finding_id: finding.id,
    project_id: finding.project_id,
    input_revision: 1,
    baseline_run_id: 'run_before',
    policy_name: 'profiles_select',
    owner_column: 'user_id',
    patch_digest: hash(metadata),
    preconditions: [],
    rationale: 'Owner SELECT',
    risks: [],
    origin: 'deterministic_template',
    status: 'proposed',
    approval: null,
    created_at: new Date().toISOString(),
  });
  store.put('MigrationPatch', patch.id, finding.project_id, patch);
  store.put(
    'Finding',
    finding.id,
    finding.project_id,
    validate('Finding', {
      ...finding,
      revision: 2,
      remediation: {
        ...finding.remediation,
        status: 'proposed',
        patch_id: patch.id,
        patch_digest: patch.patch_digest,
      },
    }),
    2,
  );
  const response = await request('sql');
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('APPROVAL_REQUIRED');
  store.put(
    'MigrationPatch',
    patch.id,
    finding.project_id,
    validate('MigrationPatch', {
      ...patch,
      status: 'approved',
      approval: {
        actor_id: 'unit_test_operator',
        approved_at: new Date().toISOString(),
        patch_digest: patch.patch_digest,
        baseline_schema_digest: patch.baseline_schema_digest,
        expectation_revision_ids: patch.expectation_revision_ids,
      },
    }),
    2,
  );
  const approved = await request('sql');
  expect(approved.status).toBe(200);
  expect(await approved.text()).toBe(patch.migration_sql);
});
it('rejects unknown cancellation fields without changing the queued job', async () => {
  const job = queued();
  const response = await cancel(job.id, '{"production_url":"https://example.invalid"}');
  expect(response.status).toBe(400);
  expect(store.job(job.id).status).toBe('queued');
  store.updateJob({ ...job, status: 'cancelled', error_code: 'CANCELLED' });
});
it('keeps an active cancellation busy until worker cleanup acknowledges it', async () => {
  const job = queued();
  expect(store.claim()?.job.id).toBe(job.id);
  expect((await cancel(job.id)).status).toBe(200);
  expect(store.job(job.id).status).toBe('running');
  expect(store.job(job.id).error_code).toBe('CANCELLED');
  expect(() => store.deleteProject(job.project_id)).toThrow('PROJECT_BUSY');
  expect(store.claim()).toBeNull();
  store.updateJob({ ...store.job(job.id), status: 'cancelled' });
  store.deleteProject(job.project_id);
});
it('preserves terminal job history when cancellation arrives after completion', async () => {
  const job = queued();
  store.updateJob({ ...job, status: 'succeeded' });
  const response = await cancel(job.id);
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('JOB_NOT_CANCELLABLE');
  expect(store.job(job.id).status).toBe('succeeded');
});
