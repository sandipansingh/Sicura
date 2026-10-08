import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import fixture from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
import { Store } from '../../packages/store/src/index';
import { admitInputs } from '../../packages/core/src/intake/inputs';

it('reads findings and job completion from one SQLite snapshot during a worker commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofsec-view-snapshot-'));
  vi.stubEnv('PROOFSEC_DATA_DIR', directory);
  const { store, view } = await import('../../apps/web/lib/service');
  const writer = new Store(join(directory, 'proofsec.sqlite'));
  const now = new Date().toISOString();
  const project = validate('Project', {
    id: fixture.project_id,
    name: 'Synthetic concurrent view regression',
    input_revision: 1,
    expectation_set_revision: 1,
    admitted_schema_digest: null,
    created_at: now,
    expires_at: now,
  });
  let capture: ReturnType<typeof vi.spyOn> | undefined;
  try {
    store.saveProject(project);
    store.setInputs(
      project.id,
      await admitInputs(
        {
          files: [{ path: 'notes.txt', kind: 'source', content: 'Synthetic fixture metadata' }],
          sql_order: [],
          expectations: null,
        },
        project.id,
        1,
        store.projectKey(project.id),
      ),
    );
    const suspected = validate('Finding', { ...fixture, state: 'suspected' });
    store.put('Finding', suspected.id, project.id, suspected, suspected.revision);
    const job = store.enqueue(project, 'verify', 'verify', 'snapshot-regression', {
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: 1,
    });
    store.claim();
    const read = store.list.bind(store);
    let committed = false;
    capture = vi.spyOn(store, 'list').mockImplementation((kind, project_id) => {
      const records = read(kind, project_id);
      if (kind === 'Finding' && !committed) {
        committed = true;
        // A separate real WAL connection commits exactly between view queries.
        writer.transaction(() => {
          const confirmed = validate('Finding', { ...fixture, revision: fixture.revision + 1 });
          writer.put('Finding', confirmed.id, project.id, confirmed, confirmed.revision);
          writer.updateJob({ ...writer.job(job.id), status: 'succeeded' });
        });
      }
      return records;
    });
    const snapshot = view(project.id);
    expect(committed).toBe(true);
    const visible = snapshot.findings[0]!;
    expect(visible.state).toBe(snapshot.jobs[0]!.status === 'running' ? 'suspected' : 'confirmed');
    capture.mockRestore();
    const next = view(project.id);
    expect(next.jobs[0]!.status).toBe('succeeded');
    expect(next.findings[0]!.state).toBe('confirmed');
  } finally {
    capture?.mockRestore();
    writer.close();
    store.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
