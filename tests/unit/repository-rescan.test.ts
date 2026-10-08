import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../packages/store/src/index';
import { enqueueImport } from '../../packages/store/src/imports';
import { enqueueRepositoryRescan } from '../../packages/store/src/repository-rescan';
import { runNext } from '../../apps/worker/src/dispatch';

it('rescans over 200 files without treating ignored paths as deleted, then verifies genuine deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sicura-rescan-')),
    store = new Store(':memory:');
  try {
    execFileSync('git', ['init', '-q', dir]);
    await mkdir(join(dir, 'src'));
    for (let i = 0; i < 205; i++) await writeFile(join(dir, `src/${i}.ts`), 'const n=1;');
    await writeFile(
      join(dir, 'src/key.ts'),
      'const serviceRoleKey="sb_secret_TEST_ONLY_RESCAN_CANARY";',
    );
    await writeFile(join(dir, 'config.env'), "API_KEY='tinyvalue'");
    const initial = enqueueImport(
      store,
      { source: { kind: 'local', directory: dir }, selection: null, retry_of: null },
      'import',
      true,
    );
    await runNext(store);
    expect(store.job(initial.job.id).status).toBe('succeeded');
    const id = initial.job.project_id;
    const auto = store.jobs(id).find((j) => j.kind === 'project_analysis')!;
    expect(auto.status).toBe('queued');
    store.cancelJob(auto.id);
    await writeFile(join(dir, '.gitignore'), 'src/key.ts\n');
    const p = store.get('Project', id);
    const rescan = enqueueRepositoryRescan(
      store,
      id,
      { input_revision: p.input_revision, expectation_set_revision: p.expectation_set_revision },
      'rescan',
    );
    expect(
      enqueueRepositoryRescan(
        store,
        id,
        { input_revision: p.input_revision, expectation_set_revision: p.expectation_set_revision },
        'rescan',
      ).job.id,
    ).toBe(rescan.job.id);
    await runNext(store);
    expect(store.job(rescan.job.id).status).toBe('succeeded');
    expect(
      store
        .list('Finding', id)
        .filter(
          (f) =>
            f.input_revision === 2 &&
            f.location.kind === 'file' &&
            f.location.path === 'config.env',
        ),
    ).toHaveLength(1);
    const retained = store
      .list('Finding', id)
      .find((f) => f.input_revision === 2 && f.category === 'CREDENTIAL_EXPOSURE')!;
    expect(retained.state).toBe('confirmed');
    expect(
      store
        .get('ImportReport', rescan.job.id)
        .exclusions.some((e) => e.reason === 'rescan_scope_gap'),
    ).toBe(true);
    store.cancelJob(
      store.jobs(id).find((j) => j.kind === 'project_analysis' && j.status === 'queued')!.id,
    );
    const still = store.get('Project', id);
    const second = enqueueRepositoryRescan(
      store,
      id,
      {
        input_revision: still.input_revision,
        expectation_set_revision: still.expectation_set_revision,
      },
      'ignored-again',
    );
    await runNext(store);
    expect(store.job(second.job.id).status).toBe('succeeded');
    expect(store.get('Finding', retained.id).state).toBe('confirmed');
    store.cancelJob(
      store.jobs(id).find((j) => j.kind === 'project_analysis' && j.status === 'queued')!.id,
    );
    await rm(join(dir, 'src/key.ts'));
    await writeFile(join(dir, '.gitignore'), '');
    const current = store.get('Project', id);
    const last = enqueueRepositoryRescan(
      store,
      id,
      {
        input_revision: current.input_revision,
        expectation_set_revision: current.expectation_set_revision,
      },
      'delete',
    );
    await runNext(store);
    expect(store.job(last.job.id).status).toBe('succeeded');
    expect(store.get('Finding', retained.id).state).toBe('fixed');
    expect(JSON.stringify(store.db.prepare('SELECT body FROM records').all())).not.toContain(
      'sb_secret_TEST_ONLY_RESCAN_CANARY',
    );
    expect(() =>
      enqueueRepositoryRescan(
        store,
        id,
        { input_revision: 3, expectation_set_revision: 0, directory: dir },
        'bad',
      ),
    ).toThrow('CONTRACT_INVALID');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('preserves inferred intent and refreshes a real catalogue across supported routine rescans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sicura-static-rescan-')),
    store = new Store(':memory:');
  try {
    execFileSync('git', ['init', '-q', dir]);
    await mkdir(join(dir, 'prisma/migrations/20261008_initial'), { recursive: true });
    await writeFile(
      join(dir, 'prisma/migrations/20261008_initial/migration.sql'),
      'CREATE TABLE public.notes(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id)); CREATE POLICY p ON public.notes TO authenticated USING(true); CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$SELECT 1$$;',
    );
    const { job } = enqueueImport(
      store,
      { source: { kind: 'local', directory: dir }, selection: null, retry_of: null },
      'first',
      true,
    );
    await runNext(store);
    expect(store.job(job.id).status).toBe('succeeded');
    const prior = store.list('Expectation', job.project_id).find((e) => e.source === 'inferred')!;
    expect(prior).toBeDefined();
    store.cancelJob(store.jobs(job.project_id).find((j) => j.kind === 'project_analysis')!.id);
    const p = store.get('Project', job.project_id);
    const rescan = enqueueRepositoryRescan(
      store,
      p.id,
      { input_revision: p.input_revision, expectation_set_revision: p.expectation_set_revision },
      'next',
    );
    await runNext(store);
    expect(store.job(rescan.job.id).status).toBe('succeeded');
    const current = store.get('Expectation', prior.id);
    expect(current.source).toBe('inferred');
    expect(current.revision).toBe(prior.revision + 1);
    expect(store.currentSnapshot(p.id)?.replay_profile).toBe('repository-v3');
    expect(store.inputs(p.id).sql_analysis?.diagnostics).toHaveLength(0);
    expect(store.inputs(p.id).schema_sql).toBe('');
    expect(store.inputs(p.id).replay).toBeDefined();
    expect(
      store
        .list('Finding', p.id)
        .filter((f) => f.input_revision === 2)
        .every((f) => f.source.kind !== 'sql_ast'),
    ).toBe(true);
    expect(store.list('Run', p.id)).toHaveLength(0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
