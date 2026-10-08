import type { Replica } from '../replica/manager';
import type { Table, SchemaSnapshot } from '../rls/introspect';
import { tableSql, quoteIdentifier } from '../rls/introspect';
import { AppError } from '../errors';
import { hash } from '../hash';

export const USER_IDS = {
  user_a: '00000000-0000-4000-8000-000000000001',
  user_b: '00000000-0000-4000-8000-000000000002',
};
export type Row = Record<string, string | number | boolean | null>;
export interface SeedTable {
  table: Table;
  key: string;
  rows: Record<'user_a' | 'user_b', Row>;
  prospective: Record<'user_a' | 'user_b', Row>;
  mutable: string | null;
}
export interface SeedPlan {
  digest: string;
  tables: SeedTable[];
  unsupported: Record<string, string>;
}
export function planSeeds(snapshot: SchemaSnapshot): SeedPlan {
  const tables: SeedTable[] = [];
  const unsupported: Record<string, string> = {};
  for (const [ordinal, table] of snapshot.tables.entries()) {
    const tag = tableSql(table);
    if (table.primary_key.length !== 1) {
      unsupported[tag] = 'NO_ROW_LOCATOR';
      continue;
    }
    if (
      table.constraints.some((c) => c.kind === 'f' && !table.columns.some((col) => col.owner_fk))
    ) {
      unsupported[tag] = 'FK_TARGET_UNSUPPORTED';
      continue;
    }
    // All executable defaults passed the versioned AST profile. Supply every value
    // explicitly; random/time defaults never influence scenario identity or controls.
    if (table.columns.some((c) => c.generated || c.identity)) {
      unsupported[tag] = 'DEFAULT_UNSUPPORTED';
      continue;
    }
    try {
      const make = (actor: 'user_a' | 'user_b', insert = false): Row => {
        const values: Row = {};
        const a = actor === 'user_a' ? 1 : 2;
        const index = ordinal * 10 + a + (insert ? 4 : 0);
        for (const col of table.columns) {
          if (col.owner_fk) {
            values[col.name] = USER_IDS[actor];
            continue;
          }
          if (col.type === 'uuid')
            values[col.name] = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
          else if (col.type === 'text' || /^(?:character varying|character)\(/.test(col.type))
            values[col.name] = `Synthetic ${a}${insert ? ' new' : ''}`;
          else if (
            ['integer', 'bigint', 'smallint', 'numeric'].includes(col.type) ||
            col.type.startsWith('numeric(')
          )
            values[col.name] = index;
          else if (col.type === 'boolean') values[col.name] = true;
          else if (col.type.startsWith('timestamp') || col.type === 'date')
            values[col.name] = '2026-01-01';
          else if (['json', 'jsonb'].includes(col.type)) values[col.name] = '{}';
          else if (!col.not_null) values[col.name] = null;
          else throw new AppError('TYPE_UNSUPPORTED');
        }
        return values;
      };
      tables.push({
        table,
        key: table.primary_key[0]!,
        rows: { user_a: make('user_a'), user_b: make('user_b') },
        prospective: { user_a: make('user_a', true), user_b: make('user_b', true) },
        mutable:
          table.columns.find(
            (c) => c.name !== table.primary_key[0] && !c.owner_fk && c.type === 'text',
          )?.name ?? null,
      });
    } catch (e) {
      unsupported[tag] = e instanceof AppError ? e.code : 'TYPE_UNSUPPORTED';
    }
  }
  const data = tables.map((t) => ({
    resource: { schema: t.table.schema, table: t.table.name },
    key: t.key,
    rows: t.rows,
    prospective: t.prospective,
    mutable: t.mutable,
  }));
  return { digest: hash({ seed_version: 1, data, unsupported }), tables, unsupported };
}
export async function insertRow(replica: Replica, table: Table, row: Row): Promise<void> {
  const names = Object.keys(row);
  await replica.setup.query(
    `INSERT INTO ${tableSql(table)} (${names.map(quoteIdentifier).join(',')}) VALUES (${names.map((_, i) => '$' + (i + 1)).join(',')})`,
    names.map((k) => row[k]),
  );
}
export async function restoreSeeds(replica: Replica, plan: SeedPlan): Promise<void> {
  await replica.setup.query('BEGIN');
  try {
    if (plan.tables.length)
      await replica.setup.query(
        `TRUNCATE ${plan.tables.map((t) => tableSql(t.table)).join(',')} RESTART IDENTITY`,
      );
    await replica.setup.query('INSERT INTO auth.users(id) VALUES($1),($2) ON CONFLICT DO NOTHING', [
      USER_IDS.user_a,
      USER_IDS.user_b,
    ]);
    for (const item of plan.tables) {
      await insertRow(replica, item.table, item.rows.user_a);
      await insertRow(replica, item.table, item.rows.user_b);
    }
    await replica.setup.query('COMMIT');
  } catch {
    await replica.setup.query('ROLLBACK');
    throw new AppError('SEED_CONSTRAINT_FAILED');
  }
}
