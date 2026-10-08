import { expect, it } from 'vitest';
import { admitRepositorySql } from '../../packages/core/src/intake/repository-profile';
import { withReplica } from '../../packages/core/src/replica/manager';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { runMatrix } from '../../packages/core/src/verification/run';

it('replays transaction-wrapped helper policies and verifies using low privilege controls', async () => {
  const sql = await admitRepositorySql(`BEGIN;
    CREATE TABLE public.roles(id uuid PRIMARY KEY REFERENCES auth.users(id), role text);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.roles WHERE id=auth.uid() AND role='admin') $$;
    CREATE TABLE public.categories(id uuid PRIMARY KEY, ordinal integer NOT NULL DEFAULT 0, tags text[] NOT NULL DEFAULT '{}');
    CREATE TABLE public.notes(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), category_id uuid NOT NULL REFERENCES public.categories(id), body text, updated_at timestamptz);
    CREATE FUNCTION public.touch_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
    CREATE TRIGGER touch BEFORE INSERT OR UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.touch_note();
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY p ON public.notes FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_admin());
    GRANT SELECT ON public.notes TO authenticated;
    COMMIT;`);
  await withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica);
    const expectations = resolveExpectations(snapshot, []);
    const { results } = await runMatrix(replica, snapshot, expectations, 'test', 1, true);
    const cross = results.find(
      (r) => r.resource.table === 'notes' && r.test_id === 'rls.cross_user_read.v1',
    );
    expect(cross?.observed).toBe('deny');
    expect(cross?.role_assertion_passed).toBe(true);
    expect(cross?.control_result_ids.length).toBeGreaterThan(0);
    // Even direct bypass of intake cannot restore the setup connection after COMMIT.
    await expect(
      replica.apply('BEGIN; COMMIT; ALTER ROLE authenticated SUPERUSER;'),
    ).rejects.toThrow('SCHEMA_APPLY_FAILED');
    const role = await replica.setup.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname='authenticated'",
    );
    expect(role.rows[0]?.rolsuper).toBe(false);
  }, 'repository-v3');
});
