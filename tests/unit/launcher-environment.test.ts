import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['scripts/dev.mjs', 2],
  ['scripts/build.mjs', 1],
])('does not pass unrelated host credentials through %s', (script, count) => {
  const dir = mkdtempSync(join(tmpdir(), 'proofsec-launcher-'));
  try {
    const preload = join(dir, 'capture.mjs');
    writeFileSync(
      preload,
      `import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawn = (_command, _args, options) => {
  console.log(JSON.stringify(options.env));
  return new EventEmitter();
};
childProcess.spawnSync = (_command, _args, options) => {
  console.log(JSON.stringify(options.env));
  return { status: 0 };
};
syncBuiltinESMExports();
`,
    );
    const result = spawnSync(process.execPath, ['--import', preload, resolve(script)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GEMINI_API_KEY: 'TEST_ONLY_INVALID_HOST_KEY',
        ANTHROPIC_AUTH_TOKEN: 'TEST_ONLY_INVALID_HOST_TOKEN',
        DATABASE_URL: 'postgresql://demo:TEST_ONLY_INVALID_PASSWORD@example.invalid/db',
        UNRECOGNIZED_HOST_SETTING: 'TEST_ONLY_INVALID_HOST_SETTING',
        PROOFSEC_ORIGIN: 'http://127.0.0.1:3199',
        NODE_OPTIONS: '--import=' + preload,
      },
    });
    expect(result.status).toBe(0);
    const children = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(children).toHaveLength(count);
    for (const env of children) {
      expect(Object.hasOwn(env, 'GEMINI_API_KEY')).toBe(false);
      expect(Object.hasOwn(env, 'ANTHROPIC_AUTH_TOKEN')).toBe(false);
      expect(Object.hasOwn(env, 'DATABASE_URL')).toBe(false);
      expect(Object.hasOwn(env, 'UNRECOGNIZED_HOST_SETTING')).toBe(false);
      expect(env.PROOFSEC_ORIGIN).toBe('http://127.0.0.1:3199');
      expect(env.NODE_OPTIONS).toBe('--import=' + preload);
      expect(env.NEXT_TELEMETRY_DISABLED).toBe('1');
      expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
