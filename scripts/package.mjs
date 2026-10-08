import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const stage = resolve('.local/package');
await rm(stage, { recursive: true, force: true });
await mkdir(resolve(stage, 'runtime'), { recursive: true });
for (const [entry, outfile] of [
  ['apps/cli/src/main.ts', 'cli'],
  ['apps/worker/src/main.ts', 'worker'],
])
  await build({
    entryPoints: [entry],
    outfile: resolve(stage, `runtime/${outfile}.mjs`),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    packages: 'external',
  });
await cp('apps/web/.next', resolve(stage, 'runtime/web/.next'), {
  recursive: true,
  filter: (path) => !['cache', 'dev', 'types', 'diagnostics', 'trace'].includes(basename(path)),
});
await cp('apps/web/package.json', resolve(stage, 'runtime/web/package.json'));
await cp('apps/web/next.config.mjs', resolve(stage, 'runtime/web/next.config.mjs'));
for (const path of [
  'packages/core/src/intake/sql-parser.mjs',
  'config/runtime-lock.json',
  'config/ollama/model-lock.json',
  'config/fonts-lock.json',
  'licenses/fonts/bebasneue-OFL.txt',
  'licenses/fonts/spacegrotesk-OFL.txt',
  'licenses/fonts/jetbrainsmono-OFL.txt',
  'LICENSE',
  'NOTICE',
  'README.md',
  'skills.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/finding-model-and-lifecycle.md',
  'docs/ai-layer-gemma.md',
  'docs/security-and-safety.md',
  'docs/decisions-and-open-questions.md',
]) {
  await mkdir(resolve(stage, path, '..'), { recursive: true });
  await cp(path, resolve(stage, path));
}
await mkdir(resolve(stage, 'bin'), { recursive: true });
await writeFile(
  resolve(stage, 'bin/sicura.mjs'),
  "#!/usr/bin/env node\nimport '../runtime/cli.mjs';\n",
);
await chmod(resolve(stage, 'bin/sicura.mjs'), 0o755);
const source = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  resolve(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'sicura',
      version: source.version,
      type: 'module',
      license: source.license,
      description: 'Local credential investigation and replica-first RLS verification',
      bin: { sicura: 'bin/sicura.mjs' },
      engines: { node: source.engines.node },
      dependencies: source.dependencies,
      files: [
        'bin',
        'runtime',
        'packages',
        'config',
        'licenses',
        'docs',
        'skills.md',
        'README.md',
        'LICENSE',
        'NOTICE',
      ],
    },
    null,
    2,
  ) + '\n',
);
const output = resolve('.local/artifacts');
await mkdir(output, { recursive: true });
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--pack-destination', output],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exitCode = result.status ?? 1;
