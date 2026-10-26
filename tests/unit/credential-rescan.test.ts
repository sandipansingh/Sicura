import { expect, it } from 'vitest';
import { admitInputs } from '../../packages/core/src/intake/inputs';
import { assertCompleteScope, compareStaticRescan } from '../../packages/core/src/secrets/rescan';
import { demoCredential } from '../../packages/core/src/secrets/demo';
import { Store } from '../../packages/store/src/index';

it('does not mistake partial scope or a moved/encoded candidate for removal', async () => {
  const key = Buffer.alloc(32, 1);
  const uri = 'postgresql://demo:TEST_ONLY_INVALID_PASSWORD@example.invalid/db';
  const before = await admitInputs(
    {
      files: [{ path: 'config.env', kind: 'source', content: `DATABASE_URL='${uri}'` }],
      sql_order: [],
      expectations: null,
    },
    'project',
    1,
    key,
  );
  const missing = await admitInputs(
    { files: [], sql_order: [], expectations: null },
    'project',
    2,
    key,
  );
  expect(() => assertCompleteScope(before, missing.manifest, [])).toThrow('RESCAN_INCOMPLETE');
  const moved = await admitInputs(
    {
      files: [
        {
          path: 'new.env',
          kind: 'source',
          content: `DATABASE_URL='${Buffer.from(uri).toString('base64')}'`,
        },
      ],
      sql_order: [],
      expectations: null,
    },
    'project',
    2,
    key,
  );
  assertCompleteScope(before, moved.manifest, ['config.env']);
  expect(
    compareStaticRescan(before.credential_findings, before.credential_fingerprints, moved, 2)
      .updates[0]?.state,
  ).toBe('fix_not_verified');
  assertCompleteScope(before, missing.manifest, ['config.env']);
  const removed = compareStaticRescan(
    before.credential_findings,
    before.credential_fingerprints,
    missing,
    2,
  );
  expect(removed.updates[0]?.state).toBe('fixed');
  expect(removed.updates[0]?.retest_result?.scope).toContain('rotation');
  expect(compareStaticRescan(before.credential_findings, [], missing, 2).updates[0]?.state).toBe(
    'fix_not_verified',
  );
  expect(JSON.stringify(before)).not.toContain(uri);
  expect(before.credential_fingerprints[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});
it('keeps fingerprint identities private and project-local, and removes keys on Delete', () => {
  const store = new Store(':memory:');
  try {
    const a = store.projectKey('a');
    expect(store.projectKey('a')).toEqual(a);
    expect(store.projectKey('b')).not.toEqual(a);
    const synthetic = demoCredential('a', 1, a);
    expect(synthetic.finding.title).toContain('Synthetic credential fixture');
    expect(
      synthetic.finding.evidence.kind === 'credential' && synthetic.finding.evidence.value,
    ).toBe('[REDACTED]');
    expect(JSON.stringify(synthetic.finding)).not.toContain(synthetic.fingerprint);
    store.deleteProject('a');
    expect(store.projectKey('a')).not.toEqual(a);
  } finally {
    store.close();
  }
});
