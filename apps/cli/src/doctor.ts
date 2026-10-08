import os from 'node:os';
import lock from '../../../config/runtime-lock.json';
import { validate, parseStrictJson } from '../../../packages/contracts/src/index';
import { readCommand } from '../../../packages/core/src/repository/process';

export async function doctor(github: boolean): Promise<boolean> {
  const checks: { code: string; pass: boolean }[] = [];
  const check = async (code: string, action: () => Promise<unknown>) => {
    try {
      await action();
      checks.push({ code, pass: true });
    } catch {
      checks.push({ code, pass: false });
    }
  };
  await check('ENV_NODE_VERSION', async () => {
    if (process.versions.node !== lock.node) throw new Error();
  });
  await check('ENV_DOCKER_UNAVAILABLE', () =>
    readCommand('docker', ['info', '--format', '{{.ServerVersion}}']),
  );
  await check('ENV_POSTGRES_IMAGE_MISSING', () =>
    readCommand('docker', ['image', 'inspect', lock.postgres_image, '--format', '{{.Id}}']),
  );
  await check('ENV_OLLAMA_UNAVAILABLE', async () => {
    const response = await fetch('http://127.0.0.1:11434/api/version', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
  });
  await check('ENV_MODEL_MISSING', async () => {
    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    const data = validate('OllamaTags', parseStrictJson(await response.text(), 65536));
    if (
      !data.models.some(
        (m) => m.name === lock.ollama_model && m.digest === lock.ollama_model_digest,
      )
    )
      throw new Error();
  });
  if (github)
    await check('ENV_GITHUB_AUTH_REQUIRED', () =>
      readCommand('gh', ['auth', 'status', '--hostname', 'github.com'], {
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SYSTEMROOT: process.env.SYSTEMROOT,
          APPDATA: process.env.APPDATA,
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          GH_PROMPT_DISABLED: '1',
        },
      }),
    );
  console.log(
    JSON.stringify({
      component: 'doctor',
      machine: {
        platform: process.platform,
        arch: os.arch(),
        cpu: os.cpus()[0]?.model,
        ram_bytes: os.totalmem(),
      },
      node: process.versions.node,
      model: lock.ollama_model,
      postgres_image: lock.postgres_image,
      checks,
    }),
  );
  return checks.every((c) => c.pass);
}
