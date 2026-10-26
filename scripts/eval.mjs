import { spawnSync } from 'node:child_process';
let failed = false;
for (const script of ['eval:deterministic', 'eval:ai', 'eval:report']) {
  const result = spawnSync('pnpm', [script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
