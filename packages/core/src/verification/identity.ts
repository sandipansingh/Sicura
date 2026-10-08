import type pg from 'pg';
import type { Scenario } from './registry';
import { claims } from './registry';
import { AppError } from '../errors';

export async function assertIdentity(client: pg.Client, s: Scenario): Promise<void> {
  const role = s.actor === 'anon' ? 'anon' : 'authenticated';
  await client.query('BEGIN');
  await client.query(role === 'anon' ? 'SET LOCAL ROLE anon' : 'SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify(claims(s.actor)),
  ]);
  await client.query(
    "SET LOCAL row_security=on; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'",
  );
  const row = (
    await client.query<{
      current_user: string;
      session_user: string;
      uid: string | null;
      role: string;
      super: boolean;
      bypass: boolean;
      owns: boolean;
      row_security: string;
    }>(
      `SELECT current_user,session_user,auth.uid() AS uid,auth.role() AS role,r.rolsuper AS super,r.rolbypassrls AS bypass,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relowner=r.oid) AS owns,current_setting('row_security') AS row_security FROM pg_roles r WHERE r.rolname=current_user`,
      [s.expectation.resource.schema, s.expectation.resource.table],
    )
  ).rows[0];
  const expected = claims(s.actor);
  if (
    !row ||
    row.current_user !== role ||
    row.session_user !== 'verifier_login' ||
    row.role !== role ||
    row.super ||
    row.bypass ||
    row.owns ||
    row.row_security !== 'on' ||
    row.uid !== ('sub' in expected ? expected.sub : null)
  )
    throw new AppError('IDENTITY_ASSERTION_FAILED');
}
