import { expect, it } from 'vitest';
import { analyzeSqlFiles } from '../../packages/core/src/rls/sql-analysis';
import { validate } from '../../packages/contracts/src/index';

it('analyzes complex migrations without admitting or executing their routines', async () => {
  const analysis = await analyzeSqlFiles([
    {
      path: '001.sql',
      content:
        'CREATE EXTENSION IF NOT EXISTS pgcrypto;\nCREATE TABLE public.notes(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));\nALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;',
    },
    {
      path: '002.sql',
      content:
        'CREATE POLICY read_notes ON public.notes FOR SELECT TO authenticated USING (true);\nCREATE FUNCTION public.helper() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;',
    },
  ]);
  expect(analysis.tables[0]?.name).toBe('notes');
  expect(analysis.policies[0]?.broad_using).toBe(true);
  expect(analysis.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: '001.sql', line: 1, code: 'SQL_EXTENSION_UNSUPPORTED' }),
      expect.objectContaining({ code: 'SQL_FUNCTION_UNSUPPORTED' }),
    ]),
  );
  expect(analysis.replay_ready).toBe(false);
  expect(JSON.stringify(analysis)).not.toContain('SELECT true');
});

it('tracks policy replacement and uncertainty across procedural changes', async () => {
  const a = await analyzeSqlFiles([
    {
      path: 'schema.sql',
      content:
        'CREATE TABLE public.notes(id uuid PRIMARY KEY); CREATE POLICY p ON public.notes USING (true); DROP POLICY p ON public.notes; CREATE POLICY p ON public.notes USING (false); DO $$ BEGIN NULL; END $$;',
    },
  ]);
  expect(a.policies).toHaveLength(1);
  expect(a.policies[0]?.broad_using).toBe(false);
  expect(a.complete).toBe(false);
  expect(a.diagnostics.some((d) => d.code === 'SQL_PROCEDURAL_UNMODELED')).toBe(true);
});

it('redacts secrets before every metadata sink while refusing executable secret SQL', async () => {
  const secret = 'sb_secret_TEST_ONLY_AST_CANARY';
  const a = await analyzeSqlFiles([
    {
      path: 'schema.sql',
      content: `CREATE TABLE public.notes(id uuid PRIMARY KEY, api_key text DEFAULT '${secret}');`,
    },
  ]);
  expect(a.replay_ready).toBe(false);
  expect(JSON.stringify(a)).not.toContain(secret);
  expect(a.diagnostics.some((d) => d.code === 'SQL_CONTAINS_SECRET')).toBe(true);
  expect(() => validate('SQLAnalysis', { ...a, extra: true })).toThrow();
});

it('tracks policy alterations and relation renames with declaration provenance', async () => {
  const a = await analyzeSqlFiles([
    {
      path: 'migrations/V1__schema.sql',
      content:
        '-- Header\nCREATE TABLE public.notes(id uuid PRIMARY KEY); CREATE POLICY p ON public.notes TO authenticated USING(true); ALTER POLICY p ON public.notes USING(false); ALTER TABLE public.notes RENAME TO notes2; ALTER POLICY p ON public.notes2 RENAME TO p2;',
    },
  ]);
  expect(a.tables[0]?.name).toBe('notes2');
  expect(a.policies[0]?.name).toBe('p2');
  expect(a.policies[0]?.table).toBe('notes2');
  expect(a.policies[0]?.broad_using).toBe(false);
  expect(a.replay_ready).toBe(false);
});
