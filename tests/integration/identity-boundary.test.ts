import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { admitSql } from '../../packages/core/src/intake/admit';
import { withReplica } from '../../packages/core/src/replica/manager';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { planSeeds } from '../../packages/core/src/verification/seed';
import { planMatrix } from '../../packages/core/src/verification/registry';
import { assertIdentity } from '../../packages/core/src/verification/identity';

it('resets transaction-local identity and refuses bypass/owner actors in a real pinned replica', async () => {
  const sql = await admitSql(await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'));
  await withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica);
    const scenarios = planMatrix(resolveExpectations(snapshot, []), planSeeds(snapshot), true);
    const a = scenarios.find(
      (s) => s.actor === 'user_a' && s.expectation.resource.table === 'profiles',
    )!;
    const b = scenarios.find(
      (s) => s.actor === 'user_b' && s.expectation.resource.table === 'profiles',
    )!;
    const client = await replica.connectVerifier();
    try {
      await assertIdentity(client, a);
      await client.query('ROLLBACK');
      expect(
        (
          await client.query(
            "SELECT current_user,session_user,nullif(current_setting('request.jwt.claims',true),'') AS claims",
          )
        ).rows[0],
      ).toEqual({ current_user: 'verifier_login', session_user: 'verifier_login', claims: null });
      await assertIdentity(client, b);
      await client.query('ROLLBACK');
      await replica.setup.query('ALTER ROLE authenticated BYPASSRLS');
      await expect(assertIdentity(client, a)).rejects.toThrow('IDENTITY_ASSERTION_FAILED');
      await client.query('ROLLBACK');
      await replica.setup.query('ALTER ROLE authenticated NOBYPASSRLS');
      await replica.setup.query('ALTER TABLE public.profiles OWNER TO authenticated');
      await expect(assertIdentity(client, a)).rejects.toThrow('IDENTITY_ASSERTION_FAILED');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
});
