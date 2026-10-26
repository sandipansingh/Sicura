import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

const lock = JSON.parse(
  await readFile(new URL('../config/runtime-lock.json', import.meta.url), 'utf8'),
);
const command = (name, args) =>
  execFileSync(name, args, {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
const checks = [];
const check = async (code, action) => {
  try {
    const detail = await action();
    checks.push({ code, pass: true, detail });
  } catch {
    checks.push({ code, pass: false });
    process.exitCode = 1;
  }
};
console.log(
  JSON.stringify({
    component: 'environment',
    machine: {
      os: os.type(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      ram_bytes: os.totalmem(),
    },
  }),
);
await check('ENV_NODE_VERSION', () => {
  if (process.versions.node !== lock.node) throw new Error();
  return process.versions.node;
});
await check('ENV_PNPM_VERSION', () => {
  const version =
    process.env.npm_config_user_agent?.match(/pnpm\/(\S+)/)?.[1] ?? command('pnpm', ['--version']);
  if (version !== lock.pnpm) throw new Error();
  return version;
});
await check('ENV_DOCKER_UNAVAILABLE', () =>
  command('docker', ['info', '--format', '{{.ServerVersion}}']),
);
await check(
  'ENV_OLLAMA_UNAVAILABLE',
  async () =>
    (
      await (
        await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(5000) })
      ).json()
    ).version,
);
await check('ENV_MODEL_MISSING', async () => {
  const data = await (
    await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) })
  ).json();
  const model = data.models.find((m) => m.name === lock.ollama_model);
  if (!model) throw new Error();
  if (model.digest !== lock.ollama_model_digest) throw new Error('ENV_MODEL_DRIFT');
  return { tag: model.name, digest: model.digest, quantization: model.details.quantization_level };
});
try {
  console.log(
    JSON.stringify({
      gpu: command('nvidia-smi', [
        '--query-gpu=name,driver_version,memory.total,memory.used',
        '--format=csv,noheader',
      ]),
    }),
  );
} catch {
  console.log(
    JSON.stringify({ gpu: 'NVIDIA telemetry unavailable; Apple Silicon uses unified memory.' }),
  );
}
for (const result of checks)
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'} ${result.code}${result.detail ? ' ' + JSON.stringify(result.detail) : ''}`,
  );
