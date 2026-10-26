import { mkdirSync, openSync, readFileSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../../../packages/store/src/index';
import { reconcileReplicas } from '../../../packages/core/src/replica/manager';
import { logEvent, errorCode } from '../../../packages/core/src/errors';
import { runNext } from './dispatch';

const dir = resolve(process.env.PROOFSEC_DATA_DIR ?? '.local');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const lock = resolve(dir, 'worker.lock');
try {
  const pid = Number(readFileSync(lock, 'utf8'));
  if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0);
  throw new Error('WORKER_ALREADY_RUNNING');
} catch (e) {
  if (e instanceof Error && e.message === 'WORKER_ALREADY_RUNNING') throw e;
  try {
    unlinkSync(lock);
  } catch {
    /* absent */
  }
}
const descriptor = openSync(lock, 'wx', 0o600);
writeFileSync(descriptor, String(process.pid));
const store = new Store();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    for (const j of store.jobs())
      if (j.status === 'running') {
        store.cancelJob(j.id);
      }
  });
try {
  store.recover();
  await reconcileReplicas(true);
  logEvent('worker', 'WORKER_READY');
  let sweep = 0;
  while (!stopping) {
    if (Date.now() - sweep > 60_000) {
      await reconcileReplicas();
      sweep = Date.now();
      for (const p of store.list('Project'))
        if (Date.parse(p.expires_at) < Date.now()) {
          try {
            store.deleteProject(p.id);
          } catch {
            /* active project is retried next sweep */
          }
        }
    }
    if (!(await runNext(store))) await delay(250);
  }
} catch (e) {
  logEvent('worker', errorCode(e));
  process.exitCode = 1;
} finally {
  await reconcileReplicas(true).catch(() => {});
  store.close();
  closeSync(descriptor);
  unlinkSync(lock);
}
