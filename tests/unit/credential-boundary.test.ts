import { expect, it } from 'vitest';
import { redactText, scanCredentials } from '../../packages/core/src/secrets/redact';
import { redactValue } from '../../packages/core/src/secrets/sink';

it('redacts unquoted config, bearer/JWT literals and escaped private-key representations', () => {
  const value = ['TEST_ONLY', 'INVALID_DB_PASSWORD_CANARY'].join('_');
  for (const source of [
    `PGPASSWORD=${value}`,
    `const credentials = "postgresql://demo:${value}@example.invalid/db"`,
    JSON.stringify({
      private_key:
        '-----BEGIN PRIVATE KEY-----\nTEST_ONLY_INVALID_MATERIAL\n-----END PRIVATE KEY-----',
    }),
  ]) {
    const safe = redactText(source);
    expect(safe).toContain('[REDACTED]');
    expect(safe).not.toContain(value);
  }
  const token = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from('{"role":"service_role"}').toString('base64url'),
    'TEST_ONLY_INVALID_SIGNATURE',
  ].join('.');
  expect(redactText(`Authorization: Bearer ${token}`)).not.toContain(token);
});
it('recognizes public anon metadata as unverified public context, not privileged exposure', () => {
  const token = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from('{"role":"anon"}').toString('base64url'),
    'TEST_ONLY_INVALID_SIGNATURE',
  ].join('.');
  const result = scanCredentials('client/key.ts', `const anonKey = '${token}'`);
  expect(result[0]?.evidence.classification).toBe('public_identifier');
  expect(result[0]?.confirmed).toBe(false);
});
it('redacts whole fixed concatenations and encoded literals before all structured sinks', () => {
  const uri = 'postgresql://demo:TEST_ONLY_INVALID_PASSWORD@example.invalid/db';
  const source =
    "const databaseUrl = 'postgresql://demo:' + 'TEST_ONLY_INVALID_PASSWORD' + '@example.invalid/db';";
  expect(redactText(source)).not.toContain('TEST_ONLY_INVALID_PASSWORD');
  for (const encoded of [
    Buffer.from(uri).toString('base64'),
    Buffer.from(uri).toString('hex'),
    encodeURIComponent(uri),
  ]) {
    const safe = redactText(`const databaseUrl = '${encoded}'`);
    expect(safe).not.toContain(encoded);
    const sinks = redactValue({
      message: `databaseUrl = '${encoded}'`,
      nested: [{ snippet: `databaseUrl = '${encoded}'` }],
    });
    expect(JSON.stringify(sinks)).not.toContain(encoded);
  }
});
it('does not confirm content hashes, public keys, environment references or uncertain weak API literals', () => {
  const source =
    "const contentHash = 'TEST_ONLY_CONTENT_HASH'; const secret = process.env.API_KEY; const clientId = 'TEST_ONLY_PUBLIC_ID';";
  expect(scanCredentials('server/example.ts', source).filter((r) => r.confirmed)).toHaveLength(0);
  expect(scanCredentials('config.env', "API_KEY='tinyvalue'")[0]?.confirmed).toBe(false);
});
