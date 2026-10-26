import { expect, it } from 'vitest';
import { admitRepositorySql } from '../../packages/core/src/intake/repository-profile';

const schema = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')));
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') $$;
CREATE TABLE public.notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), body text NOT NULL);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON public.notes TO authenticated USING(user_id=auth.uid() OR public.is_admin());
GRANT SELECT ON public.notes TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
`;
it('admits a complete helper-dependent Supabase chain', async () => {
  expect(await admitRepositorySql(schema)).toContain('SECURITY DEFINER');
});
it('admits only structurally scoped catalogue privilege loops', async () => {
  expect(
    await admitRepositorySql(`DO $$ DECLARE f regprocedure; BEGIN
    FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END LOOP;
    END $$;`),
  ).toContain('DO');
});
it.each([
  'CREATE EXTENSION dblink;',
  "COPY public.notes TO PROGRAM 'id';",
  'CREATE ROLE attacker SUPERUSER;',
  "CREATE FUNCTION public.bad() RETURNS text LANGUAGE sql AS $$ SELECT pg_read_file('/etc/passwd') $$;",
  "DO $$ BEGIN EXECUTE 'ALTER ROLE schema_loader SUPERUSER'; END $$;",
  'CREATE FUNCTION public.bad(q text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; END $$;',
  'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;',
  'CREATE TABLE public.bad(id pg_catalog.regconfig);',
  'DROP TABLE auth.users;',
  "DO $$ DECLARE f regprocedure; BEGIN FOR f IN SELECT 'pg_catalog.pg_read_file(text)'::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END LOOP; END $$;",
  "DO $$ DECLARE f regprocedure; BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' OR true LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END LOOP; END $$;",
  "DO $$ DECLARE f regprocedure; BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP f := 'pg_catalog.pg_read_file(text)'::regprocedure; EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END LOOP; END $$;",
  "CREATE FUNCTION public.pg_read_file(text) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$; CREATE FUNCTION public.bad() RETURNS text LANGUAGE sql AS $$ SELECT pg_read_file('/etc/passwd') $$;",
])('rejects nested or direct unsafe statements', async (sql) => {
  await expect(admitRepositorySql(sql)).rejects.toThrow();
});
it('rejects secret-bearing routine bodies before replay', async () => {
  await expect(
    admitRepositorySql(
      "CREATE FUNCTION public.bad() RETURNS text LANGUAGE sql AS $$ SELECT 'sb_secret_REPLAY_TEST_CANARY' $$;",
    ),
  ).rejects.toThrow('SQL_CONTAINS_SECRET');
});
