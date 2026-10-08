import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { childEnvironment } from './child-environment.mjs';
const root = resolve('.');
const env = {
  ...childEnvironment(),
  PROOFSEC_ROOT_DIR: root,
  PROOFSEC_DATA_DIR: resolve(process.env.PROOFSEC_DATA_DIR ?? '.local'),
  NEXT_TELEMETRY_DISABLED: '1',
};
const port = new URL(env.PROOFSEC_ORIGIN ?? 'http://127.0.0.1:3000').port || '3000';
const commands = process.argv.includes('--web')
  ? [['exec', 'next', 'dev', 'apps/web', '--hostname', '127.0.0.1', '--port', port]]
  : process.argv.includes('--worker')
    ? [['exec', 'tsx', 'apps/worker/src/main.ts']]
    : [
        ['exec', 'tsx', 'apps/worker/src/main.ts'],
        ['exec', 'next', 'dev', 'apps/web', '--hostname', '127.0.0.1', '--port', port],
      ];
const children = commands.map((args) =>
  spawn('pnpm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' }),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill('SIGTERM'));
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
