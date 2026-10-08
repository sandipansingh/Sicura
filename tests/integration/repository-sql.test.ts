import { expect, it } from 'vitest';
import { admitSql } from '../../packages/core/src/intake/admit';
import { withReplica } from '../../packages/core/src/replica/manager';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { runMatrix } from '../../packages/core/src/verification/run';

const sql = `CREATE TABLE public.imported (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  value text NOT NULL DEFAULT 'synthetic', created timestamptz DEFAULT now(),
  count integer DEFAULT 3, enabled boolean DEFAULT false, metadata jsonb DEFAULT '{}'::jsonb
);
ALTER TABLE public.imported ADD COLUMN updated timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX imported_user ON public.imported (user_id);
ALTER TABLE public.imported ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported TO authenticated;
CREATE POLICY private_access ON public.imported FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS private_access ON public.imported;
CREATE POLICY private_access ON public.imported FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`;

it('replays defaults, add columns, indexes and ordered policy replacement with real identity/own-row controls', async () => {
  const admitted = await admitSql(sql);
  await withReplica(async (replica) => {
    await replica.apply(admitted);
    const snapshot = await introspect(replica);
    expect(snapshot.tables[0]!.policies).toHaveLength(1);
    expect(snapshot.tables[0]!.policies[0]!.using).toContain('auth.uid()');
    expect(snapshot.tables[0]!.columns.find((c) => c.name === 'updated')!.default_expression).toBe(
      'CURRENT_TIMESTAMP',
    );
    const edits = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((operation) => ({
      resource: { schema: 'public', table: 'imported' },
      actor: 'authenticated' as const,
      operation: operation as 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
      expected: 'own_rows_only' as const,
      owner_column: 'user_id',
      team_binding: null,
      intentionally_public: false,
      rationale: 'Synthetic private rows',
    }));
    const expectations = resolveExpectations(snapshot, edits);
    const result = await runMatrix(replica, snapshot, expectations, 'repository_sql');
    const supported = result.results.filter((r) => r.expected !== null);
    expect(supported).toHaveLength(18);
    expect(
      supported
        .filter(
          (r) => r.outcome !== 'match' || !r.role_assertion_passed || !r.target_existence_passed,
        )
        .map((r) => ({
          test_id: r.test_id,
          observed: r.observed,
          reason: r.reason_code,
          sqlstate: r.sqlstate,
        })),
    ).toEqual([]);
    expect(
      supported.filter((r) => r.test_id === 'rls.own_row_access.v1' && r.expected === 'allow'),
    ).toHaveLength(8);
  });
});

it('rejects unsafe neighboring constructs atomically', async () => {
  for (const tail of [
    'ALTER TABLE public.imported ADD COLUMN x uuid DEFAULT uuid_generate_v4();',
    "ALTER TABLE public.imported ADD COLUMN x text DEFAULT current_setting('request.jwt.claims');",
    'CREATE INDEX x ON public.imported ((length(value)));',
    'CREATE INDEX CONCURRENTLY x ON public.imported (id);',
    'CREATE INDEX x ON public.imported USING hash (id);',
    'CREATE INDEX x ON public.imported (id) WHERE enabled;',
    'CREATE INDEX x ON public.imported (value text_pattern_ops);',
    'DROP POLICY private_access ON public.imported CASCADE;',
    'ALTER TABLE public.imported DROP COLUMN value;',
    'CREATE POLICY x ON storage.objects USING (true);',
    "CREATE TABLE public.x(id uuid, x text DEFAULT 'secret'::regprocedure);",
  ])
    await expect(admitSql(sql + '\n' + tail)).rejects.toThrow('SQL_UNSUPPORTED');
});

it('keeps complex constraints inconclusive when synthetic controls cannot be established', async () => {
  const admitted = await admitSql(
    "CREATE TABLE public.items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id), value text NOT NULL DEFAULT 'accepted' CHECK (value = 'accepted')); GRANT SELECT ON public.items TO authenticated; ALTER TABLE public.items ENABLE ROW LEVEL SECURITY; CREATE POLICY broad ON public.items FOR SELECT TO authenticated USING (true);",
  );
  await withReplica(async (replica) => {
    await replica.apply(admitted);
    const snapshot = await introspect(replica);
    const expectations = resolveExpectations(snapshot, [
      {
        resource: { schema: 'public', table: 'items' },
        actor: 'authenticated',
        operation: 'SELECT',
        expected: 'own_rows_only',
        owner_column: 'user_id',
        team_binding: null,
        intentionally_public: false,
        rationale: 'Private synthetic rows',
      },
    ]);
    const result = await runMatrix(replica, snapshot, expectations, 'complex_defaults');
    expect(
      result.results
        .filter((r) => r.expected === 'deny')
        .every((r) => r.observed !== 'deny' && r.outcome === 'inconclusive'),
    ).toBe(true);
  });
});
