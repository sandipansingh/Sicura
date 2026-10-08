import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { childEnvironment } from './child-environment.mjs';

const result = spawnSync('pnpm', ['exec', 'next', 'build', 'apps/web', '--webpack'], {
  env: { ...childEnvironment(), PROOFSEC_ROOT_DIR: resolve('.') },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
