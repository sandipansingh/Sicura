import { validate, type SQLAnalysis, type SQLPolicy } from '../../../contracts/src/index';
import { admitSql, checkAst, parseSql } from '../intake/admit';
import { admitRepositorySql } from '../intake/repository-profile';
import { AppError, errorCode } from '../errors';
import { newId } from '../hash';
import { redactValue } from '../secrets/sink';

type Node = Record<string, unknown>;
const node = (v: unknown): Node =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const names = (v: unknown): string[] =>
  array(v).map((x) => String(node(node(x).String).sval ?? ''));
const relation = (v: unknown) => ({
  schema: String(node(v).schemaname ?? 'public'),
  table: String(node(v).relname ?? ''),
});
const key = (schema: string, table: string) => JSON.stringify([schema, table]);
function truth(v: unknown, depth = 0): boolean | null {
  if (depth > 100) return null;
  const n = node(v);
  if (n.A_Const) {
    const c = node(n.A_Const);
    return c.boolval ? Boolean(node(c.boolval).boolval) : null;
  }
  if (n.TypeCast) return truth(node(n.TypeCast).arg, depth + 1);
  if (n.BoolExpr) {
    const b = node(n.BoolExpr),
      values = array(b.args).map((v) => truth(v, depth + 1));
    if (b.boolop === 'OR_EXPR' && values.includes(true)) return true;
    if (b.boolop === 'AND_EXPR' && values.every((v) => v === true)) return true;
    if (b.boolop === 'NOT_EXPR' && values.length === 1 && values[0] !== null) return !values[0];
  }
  return null;
}
function helpers(v: unknown, found = new Set<string>(), depth = 0): string[] {
  if (depth > 100) return [...found];
  const n = node(v);
  if (n.FuncCall) found.add(names(node(n.FuncCall).funcname).join('.'));
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach((x) => helpers(x, found, depth + 1));
    else if (value && typeof value === 'object') helpers(value, found, depth + 1);
  }
  return [...found].slice(0, 100);
}
const codes: Record<string, string> = {
  CreateExtensionStmt: 'SQL_EXTENSION_UNSUPPORTED',
  CreateFunctionStmt: 'SQL_FUNCTION_UNSUPPORTED',
  CreateTrigStmt: 'SQL_TRIGGER_UNSUPPORTED',
  DoStmt: 'SQL_PROCEDURAL_UNMODELED',
  ViewStmt: 'SQL_VIEW_UNSUPPORTED',
  CreateSeqStmt: 'SQL_SEQUENCE_UNSUPPORTED',
  AlterDefaultPrivilegesStmt: 'SQL_DEFAULT_PRIVILEGES_UNMODELED',
  TransactionStmt: 'SQL_TRANSACTION_UNSUPPORTED',
};

/** Static declarations only. Never produces executable SQL or a replica snapshot. */
export async function analyzeSqlFiles(
  files: { path: string; content: string }[],
  input_revision = 1,
  expanded = false,
): Promise<SQLAnalysis> {
  const a: SQLAnalysis = {
    id: newId('sql'),
    input_revision,
    complete: true,
    replay_ready: false,
    replay_reason: null,
    statements: 0,
    tables: [],
    policies: [],
    grants: [],
    diagnostics: [],
    created_at: new Date().toISOString(),
  };
  const tables = new Map<string, SQLAnalysis['tables'][number]>();
  const parsed: { path: string; content: string; ast: Node }[] = [];
  const diagnose = (
    path: string,
    line: number,
    statement: number,
    construct: string,
    code: string,
  ) => {
    if (a.diagnostics.length >= 2000) {
      a.complete = false;
      return;
    }
    a.diagnostics.push({
      path,
      line,
      statement,
      construct,
      code,
      message: `${construct}: ${code.replaceAll('_', ' ').toLowerCase()}. No replica access conclusion.`,
    });
  };
  if (files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > 2097152) {
    a.complete = false;
    a.replay_reason = 'INPUT_LIMIT';
    diagnose(files[0]?.path ?? 'schema.sql', 1, 0, 'Migration chain', 'INPUT_LIMIT');
    return validate('SQLAnalysis', redactValue(a));
  }
  for (const f of files) {
    try {
      parsed.push({ ...f, ast: (await parseSql(f.content)).ast });
    } catch (e) {
      a.complete = false;
      diagnose(f.path, 1, 0, 'Parser', errorCode(e));
    }
  }
  const schemas = [
    'public',
    ...parsed.flatMap((f) =>
      array(f.ast.stmts).flatMap((s) => {
        const n = node(node(node(s).stmt).CreateSchemaStmt);
        return typeof n.schemaname === 'string' ? [n.schemaname] : [];
      }),
    ),
  ];
  for (const f of parsed)
    for (const raw of array(f.ast.stmts)) {
      if (++a.statements > 2000) {
        a.complete = false;
        diagnose(f.path, 1, a.statements, 'Migration chain', 'SQL_STATEMENT_LIMIT');
        break;
      }
      const statement = node(raw),
        w = node(statement.stmt),
        kind = Object.keys(w)[0] ?? 'Unknown',
        n = node(w[kind]);
      // Parser offsets are UTF-8 bytes, not JavaScript character indices.
      const offset = Number(statement.stmt_location ?? 0);
      const suffix = Buffer.from(f.content).subarray(offset).toString('utf8');
      let lead = 0;
      for (;;) {
        const m = suffix.slice(lead).match(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/);
        if (!m) break;
        lead += m[0].length;
      }
      const line =
        Buffer.from(f.content).subarray(0, offset).toString('utf8').split('\n').length +
        suffix.slice(0, lead).split('\n').length -
        1;
      try {
        checkAst({ version: f.ast.version, stmts: [raw] }, schemas);
      } catch {
        diagnose(f.path, line, a.statements, kind, codes[kind] ?? 'SQL_UNSUPPORTED');
      }
      const r = relation(n.relation ?? n.table);
      const t = tables.get(key(r.schema, r.table));
      if (kind === 'CreateStmt') {
        const columns = array(n.tableElts).flatMap((x) => {
          const c = node(node(x).ColumnDef);
          if (!c.colname) return [];
          return [
            {
              name: String(c.colname),
              type: names(node(c.typeName).names).at(-1) ?? 'unknown',
              owner_fk: array(c.constraints).some((v) => {
                const fk = node(node(v).Constraint);
                const rel = relation(fk.pktable);
                return (
                  fk.contype === 'CONSTR_FOREIGN' &&
                  rel.schema === 'auth' &&
                  rel.table === 'users' &&
                  names(fk.pk_attrs).join('.') === 'id'
                );
              }),
            },
          ];
        });
        if (t)
          a.complete = false; // Conditional/duplicate declarations do not establish final state.
        else
          tables.set(key(r.schema, r.table), {
            schema: r.schema,
            name: r.table,
            rls_enabled: false,
            columns,
          });
        for (const x of array(n.tableElts)) {
          const fk = node(node(x).Constraint);
          const rel = relation(fk.pktable);
          if (
            fk.contype === 'CONSTR_FOREIGN' &&
            rel.schema === 'auth' &&
            rel.table === 'users' &&
            names(fk.pk_attrs).join('.') === 'id'
          )
            for (const name of names(fk.fk_attrs)) {
              const c = columns.find((c) => c.name === name);
              if (c) c.owner_fk = true;
            }
        }
      } else if (kind === 'AlterTableStmt') {
        for (const cmd of array(n.cmds)) {
          const c = node(node(cmd).AlterTableCmd);
          if (!t) {
            a.complete = false;
            continue;
          }
          if (c.subtype === 'AT_EnableRowSecurity') t.rls_enabled = true;
          else if (c.subtype === 'AT_DisableRowSecurity') t.rls_enabled = false;
          else if (c.subtype === 'AT_AddColumn') {
            const col = node(node(c.def).ColumnDef);
            t.columns.push({
              name: String(col.colname),
              type: names(node(col.typeName).names).at(-1) ?? 'unknown',
              owner_fk: false,
            });
          } else if (c.subtype === 'AT_DropColumn')
            t.columns = t.columns.filter((col) => col.name !== c.name);
          else if (!['AT_ForceRowSecurity', 'AT_NoForceRowSecurity'].includes(String(c.subtype)))
            a.complete = false;
        }
      } else if (kind === 'CreatePolicyStmt') {
        const p: SQLPolicy = {
          ...r,
          name: String(n.policy_name),
          operation: String(n.cmd_name ?? 'ALL').toUpperCase() as SQLPolicy['operation'],
          roles: array(n.roles).map((v) => {
            const role = node(node(v).RoleSpec);
            return role.roletype === 'ROLESPEC_PUBLIC' ? 'public' : String(role.rolename);
          }),
          permissive: n.permissive !== false,
          broad_using: truth(n.qual),
          broad_check: truth(n.with_check ?? n.qual),
          helpers: [...new Set([...helpers(n.qual), ...helpers(n.with_check)])],
          path: f.path,
          line,
        };
        if (
          p.helpers.some(
            (h) =>
              !['auth.uid', 'auth.role', 'auth.jwt', 'length', 'pg_catalog.length'].includes(h),
          )
        ) {
          a.complete = false;
          diagnose(f.path, line, a.statements, 'Policy helper', 'SQL_POLICY_DEPENDENCY_UNMODELED');
        }
        const prior = a.policies.find(
          (p) => p.schema === r.schema && p.table === r.table && p.name === n.policy_name,
        );
        if (prior) a.complete = false;
        else a.policies.push(p);
      } else if (kind === 'AlterPolicyStmt') {
        const policy = a.policies.find(
          (p) => p.schema === r.schema && p.table === r.table && p.name === n.policy_name,
        );
        if (!policy) a.complete = false;
        else {
          if (n.roles)
            policy.roles = array(n.roles).map((v) => {
              const role = node(node(v).RoleSpec);
              return role.roletype === 'ROLESPEC_PUBLIC' ? 'public' : String(role.rolename);
            });
          if (n.qual) policy.broad_using = truth(n.qual);
          if (n.with_check) policy.broad_check = truth(n.with_check);
          policy.helpers = [
            ...new Set([...policy.helpers, ...helpers(n.qual), ...helpers(n.with_check)]),
          ].slice(0, 100);
          policy.path = f.path;
          policy.line = line;
        }
      } else if (kind === 'RenameStmt') {
        if (n.renameType === 'OBJECT_TABLE' && t) {
          tables.delete(key(r.schema, r.table));
          t.name = String(n.newname);
          tables.set(key(t.schema, t.name), t);
          for (const p of a.policies)
            if (p.schema === r.schema && p.table === r.table) p.table = t.name;
          for (const g of a.grants)
            if (g.schema === r.schema && g.table === r.table) g.table = t.name;
        } else if (n.renameType === 'OBJECT_COLUMN' && t) {
          const c = t.columns.find((c) => c.name === n.subname);
          if (c) c.name = String(n.newname);
          else a.complete = false;
        } else if (n.renameType === 'OBJECT_POLICY') {
          const p = a.policies.find(
            (p) => p.schema === r.schema && p.table === r.table && p.name === n.subname,
          );
          if (p) p.name = String(n.newname);
          else a.complete = false;
        } else a.complete = false;
      } else if (kind === 'DropStmt') {
        for (const o of array(n.objects)) {
          const ns = names(node(o).List ? node(node(o).List).items : o);
          if (n.removeType === 'OBJECT_POLICY') {
            const [schema, table, name] = ns.length === 3 ? ns : ['public', ...ns];
            a.policies = a.policies.filter(
              (p) => !(p.schema === schema && p.table === table && p.name === name),
            );
          } else if (n.removeType === 'OBJECT_TABLE') {
            const [schema, table] = ns.length === 2 ? ns : ['public', ...ns];
            tables.delete(key(schema!, table!));
            a.policies = a.policies.filter((p) => !(p.schema === schema && p.table === table));
          } else a.complete = false;
        }
      } else if (
        kind === 'GrantStmt' &&
        n.objtype === 'OBJECT_TABLE' &&
        n.targtype === 'ACL_TARGET_OBJECT'
      ) {
        for (const object of array(n.objects)) {
          const rel = relation(node(object).RangeVar);
          for (const role of array(n.grantees)) {
            const rs = node(node(role).RoleSpec);
            const name = rs.roletype === 'ROLESPEC_PUBLIC' ? 'public' : String(rs.rolename);
            const privs = array(n.privileges);
            const operations = privs.length
              ? privs.map((x) => String(node(node(x).AccessPriv).priv_name).toUpperCase())
              : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
            for (const op of operations) {
              if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(op)) continue;
              a.grants = a.grants.filter(
                (g) =>
                  !(
                    g.schema === rel.schema &&
                    g.table === rel.table &&
                    g.role === name &&
                    g.operation === op
                  ),
              );
              a.grants.push({
                ...rel,
                role: name,
                operation: op as SQLAnalysis['grants'][number]['operation'],
                granted: n.is_grant === true,
              });
            }
          }
        }
      } else if (
        ![
          'CreateSchemaStmt',
          'IndexStmt',
          'CreateFunctionStmt',
          'CreateTrigStmt',
          'CreateExtensionStmt',
          'ViewStmt',
          'CreateSeqStmt',
          'TransactionStmt',
        ].includes(kind)
      )
        a.complete = false;
      // Custom routines, triggers and extensions are opaque; catalogue state is conditional.
      if (['CreateFunctionStmt', 'CreateTrigStmt', 'CreateExtensionStmt'].includes(kind))
        a.complete = false;
    }
  a.tables = [...tables.values()];
  if (
    a.tables.length > 50 ||
    a.policies.length > 500 ||
    a.grants.length > 2000 ||
    a.tables.reduce((n, t) => n + t.columns.length, 0) > 2000
  ) {
    a.complete = false;
    a.tables = a.tables.slice(0, 50).map((t) => ({ ...t, columns: t.columns.slice(0, 40) }));
    a.policies = a.policies.slice(0, 500);
    a.grants = a.grants.slice(0, 2000);
    diagnose(files[0]?.path ?? 'schema.sql', 1, 0, 'Schema', 'SCHEMA_LIMIT');
  }
  try {
    const sql = files.map((f) => f.content).join('\n');
    a.replay_ready = !!(sql && (await (expanded ? admitRepositorySql : admitSql)(sql)).trim());
    if (expanded && a.replay_ready) a.diagnostics = [];
  } catch (e) {
    a.replay_reason = errorCode(e);
    if (expanded && e instanceof AppError && e.context.statement) {
      const culprit = a.diagnostics.find((d) => d.statement === e.context.statement);
      if (culprit)
        a.diagnostics = [
          {
            ...culprit,
            code: e.code,
            message: `${culprit.construct}: ${e.code.replaceAll('_', ' ').toLowerCase()}. No replica access conclusion.`,
          },
        ];
    }
    if (a.replay_reason === 'SQL_CONTAINS_SECRET')
      diagnose(files[0]?.path ?? 'schema.sql', 1, 0, 'Migration chain', 'SQL_CONTAINS_SECRET');
  }
  if (!a.complete) for (const t of a.tables) t.rls_enabled = null;
  if (a.statements > 2000) {
    a.replay_ready = false;
    a.replay_reason = 'SQL_STATEMENT_LIMIT';
  }
  return validate('SQLAnalysis', redactValue(a));
}
