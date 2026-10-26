import { parse } from 'pgsql-parser';
import type { Replica } from '../replica/manager';
import type { SchemaSnapshot, Table } from '../rls/introspect';
import { tableSql } from '../rls/introspect';
import { hash } from '../hash';
import { USER_IDS, type Row, type SeedPlan, type SeedTable } from './seed';

type Node = Record<string, unknown>;
const node = (v: unknown): Node =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function literal(v: unknown): Row[string] | undefined {
  const n = node(v);
  if (n.TypeCast) return literal(node(n.TypeCast).arg);
  if (n.A_ArrayExpr)
    return list(node(n.A_ArrayExpr).elements)
      .map(literal)
      .filter((x): x is string => typeof x === 'string');
  const c = node(n.A_Const);
  if (c.isnull) return null;
  if (c.sval) return String(node(c.sval).sval);
  if (c.ival) return Number(node(c.ival).ival ?? 0);
  if (c.fval) return Number(node(c.fval).fval);
  if (c.boolval) return Boolean(node(c.boolval).boolval);
  return undefined;
}
function column(v: unknown): string | null {
  const n = node(v);
  if (n.TypeCast) return column(node(n.TypeCast).arg);
  const fields = list(node(n.ColumnRef).fields);
  return fields.length === 1 ? String(node(node(fields[0]).String).sval) : null;
}
async function domains(table: Table): Promise<Map<string, Row[string][]>> {
  const values = new Map<string, Row[string][]>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const n = node(v),
      e = node(n.A_Expr),
      col = column(e.lexpr);
    if (col && ['AEXPR_IN', 'AEXPR_OP_ANY'].includes(String(e.kind))) {
      const r = node(e.rexpr),
        cast = node(r.TypeCast).arg;
      const array = node(cast ?? r).A_ArrayExpr;
      const candidates = array ? list(node(array).elements) : list(node(r.List).items);
      const constants = candidates.map(literal).filter((x): x is Row[string] => x !== undefined);
      if (constants.length) values.set(col, constants);
    }
    Object.values(n).forEach(visit);
  };
  for (const c of table.constraints.filter((c) => c.kind === 'c')) {
    // Catalogue-generated constraints are inspected as AST only, never interpolated into an executable query.
    try {
      visit(await parse(`CREATE TABLE seed_shape (placeholder integer, ${c.definition})`));
    } catch {
      /* PostgreSQL validates the actual bounded insert. */
    }
  }
  return values;
}
async function defaultLiteral(expression: string | null): Promise<Row[string] | undefined> {
  if (!expression) return undefined;
  try {
    const ast = await parse('SELECT ' + expression);
    return literal(ast.stmts[0]?.stmt?.SelectStmt?.targetList?.[0]?.ResTarget?.val);
  } catch {
    return undefined;
  }
}

/** Finite deterministic candidates; actual constraints/triggers remain authoritative. */
export async function prepareRepositorySeeds(
  replica: Replica,
  snapshot: SchemaSnapshot,
): Promise<SeedPlan> {
  const tables: SeedTable[] = [],
    unsupported: Record<string, string> = {};
  for (const [ordinal, table] of snapshot.tables.entries()) {
    const tag = tableSql(table);
    if (table.primary_key.length !== 1) {
      unsupported[tag] = 'NO_ROW_LOCATOR';
      continue;
    }
    const candidates = await domains(table),
      defaults = new Map<string, Row[string]>();
    for (const col of table.columns) {
      const value = await defaultLiteral(col.default_expression);
      if (value !== undefined) defaults.set(col.name, value);
    }
    let failed = false;
    const make = (actor: 'user_a' | 'user_b', insert = false): Row => {
      const a = actor === 'user_a' ? 1 : 2,
        index = ordinal * 10 + a + (insert ? 4 : 0),
        row: Row = {};
      for (const col of table.columns) {
        if (col.generated) {
          failed = true;
          continue;
        }
        const pk = table.primary_key.includes(col.name),
          defaultValue = defaults.get(col.name);
        if (!pk && !col.owner_fk && !col.not_null && !col.default_expression) continue;
        if (col.owner_fk) {
          row[col.name] = USER_IDS[actor];
          continue;
        }
        if (!pk && !col.not_null) {
          row[col.name] = null;
          continue;
        }
        if (!pk && defaultValue !== undefined && defaultValue !== null) {
          row[col.name] = defaultValue;
          continue;
        }
        const domain = candidates.get(col.name);
        if (!pk && domain?.length) {
          row[col.name] = domain[0]!;
          continue;
        }
        if (col.type === 'uuid')
          row[col.name] = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        else if (col.type === 'text' || /^(?:character varying|character)(?:\(|$)/.test(col.type))
          row[col.name] = /email/i.test(col.name)
            ? `synthetic${index}@example.invalid`
            : `Synthetic ${index}`;
        else if (
          ['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(
            col.type,
          ) ||
          col.type.startsWith('numeric(')
        )
          row[col.name] = pk ? index : 1;
        else if (col.type === 'boolean') row[col.name] = false;
        else if (col.type.startsWith('timestamp') || col.type === 'date')
          row[col.name] = '2026-01-01';
        else if (['json', 'jsonb'].includes(col.type)) row[col.name] = '{}';
        else if (col.type.endsWith('[]')) row[col.name] = [];
        else {
          failed = true;
          row[col.name] = null;
        }
      }
      return row;
    };
    const seed: SeedTable = {
      table,
      key: table.primary_key[0]!,
      rows: { user_a: make('user_a'), user_b: make('user_b') },
      prospective: { user_a: make('user_a', true), user_b: make('user_b', true) },
      mutable:
        table.columns.find(
          (c) => !table.primary_key.includes(c.name) && !c.owner_fk && c.type === 'text',
        )?.name ?? null,
    };
    if (failed) unsupported[tag] = 'TYPE_UNSUPPORTED';
    else if (Object.values(seed.rows).some((row) => Object.keys(row).length > 20))
      unsupported[tag] = 'SEED_ASSIGNMENT_LIMIT';
    else tables.push(seed);
  }
  // Order required FK prerequisites; nullable non-owner references stay NULL.
  const ordered: SeedTable[] = [];
  while (ordered.length < tables.length) {
    let progressed = false;
    for (const seed of tables.filter((t) => !ordered.includes(t))) {
      const deps = (seed.table.foreign_keys ?? []).filter(
        (fk) =>
          fk.columns.some((c) => seed.rows.user_a[c] != null) &&
          !(fk.schema === 'auth' && fk.table === 'users'),
      );
      if (
        deps.some(
          (fk) => !ordered.some((t) => t.table.schema === fk.schema && t.table.name === fk.table),
        )
      )
        continue;
      for (const fk of deps) {
        const target = ordered.find(
          (t) => t.table.schema === fk.schema && t.table.name === fk.table,
        )!;
        for (const actor of ['user_a', 'user_b'] as const)
          for (const [i, col] of fk.columns.entries()) {
            seed.rows[actor][col] = target.rows[actor][fk.target_columns[i]!]!;
            seed.prospective[actor][col] = target.rows[actor][fk.target_columns[i]!]!;
          }
      }
      ordered.push(seed);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const seed of tables.filter((t) => !ordered.includes(t)))
    unsupported[tableSql(seed.table)] = 'FK_TARGET_UNSUPPORTED';
  const plan: SeedPlan = {
    digest: '',
    tables: ordered,
    unsupported,
    all_tables: snapshot.tables,
    repository: true,
  };
  plan.digest = hash({
    seed_version: 2,
    tables: ordered.map((t) => ({
      resource: tableSql(t.table),
      rows: t.rows,
      prospective: t.prospective,
      key: t.key,
      mutable: t.mutable,
    })),
    unsupported,
  });
  // The replica argument establishes this planner's scope; preparation never touches a project database.
  if (replica.profile !== 'repository-v3') throw new Error('SEED_PROFILE_INVALID');
  return plan;
}
