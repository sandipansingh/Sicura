import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { it, expect } from 'vitest';
it('does not forward a credential-shaped request path into framework logs', async () => {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done) => listener.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const hostCanary = ['TEST_ONLY', 'INVALID_HOST_CACHE_KEY'].join('_');
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--web'], {
    env: {
      ...process.env,
      PROOFSEC_ROOT_DIR: resolve('.'),
      PROOFSEC_DATA_DIR: resolve('.local/request-logging'),
      PROOFSEC_ORIGIN: origin,
      NEXT_TELEMETRY_DISABLED: '1',
      GEMINI_API_KEY: hostCanary,
      ANTHROPIC_AUTH_TOKEN: hostCanary,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-262144);
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(origin + '/api/session', {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Startup polling only. */
      }
      if (child.exitCode !== null) break;
      await delay(100);
    }
    expect(ready, 'Local Next server started').toBe(true);
    const canary = ['sb_secret', 'TEST_ONLY_LOG_CANARY'].join('_');
    await fetch(origin + '/api/' + canary, { signal: AbortSignal.timeout(5000) });
    await delay(200);
    expect(output.includes(canary), 'Sensitive request path absent from stdout/stderr').toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timer);
    }
  }
  const generated = resolve('apps/web/.next');
  for (const entry of await readdir(generated, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const bytes = await readFile(resolve(entry.parentPath, entry.name));
    expect(
      bytes.includes(Buffer.from(hostCanary)),
      'Host credential absent from framework output',
    ).toBe(false);
  }
});
