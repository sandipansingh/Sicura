import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { parseStrictJson } from '../../packages/contracts/src/index';

const exec = promisify(execFile);
it('fails closed when Docker is unavailable at startup and releases the active lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofsec-no-docker-'));
  const module = pathToFileURL(resolve('packages/core/src/replica/manager.ts')).href;
  const source = `
    import { withReplica } from ${JSON.stringify(module)};
    const errors = [];
    let callbacks = 0;
    for (let i = 0; i < 2; i++) {
      try { await withReplica(async () => { callbacks++; }); }
      catch (error) { errors.push(error.code); }
    }
    console.log(JSON.stringify({ errors, callbacks }));
  `;
  try {
    const { stdout } = await exec(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      {
        env: { ...process.env, PATH: directory, PROOFSEC_DATA_DIR: directory },
        timeout: 10000,
      },
    );
    expect(parseStrictJson(stdout.trim())).toEqual({
      errors: ['REPLICA_UNAVAILABLE', 'REPLICA_UNAVAILABLE'],
      callbacks: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('contains idle PostgreSQL transport failure after an owned replica stops without an access verdict', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofsec-disconnect-'));
  const module = pathToFileURL(resolve('packages/core/src/replica/manager.ts')).href;
  const source = `
    import { execFile } from 'node:child_process';
    import { promisify } from 'node:util';
    import { setTimeout as delay } from 'node:timers/promises';
    import { withReplica } from ${JSON.stringify(module)};
    let unhandled = 0;
    let rejected = false;
    process.on('uncaughtException', () => { unhandled++; });
    await withReplica(async (replica) => {
      const verifier = await replica.connectVerifier();
      try {
        await promisify(execFile)('docker', ['stop', '--time', '1', replica.id]);
        await delay(100);
        try { await replica.setup.query('SELECT 1'); } catch { rejected = true; }
      } finally { await verifier.end().catch(() => {}); }
    });
    console.log(JSON.stringify({ unhandled, rejected }));
  `;
  try {
    const { stdout } = await exec(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      {
        env: { ...process.env, PROOFSEC_DATA_DIR: directory },
        timeout: 30000,
      },
    );
    expect(parseStrictJson(stdout.trim())).toEqual({ unhandled: 0, rejected: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
