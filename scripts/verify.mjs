import { spawnSync } from 'node:child_process';

for (const args of [
  ['contracts:generate'],
  ['lint'],
  ['format:check'],
  ['typecheck'],
  ['test'],
  ['smoke'],
  ['build'],
  ['test:e2e'],
]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
