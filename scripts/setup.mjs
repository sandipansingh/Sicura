import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('config/runtime-lock.json', 'utf8'));
for (const [cmd, args] of [
  ['pnpm', ['install', '--frozen-lockfile']],
  ['docker', ['pull', lock.postgres_image]],
  ['ollama', ['pull', lock.ollama_model]],
  ['pnpm', ['exec', 'playwright', 'install', 'chromium']],
  ['pnpm', ['run', 'check:env']],
]) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
