import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../packages/store/src/index';
import { enqueueImport } from '../../packages/store/src/imports';
import { runNext } from '../../apps/worker/src/dispatch';
import { AppError } from '../../packages/core/src/errors';

vi.mock('../../packages/core/src/replica/manager', () => ({
  withReplica: vi.fn(async () => {
    throw new AppError('REPLICA_UNAVAILABLE');
  }),
}));

it('keeps static SQL review and automatic advice available when the replica fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sicura-replica-failure-'));
  const store = new Store(':memory:');
  try {
    execFileSync('git', ['init', '-q', dir]);
    await writeFile(join(dir, 'schema.sql'), 'CREATE TABLE public.notes(id uuid PRIMARY KEY);');
    const { job } = enqueueImport(
      store,
      {
        source: { kind: 'local', directory: dir },
        selection: null,
        retry_of: null,
      },
      'import',
      true,
    );
    await runNext(store);
    expect(store.job(job.id).status).toBe('failed');
    expect(store.get('ImportReport', job.id).rls.status).toBe('replica_failed');
    expect(store.list('Finding', job.project_id).length).toBeGreaterThan(0);
    expect(
      store.list('Finding', job.project_id).every((f) => f.evidence.kind === 'rls_static'),
    ).toBe(true);
    expect(
      store
        .jobs(job.project_id)
        .some((j) => j.kind === 'project_analysis' && j.status === 'queued'),
    ).toBe(true);
    expect(store.list('Run', job.project_id)).toHaveLength(0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
