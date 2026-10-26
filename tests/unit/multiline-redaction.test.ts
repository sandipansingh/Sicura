import { expect, it } from 'vitest';
import { admitInputs } from '../../packages/core/src/intake/inputs';
import { modelInput } from '../../packages/core/src/ai/ollama';
import { redactText, scanCredentials } from '../../packages/core/src/secrets/redact';
import { redactValue } from '../../packages/core/src/secrets/sink';
import { Store } from '../../packages/store/src/index';

it('redacts JSON-escaped URI slashes and preserves the decoded private comparison identity', () => {
  const canary = ['TEST_ONLY', 'JSON_SLASH_CANARY'].join('_');
  const uri = 'postgresql://demo:' + canary + '@example.invalid/db';
  const plain = JSON.stringify({ databaseUrl: uri });
  const key = Buffer.alloc(32, 7);
  const original = scanCredentials('config.json', plain, key)[0]!;
  for (const source of [
    plain.replaceAll('/', '\\/'),
    JSON.stringify({ databaseUrl: uri.replaceAll('/', '\\/') }),
  ]) {
    const safe = redactText(source);
    expect(safe.includes(canary), 'JSON escape layers cannot hide a recognized URI password').toBe(
      false,
    );
    const candidates = scanCredentials('config.json', source, key);
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates[0]!.fingerprint === original.fingerprint,
      'Equivalent encoded literals retain the same private identity',
    ).toBe(true);
  }
});

it('redacts the entire value of a quoted JSON key without clipping its final characters', () => {
  const canary = ['TEST_ONLY', 'QUOTED_PASSWORD_TAIL'].join('_');
  const safe = redactText(JSON.stringify({ client_secret: canary }));
  expect(
    safe.includes(canary.slice(-5)),
    'No literal suffix survives a quoted-key assignment',
  ).toBe(false);
  expect(
    safe === '{"client_secret":[REDACTED]}',
    'Only the complete literal span is replaced',
  ).toBe(true);
});

it('redacts an unquoted config value even when it exactly repeats the sensitive variable name', () => {
  const name = ['TEST_ONLY', 'DATABASE_PASSWORD'].join('_');
  const safe = redactText(name + '=' + name);
  expect(
    safe === name + '=[REDACTED]',
    'Value offset is independent of matching text in the name',
  ).toBe(true);
});

it('redacts complete multiline password literals before neighbouring finding snippets and every sink', async () => {
  const first = ['TEST_ONLY', 'MULTILINE_PASSWORD'].join('_');
  const second = ['TEST_ONLY', 'SECOND_PASSWORD_LINE'].join('_');
  const value = first + '\n' + second;
  const source =
    'const dbPassword = `' +
    value +
    '`;\n' +
    "const serviceRoleKey = '" +
    ['sb_secret', 'TEST_ONLY_NEIGHBOUR'].join('_') +
    "';";
  const safe = redactText(source);
  for (const fragment of [first, second])
    expect(safe.includes(fragment), 'Complete multiline literal is redacted').toBe(false);
  expect(safe).toContain('const dbPassword = [REDACTED];');
  const admitted = await admitInputs(
    {
      files: [{ path: 'frontend/client.ts', kind: 'source', content: source }],
      sql_order: [],
      expectations: null,
    },
    'multiline_redaction',
    1,
    Buffer.alloc(32, 7),
  );
  expect(
    admitted.credential_findings.some(
      (f) => f.evidence.kind === 'credential' && f.evidence.variable_name === 'dbPassword',
    ),
  ).toBe(true);
  const store = new Store(':memory:');
  try {
    store.setInputs('multiline_redaction', admitted);
    for (const finding of admitted.credential_findings)
      store.put('Finding', finding.id, finding.project_id, finding);
    const sinks = [
      admitted,
      store.inputs('multiline_redaction'),
      store.list('Finding'),
      admitted.credential_findings.map(modelInput),
      redactValue({ error: source }),
    ];
    const persisted = JSON.stringify(
      store.db.prepare('SELECT body FROM records UNION ALL SELECT body FROM inputs').all(),
    );
    for (const fragment of [first, second]) {
      expect(persisted.includes(fragment), 'SQLite contains no canary fragments').toBe(false);
      expect(
        JSON.stringify(sinks).includes(fragment),
        'Finding, model, error projections contain no canary fragments',
      ).toBe(false);
    }
  } finally {
    store.close();
  }
});
