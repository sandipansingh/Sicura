import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { Store } from '../../packages/store/src/index';
import { validate } from '../../packages/contracts/src/index';
import { admitInputs } from '../../packages/core/src/intake/inputs';
import { hash } from '../../packages/core/src/hash';
import { runNext } from '../../apps/worker/src/dispatch';
const exec = promisify(execFile);
it('holds the busy lock until an actual cancelled replica is destroyed, with no invented run', async () => {
  const store = new Store(':memory:');
  const now = new Date().toISOString();
  const project = validate('Project', {
    id: 'cancel_integration',
    name: 'Cancellation test',
    input_revision: 1,
    expectation_set_revision: 0,
    admitted_schema_digest: null,
    created_at: now,
    expires_at: now,
  });
  store.saveProject(project);
  store.setInputs(
    project.id,
    await admitInputs(
      {
        files: [
          {
            path: 'schema.sql',
            kind: 'sql',
            content: await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'),
          },
        ],
        sql_order: ['schema.sql'],
        expectations: null,
      },
      project.id,
      1,
      store.projectKey(project.id),
    ),
  );
  const job = store.enqueue(project, 'verify', 'verify', 'cancel', {
    finding_id: null,
    patch_id: null,
    expected_finding_revision: null,
    expectation_set_revision: 0,
  });
  const label = `label=io.proofsec.scope=${hash(resolve(process.env.PROOFSEC_DATA_DIR ?? '.local')).slice(0, 24)}`;
  const containers = async () =>
    (await exec('docker', ['ps', '-aq', '--filter', label], { timeout: 10000 })).stdout.trim();
  const running = runNext(store);
  try {
    const deadline = Date.now() + 15000;
    while (!(await containers())) {
      if (Date.now() > deadline || store.job(job.id).status !== 'running')
        throw new Error('REPLICA_NOT_OBSERVED');
      await delay(50);
    }
    store.cancelJob(job.id);
    expect(store.job(job.id).status).toBe('running');
    expect(() => store.deleteProject(project.id)).toThrow('PROJECT_BUSY');
    await running;
    expect(store.job(job.id).status).toBe('cancelled');
    expect(await containers()).toBe('');
    expect(store.list('Run', project.id)).toEqual([]);
    store.deleteProject(project.id);
  } finally {
    if (store.jobs(project.id).some((j) => j.status === 'running')) store.cancelJob(job.id);
    await running;
    store.close();
  }
});
