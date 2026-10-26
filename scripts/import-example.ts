import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/store/src/index';
import { enqueueImport } from '../packages/store/src/imports';
import { runNext } from '../apps/worker/src/dispatch';
import { makeReport } from '../eval/harness/runtime';
import {
  materializeRepository,
  repositoryFixtures,
  repositorySentinel,
} from '../tests/support/repository-fixtures';
import { assertRepositoryFixture } from '../tests/support/repository-fixture-checks';

if (process.argv.length > 2) throw new Error('SYNTHETIC_IMPORT_ARGUMENTS_UNSUPPORTED');
const started = performance.now();
const metadata = await makeReport('deterministic', [], 0, []);
const data = await mkdtemp(join(tmpdir(), 'proofsec-synthetic-import-'));
const store = new Store(join(data, 'proofsec.sqlite'));
const results = [];
try {
  for (const id of repositoryFixtures) {
    const fixture = await materializeRepository(id);
    const start = performance.now();
    try {
      const { job } = enqueueImport(
        store,
        {
          source: { kind: 'local', directory: fixture.directory },
          selection: null,
          retry_of: null,
        },
        id,
        true,
      );
      if (!(await runNext(store))) throw new Error('SYNTHETIC_IMPORT_NOT_RUN');
      const report = store.get('ImportReport', job.id);
      assertRepositoryFixture(id, store, job);
      results.push({ fixture: id, duration_ms: performance.now() - start, report });
    } finally {
      await fixture.dispose();
    }
  }
  // Inspect every data file, including SQLite WAL/journal bytes, before disposal.
  for (const name of await readdir(data))
    if ((await readFile(join(data, name))).includes(Buffer.from(repositorySentinel)))
      throw new Error('SYNTHETIC_IMPORT_SECRET_LEAK');
  const measurement = {
    schema_version: '1.0',
    dataset: 'Five committed synthetic repository fixtures; generated oversized-file recipe',
    created_at: new Date().toISOString(),
    commit: metadata.commit,
    implementation_digest: metadata.implementation_digest,
    working_tree_dirty: metadata.working_tree_dirty,
    duration_ms: performance.now() - started,
    hardware: metadata.hardware,
    runtime: metadata.runtime,
    status: 'passed',
    failures: [],
    skips: [],
    results,
    limitations: [
      'Discovery/static credential coverage only; no RLS verification in these five fixtures',
      'Supported consumer fixture verifies approval/retest/export separately via test:package',
      'No repository code, hooks or dependencies executed; no external repository ingress',
      'Existing frozen evaluation corpus/results remain unchanged',
    ],
  };
  const body = JSON.stringify(measurement, null, 2) + '\n';
  if (body.includes(repositorySentinel)) throw new Error('SYNTHETIC_IMPORT_SECRET_LEAK');
  await mkdir(resolve('.local/import-example'), { recursive: true });
  await writeFile(resolve('.local/import-example/latest.json'), body);
  console.log(body);
} finally {
  store.close();
  await rm(data, { recursive: true, force: true });
}
