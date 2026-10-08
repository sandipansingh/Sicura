import type { Replica } from '../replica/manager';
import { hash } from '../hash';
import { AppError } from '../errors';
import { validate } from '../../../contracts/src/index';

export interface Column {
  name: string;
  type: string;
  not_null: boolean;
  identity: string;
  generated: string;
  default_expression: string | null;
  owner_fk: boolean;
}
export interface Policy {
  name: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  permissive: boolean;
  roles: string[];
  using: string | null;
  check: string | null;
}
export interface Table {
  schema: string;
  name: string;
  owner: string;
  rls_enabled: boolean;
  force_rls: boolean;
  columns: Column[];
  primary_key: string[];
  constraints: { name: string; kind: string; definition: string }[];
  foreign_keys?: {
    columns: string[];
    schema: string;
    table: string;
    target_columns: string[];
    deferrable: boolean;
  }[];
  policies: Policy[];
  grants: Record<
    'authenticated' | 'anon',
    Record<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE', boolean>
  >;
}
export interface SchemaSnapshot {
  id: string;
  digest: string;
  tables: Table[];
  postgres_version: string;
  replay_sql_digest?: string;
}
export function quoteIdentifier(identifier: string): string {
  if (!identifier || Buffer.byteLength(identifier) > 63 || identifier.includes('\0'))
    throw new AppError('IDENTIFIER_INVALID');
  return '"' + identifier.replaceAll('"', '""') + '"';
}
export const tableSql = (table: Pick<Table, 'schema' | 'name'>): string =>
  quoteIdentifier(table.schema) + '.' + quoteIdentifier(table.name);
export async function introspect(
  replica: Replica,
  project_id = 'standalone',
): Promise<SchemaSnapshot> {
  const db = replica.setup;
  const result = await db.query<{
    schema: string;
    name: string;
    owner: string;
    rls_enabled: boolean;
    force_rls: boolean;
  }>(
    `SELECT n.nspname AS schema,c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='schema_loader') AND n.nspname NOT IN ('auth','storage','extensions','supabase_migrations') ORDER BY n.nspname,c.relname`,
  );
  const tables: Table[] = [];
  for (const row of result.rows) {
    const key = [row.schema, row.name];
    const columns = await db.query<Column>(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression,EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_class t ON t.oid=fk.confrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE fk.conrelid=c.oid AND fk.contype='f' AND a.attnum=ANY(fk.conkey) AND ns.nspname='auth' AND t.relname='users') AS owner_fk FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      key,
    );
    const constraints = await db.query<{ name: string; kind: string; definition: string }>(
      `SELECT k.conname AS name,k.contype AS kind,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 ORDER BY k.conname`,
      key,
    );
    const pk = await db.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY u(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum WHERE n.nspname=$1 AND c.relname=$2 AND k.contype='p' ORDER BY u.ordinality`,
      key,
    );
    const policies = await db.query<Policy>(
      `SELECT policyname AS name,cmd AS command,permissive='PERMISSIVE' AS permissive,roles::text[] AS roles,qual AS using,with_check AS check FROM pg_policies WHERE schemaname=$1 AND tablename=$2 ORDER BY policyname`,
      key,
    );
    const grants = {} as Table['grants'];
    const foreignKeys =
      replica.profile === 'repository-v3'
        ? await db.query<NonNullable<Table['foreign_keys']>[number]>(
            `SELECT ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num ORDER BY u.ord) AS columns,
      rn.nspname AS schema, rc.relname AS table,
      ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num ORDER BY u.ord) AS target_columns,
      k.condeferrable AS deferrable FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND k.contype='f' ORDER BY k.conname`,
            key,
          )
        : null;
    for (const role of ['authenticated', 'anon'] as const) {
      const value = await db.query<Record<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE', boolean>>(
        `SELECT has_schema_privilege($1,n.oid,'USAGE') AND has_table_privilege($1,c.oid,'SELECT') AS "SELECT",has_schema_privilege($1,n.oid,'USAGE') AND has_table_privilege($1,c.oid,'INSERT') AS "INSERT",has_schema_privilege($1,n.oid,'USAGE') AND has_table_privilege($1,c.oid,'UPDATE') AS "UPDATE",has_schema_privilege($1,n.oid,'USAGE') AND has_table_privilege($1,c.oid,'DELETE') AS "DELETE" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2 AND c.relname=$3`,
        [role, ...key],
      );
      grants[role] = value.rows[0]!;
    }
    tables.push({
      ...row,
      columns: columns.rows,
      primary_key: pk.rows.map((p) => p.name),
      constraints: constraints.rows,
      policies: policies.rows,
      grants,
      ...(foreignKeys ? { foreign_keys: foreignKeys.rows } : {}),
    });
  }
  if (replica.profile === 'repository-v3') {
    // Ownership inference may follow a UUID principal key through application profile tables.
    let changed = true;
    while (changed) {
      changed = false;
      for (const table of tables)
        for (const fk of table.foreign_keys ?? []) {
          if (fk.columns.length !== 1 || fk.target_columns.length !== 1) continue;
          const target = tables.find((t) => t.schema === fk.schema && t.name === fk.table);
          const targetColumn = target?.columns.find((c) => c.name === fk.target_columns[0]);
          const column = table.columns.find((c) => c.name === fk.columns[0]);
          if (
            column &&
            !column.owner_fk &&
            column.type === 'uuid' &&
            targetColumn?.owner_fk &&
            target?.primary_key.length === 1 &&
            target.primary_key[0] === targetColumn.name
          ) {
            column.owner_fk = true;
            changed = true;
          }
        }
    }
  }
  if (
    tables.length > 50 ||
    tables.reduce((n, t) => n + t.columns.length, 0) > 2000 ||
    tables.reduce((n, t) => n + t.policies.length, 0) > 500
  )
    throw new AppError('SCHEMA_LIMIT');
  const version = (await db.query<{ server_version: string }>('SHOW server_version')).rows[0]!
    .server_version;
  const provenance =
    replica.profile === 'repository-v3'
      ? {
          replay_profile: replica.profile,
          bootstrap_version: 'supabase-database-v1' as const,
          replay_sql_digest: replica.baseline_digest!,
        }
      : {};
  const digest = hash({ tables, postgres_version: version, ...provenance });
  return validate('SchemaSnapshot', {
    id: 'snapshot_' + hash({ project_id, digest }).slice(0, 24),
    digest,
    tables,
    postgres_version: version,
    ...provenance,
  });
}
