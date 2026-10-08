import { expect, it } from 'vitest';
import { redactText, scanCredentials } from '../../packages/core/src/secrets/redact';

it('masks complete credential literals and encoded representations before snippets', () => {
  const secret = 'sb_secret_TEST_ONLY_NOT_A_KEY';
  for (const value of [
    secret,
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('hex'),
    encodeURIComponent('postgres://test:TEST_ONLY_NOT_A_KEY@db.invalid/app'),
  ]) {
    const text = `const serviceRoleKey = "${value}"`;
    const output = scanCredentials('frontend/client.ts', text);
    expect(output.length).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toContain(value);
    expect(redactText(text)).not.toContain(value);
  }
});
it('qualifies public/placeholder values and never resolves environment lookups', () => {
  expect(scanCredentials('client.ts', 'const apiKey = process.env.API_KEY')).toHaveLength(0);
  expect(scanCredentials('client.ts', "const apiKey = 'YOUR_API_KEY'")[0]!.confirmed).toBe(false);
  expect(
    scanCredentials('client.ts', "const apiKey = 'sb_publishable_TEST_ONLY_NOT_A_KEY'")[0]!.evidence
      .classification,
  ).toBe('public_identifier');
});
