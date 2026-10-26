import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, open, readFile, unlink, realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../../../packages/store/src/index';
import { enqueueImport } from '../../../packages/store/src/imports';
import {
  parseStrictJson,
  validate,
  type ImportRequest,
} from '../../../packages/contracts/src/index';
import { newId } from '../../../packages/core/src/hash';
import { AppError, errorCode } from '../../../packages/core/src/errors';
import { applicationDataDirectory, assertExternalData } from './runtime';
import { doctor } from './doctor';
import { childEnvironment } from '../../../scripts/child-environment.mjs';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || ['--help', '-h', 'help'].includes(command)) {
    console.log(
      'sicura scan <directory|https://github.com/owner/repository> [--ref <ref>] [--no-open] [--port <port>]\nsicura ui [--no-open] [--port <port>]\nsicura doctor [--github]',
    );
    return;
  }
  if (command === 'doctor') {
    if (args.some((a) => a !== '--github')) throw new AppError('CLI_USAGE', 400);
    if (!(await doctor(args.includes('--github')))) process.exitCode = 1;
    return;
  }
  if (!['scan', 'ui'].includes(command)) throw new AppError('CLI_USAGE', 400);
  const target = command === 'scan' ? args.shift() : undefined;
  let ref: string | null = null;
  let port = 3000;
  let browser = true;
  while (args.length) {
    const option = args.shift();
    if (option === '--no-open') browser = false;
    else if (option === '--ref' && command === 'scan') {
      ref = args.shift() ?? null;
      if (!ref) throw new AppError('CLI_USAGE', 400);
    } else if (option === '--port') {
      const value = args.shift();
      if (!value || !/^\d{1,5}$/.test(value)) throw new AppError('CLI_USAGE', 400);
      port = Number(value);
      if (port < 1024 || port > 65535) throw new AppError('CLI_USAGE', 400);
    } else throw new AppError('CLI_USAGE', 400);
  }
  if (command === 'scan' && (!target || target.startsWith('--')))
    throw new AppError('CLI_USAGE', 400);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const data = applicationDataDirectory();
  let request: ImportRequest | undefined;
  if (target) {
    if (/^[a-z]+:\/\//i.test(target))
      request = { source: { kind: 'github', url: target, ref }, selection: null, retry_of: null };
    else {
      if (ref) throw new AppError('CLI_USAGE', 400);
      const directory = await realpath(resolve(target));
      assertExternalData(directory, data);
      request = { source: { kind: 'local', directory }, selection: null, retry_of: null };
    }
  }
  process.env.PROOFSEC_ROOT_DIR = root;
  process.env.PROOFSEC_DATA_DIR = data;
  await mkdir(data, { recursive: true, mode: 0o700 });
  const lockPath = resolve(data, 'ui.lock');
  let owned = false;
  try {
    const state = validate('RuntimeState', parseStrictJson(await readFile(lockPath, 'utf8'), 1024));
    try {
      process.kill(state.pid, 0);
      port = state.port;
    } catch {
      await unlink(lockPath);
    }
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'))
      throw new AppError('CLI_RUNTIME_LOCK_INVALID');
  }
  try {
    const file = await open(lockPath, 'wx', 0o600);
    await file.writeFile(JSON.stringify({ pid: process.pid, port }));
    await file.close();
    owned = true;
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e;
  }
  const store = new Store();
  let projectId: string | undefined;
  try {
    if (request) projectId = enqueueImport(store, request, newId('cli'), true).job.project_id;
  } catch (e) {
    if (owned) await unlink(lockPath);
    throw e;
  } finally {
    store.close();
  }
  const origin = `http://127.0.0.1:${port}`;
  const url = origin + (projectId ? `/app?project=${projectId}` : '/app');
  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  };
  if (owned) {
    const env: NodeJS.ProcessEnv = {
      ...childEnvironment(),
      NODE_ENV: 'production',
      PROOFSEC_ROOT_DIR: root,
      PROOFSEC_DATA_DIR: data,
      PROOFSEC_ORIGIN: origin,
    };
    delete env.NODE_OPTIONS;
    const require = createRequire(import.meta.url);
    for (const argv of [
      [resolve(root, 'runtime/worker.mjs')],
      [
        require.resolve('next/dist/bin/next'),
        'start',
        resolve(root, 'runtime/web'),
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
    ]) {
      const child = spawn(process.execPath, argv, {
        cwd: root,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // Framework output is suppressed; the CLI emits only fixed status/error fields.
      child.stdout.resume();
      child.stderr.resume();
      children.push(child);
      child.once('error', () => {
        process.exitCode = 1;
        stop();
      });
      child.once('exit', () => {
        if (!stopping) {
          process.exitCode = 1;
          console.log('CLI_RUNTIME_STOPPED');
          stop();
        }
      });
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
  }
  try {
    let ready = false;
    for (let i = 0; i < 120 && !stopping; i++) {
      try {
        const response = await fetch(origin + '/api/session', {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          validate('SessionResponse', parseStrictJson(await response.text()));
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await delay(250);
    }
    if (!ready) throw new AppError('CLI_RUNTIME_UNAVAILABLE');
    console.log(`Dashboard: ${url}`);
    if (browser) {
      const opener =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'rundll32'
            : 'xdg-open';
      execFile(
        opener,
        process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url],
        { windowsHide: true, timeout: 5000 },
        (e) => {
          if (e) console.log('CLI_BROWSER_UNAVAILABLE: open the dashboard URL above.');
        },
      );
    }
    if (owned)
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((done) => {
              if (child.exitCode !== null || child.signalCode !== null) done();
              else child.once('exit', () => done());
            }),
        ),
      );
  } finally {
    stop();
    if (owned) await unlink(lockPath).catch(() => {});
  }
}
main().catch((e: unknown) => {
  console.log(errorCode(e));
  process.exitCode = 1;
});
