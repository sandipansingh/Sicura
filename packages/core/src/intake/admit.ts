import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { AppError } from '../errors';
import { redactText } from '../secrets/redact';
import { validate, parseStrictJson } from '../../../contracts/src/index';

type Ast = Record<string, unknown>;
export const SQL_PROFILE_VERSION = 'repository-v2';
const record = (v: unknown): Ast => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError('SQL_UNSUPPORTED');
  return v as Ast;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const keys = (v: Ast, allowed: string[]) => {
  if (Object.keys(v).some((k) => !allowed.includes(k))) throw new AppError('SQL_UNSUPPORTED');
};
const strings = (v: unknown) => list(v).map((x) => String(record(record(x).String).sval));
export function admitPath(path: string): string {
  if (
    !path ||
    path.length > 500 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    /\.(?:zip|gz|tar|exe|bin)$/i.test(path) ||
    path.includes('\0')
  )
    throw new AppError('INPUT_PATH_INVALID');
  const safe = redactText(path);
  if (safe !== path) throw new AppError('INPUT_PATH_INVALID');
  return path;
}
function relation(v: unknown, schemas: Set<string>): void {
  const r = record(v);
  keys(r, ['schemaname', 'relname', 'inh', 'relpersistence', 'location']);
  if (
    !schemas.has(String(r.schemaname ?? 'public')) ||
    r.relpersistence !== 'p' ||
    !r.relname ||
    Buffer.byteLength(String(r.relname)) > 63
  )
    throw new AppError('SQL_UNSUPPORTED');
}
function expression(v: unknown, depth = 0): void {
  if (depth > 100) throw new AppError('SQL_DEPTH_LIMIT');
  if (v === undefined) return;
  const wrapper = record(v);
  const [name] = Object.keys(wrapper);
  if (!name || Object.keys(wrapper).length !== 1) throw new AppError('SQL_UNSUPPORTED');
  const node = record(wrapper[name]);
  switch (name) {
    case 'A_Const':
      keys(node, ['ival', 'fval', 'sval', 'boolval', 'isnull', 'location']);
      break;
    case 'ColumnRef':
      keys(node, ['fields', 'location']);
      if (strings(node.fields).length !== 1) throw new AppError('SQL_UNSUPPORTED');
      break;
    case 'BoolExpr':
      keys(node, ['boolop', 'args', 'location']);
      if (!['AND_EXPR', 'OR_EXPR', 'NOT_EXPR'].includes(String(node.boolop)))
        throw new AppError('SQL_UNSUPPORTED');
      for (const a of list(node.args)) expression(a, depth + 1);
      break;
    case 'NullTest':
      keys(node, ['arg', 'nulltesttype', 'argisrow', 'location']);
      expression(node.arg, depth + 1);
      break;
    case 'A_Expr':
      keys(node, ['kind', 'name', 'lexpr', 'rexpr', 'location']);
      if (
        !['AEXPR_OP', 'AEXPR_BETWEEN', 'AEXPR_IN'].includes(String(node.kind)) ||
        strings(node.name).some(
          (s) => !['=', '<>', '!=', '<', '>', '<=', '>=', 'BETWEEN'].includes(s),
        )
      )
        throw new AppError('SQL_UNSUPPORTED');
      expression(node.lexpr, depth + 1);
      expression(node.rexpr, depth + 1);
      break;
    case 'List':
      keys(node, ['items']);
      for (const a of list(node.items)) expression(a, depth + 1);
      break;
    case 'FuncCall':
      keys(node, ['funcname', 'args', 'funcformat', 'location']);
      if (
        !['auth.uid', 'auth.role', 'auth.jwt', 'length', 'pg_catalog.length'].includes(
          strings(node.funcname).join('.'),
        )
      )
        throw new AppError('SQL_UNSUPPORTED');
      for (const a of list(node.args)) expression(a, depth + 1);
      break;
    case 'SubLink':
      keys(node, ['subLinkType', 'subselect', 'location']);
      if (node.subLinkType !== 'EXPR_SUBLINK') throw new AppError('SQL_UNSUPPORTED');
      expression(node.subselect, depth + 1);
      break;
    case 'SelectStmt':
      keys(node, ['targetList', 'limitOption', 'op']);
      if (node.op !== 'SETOP_NONE' || list(node.targetList).length !== 1)
        throw new AppError('SQL_UNSUPPORTED');
      expression(list(node.targetList)[0], depth + 1);
      break;
    case 'ResTarget':
      keys(node, ['val', 'location']);
      expression(node.val, depth + 1);
      break;
    default:
      throw new AppError('SQL_UNSUPPORTED');
  }
}
function roles(values: unknown): void {
  for (const value of list(values)) {
    const role = record(record(value).RoleSpec);
    keys(role, ['roletype', 'rolename', 'location']);
    if (role.roletype === 'ROLESPEC_PUBLIC') continue;
    if (
      role.roletype !== 'ROLESPEC_CSTRING' ||
      !['authenticated', 'anon'].includes(String(role.rolename))
    )
      throw new AppError('SQL_UNSUPPORTED');
  }
}
const supportedTypes = [
  'uuid',
  'text',
  'varchar',
  'bpchar',
  'int2',
  'int4',
  'int8',
  'numeric',
  'bool',
  'date',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
];
function defaultExpression(value: unknown): void {
  const wrapper = record(value);
  const [name] = Object.keys(wrapper);
  if (Object.keys(wrapper).length !== 1) throw new AppError('SQL_UNSUPPORTED');
  if (name === 'A_Const') {
    expression(value);
    return;
  }
  if (name === 'TypeCast') {
    const node = record(wrapper.TypeCast);
    keys(node, ['arg', 'typeName', 'location']);
    const type = record(node.typeName);
    keys(type, ['names', 'typemod', 'location']);
    const names = strings(type.names);
    if (
      (names.length !== 1 && !(names.length === 2 && names[0] === 'pg_catalog')) ||
      !supportedTypes.includes(names.at(-1)!)
    )
      throw new AppError('SQL_UNSUPPORTED');
    const arg = record(node.arg);
    if (!arg.A_Const || Object.keys(arg).length !== 1) throw new AppError('SQL_UNSUPPORTED');
    expression(node.arg);
    return;
  }
  if (name === 'FuncCall') {
    const node = record(wrapper.FuncCall);
    keys(node, ['funcname', 'funcformat', 'location']);
    if (
      !['gen_random_uuid', 'pg_catalog.gen_random_uuid', 'now', 'pg_catalog.now'].includes(
        strings(node.funcname).join('.'),
      )
    )
      throw new AppError('SQL_UNSUPPORTED');
    return;
  }
  if (name === 'SQLValueFunction') {
    const node = record(wrapper.SQLValueFunction);
    keys(node, ['op', 'typmod', 'location']);
    if (node.op !== 'SVFOP_CURRENT_TIMESTAMP' || node.typmod !== -1)
      throw new AppError('SQL_UNSUPPORTED');
    return;
  }
  throw new AppError('SQL_UNSUPPORTED');
}
function constraint(value: unknown, schemas: Set<string>, columnName?: string): void {
  const n = record(record(value).Constraint);
  keys(n, [
    'contype',
    'conname',
    'location',
    'is_enforced',
    'initially_valid',
    'raw_expr',
    'keys',
    'pktable',
    'pk_attrs',
    'fk_attrs',
    'fk_matchtype',
    'fk_upd_action',
    'fk_del_action',
    'deferrable',
    'initdeferred',
  ]);
  if (
    ![
      'CONSTR_PRIMARY',
      'CONSTR_UNIQUE',
      'CONSTR_NOTNULL',
      'CONSTR_NULL',
      'CONSTR_CHECK',
      'CONSTR_FOREIGN',
      'CONSTR_DEFAULT',
    ].includes(String(n.contype))
  )
    throw new AppError('SQL_UNSUPPORTED');
  if (n.contype === 'CONSTR_DEFAULT') {
    defaultExpression(n.raw_expr);
    const wrapper = record(n.raw_expr);
    const literal = wrapper.TypeCast
      ? record(record(wrapper.TypeCast).arg).A_Const
      : wrapper.A_Const;
    if (literal && columnName) {
      const node = record(literal);
      const value = node.sval ? record(node.sval).sval : undefined;
      if (typeof value === 'string') {
        const context = `${columnName} = ${JSON.stringify(value)}`;
        if (redactText(context) !== context) throw new AppError('SQL_CONTAINS_SECRET');
      }
    }
  } else if (n.raw_expr) expression(n.raw_expr);
  if (n.pktable) {
    const r = record(n.pktable);
    if (r.schemaname === 'auth' && r.relname === 'users') {
      if (strings(n.pk_attrs).join('.') !== 'id') throw new AppError('SQL_UNSUPPORTED');
    } else relation(n.pktable, schemas);
  }
}
function column(value: unknown, schemas: Set<string>): void {
  const n = record(record(value).ColumnDef);
  keys(n, ['colname', 'typeName', 'is_local', 'constraints', 'location']);
  const type = record(n.typeName);
  keys(type, ['names', 'typemod', 'typmods', 'location']);
  const names = strings(type.names);
  const base = names.filter((x) => x !== 'pg_catalog').join('.');
  if (
    ![
      'uuid',
      'text',
      'varchar',
      'bpchar',
      'int2',
      'int4',
      'int8',
      'numeric',
      'bool',
      'date',
      'timestamp',
      'timestamptz',
      'json',
      'jsonb',
    ].includes(base)
  )
    throw new AppError('SQL_UNSUPPORTED');
  for (const c of list(type.typmods)) expression(c);
  for (const c of list(n.constraints)) constraint(c, schemas, String(n.colname));
}
export function checkAst(ast: Ast, knownSchemas: string[] = ['public']): void {
  if (Math.floor(Number(ast.version) / 10000) !== 17) throw new AppError('SQL_PARSER_VERSION');
  const stmts = list(ast.stmts);
  if (stmts.length > 2000) throw new AppError('SQL_STATEMENT_LIMIT');
  const schemas = new Set(knownSchemas);
  let tables = 0,
    columns = 0,
    policies = 0;
  for (const stmt of stmts) {
    const w = record(record(stmt).stmt);
    const [name] = Object.keys(w);
    const n = record(w[name!]);
    switch (name) {
      case 'CreateSchemaStmt':
        keys(n, ['schemaname']);
        if (
          !n.schemaname ||
          /^(?:auth|storage|pg_|information_schema|proofsec)/.test(String(n.schemaname))
        )
          throw new AppError('SQL_UNSUPPORTED');
        schemas.add(String(n.schemaname));
        break;
      case 'CreateStmt':
        keys(n, ['relation', 'tableElts', 'oncommit']);
        relation(n.relation, schemas);
        tables++;
        for (const c of list(n.tableElts)) {
          if (record(c).ColumnDef) {
            column(c, schemas);
            columns++;
          } else constraint(c, schemas);
        }
        break;
      case 'AlterTableStmt':
        keys(n, ['relation', 'cmds', 'objtype']);
        relation(n.relation, schemas);
        if (n.objtype !== 'OBJECT_TABLE') throw new AppError('SQL_UNSUPPORTED');
        for (const cmd of list(n.cmds)) {
          const c = record(record(cmd).AlterTableCmd);
          if (c.subtype === 'AT_AddColumn') {
            keys(c, ['subtype', 'def', 'behavior', 'missing_ok']);
            if (c.behavior !== 'DROP_RESTRICT') throw new AppError('SQL_UNSUPPORTED');
            column(c.def, schemas);
            columns++;
            continue;
          }
          keys(c, ['subtype', 'behavior']);
          if (
            ![
              'AT_EnableRowSecurity',
              'AT_DisableRowSecurity',
              'AT_ForceRowSecurity',
              'AT_NoForceRowSecurity',
            ].includes(String(c.subtype))
          )
            throw new AppError('SQL_UNSUPPORTED');
        }
        break;
      case 'IndexStmt':
        keys(n, ['idxname', 'relation', 'accessMethod', 'indexParams', 'unique', 'if_not_exists']);
        relation(n.relation, schemas);
        if (
          n.accessMethod !== 'btree' ||
          !list(n.indexParams).length ||
          list(n.indexParams).length > 32
        )
          throw new AppError('SQL_UNSUPPORTED');
        for (const element of list(n.indexParams)) {
          const e = record(record(element).IndexElem);
          keys(e, ['name', 'ordering', 'nulls_ordering']);
          if (
            typeof e.name !== 'string' ||
            !e.name ||
            !['SORTBY_DEFAULT', 'SORTBY_ASC', 'SORTBY_DESC'].includes(String(e.ordering)) ||
            !['SORTBY_NULLS_DEFAULT', 'SORTBY_NULLS_FIRST', 'SORTBY_NULLS_LAST'].includes(
              String(e.nulls_ordering),
            )
          )
            throw new AppError('SQL_UNSUPPORTED');
        }
        break;
      case 'DropStmt':
        keys(n, ['objects', 'removeType', 'behavior', 'missing_ok']);
        if (n.removeType !== 'OBJECT_POLICY' || n.behavior !== 'DROP_RESTRICT')
          throw new AppError('SQL_UNSUPPORTED');
        for (const object of list(n.objects)) {
          const item = record(record(object).List);
          keys(item, ['items']);
          const names = strings(item.items);
          if (
            ![2, 3].includes(names.length) ||
            !schemas.has(names.length === 3 ? names[0]! : 'public') ||
            names.some((s) => !s || Buffer.byteLength(s) > 63)
          )
            throw new AppError('SQL_UNSUPPORTED');
        }
        break;
      case 'CreatePolicyStmt':
        keys(n, ['policy_name', 'table', 'cmd_name', 'permissive', 'roles', 'qual', 'with_check']);
        relation(n.table, schemas);
        roles(n.roles);
        if (!['select', 'insert', 'update', 'delete', 'all'].includes(String(n.cmd_name)))
          throw new AppError('SQL_UNSUPPORTED');
        expression(n.qual);
        expression(n.with_check);
        policies++;
        break;
      case 'GrantStmt':
        keys(n, [
          'is_grant',
          'targtype',
          'objtype',
          'objects',
          'privileges',
          'grantees',
          'behavior',
        ]);
        if (
          n.targtype !== 'ACL_TARGET_OBJECT' ||
          !['OBJECT_SCHEMA', 'OBJECT_TABLE'].includes(String(n.objtype))
        )
          throw new AppError('SQL_UNSUPPORTED');
        roles(n.grantees);
        if (!list(n.privileges).length) throw new AppError('SQL_UNSUPPORTED');
        for (const p of list(n.privileges)) {
          const priv = record(record(p).AccessPriv);
          keys(priv, ['priv_name']);
          if (
            !(
              n.objtype === 'OBJECT_SCHEMA' ? ['usage'] : ['select', 'insert', 'update', 'delete']
            ).includes(String(priv.priv_name))
          )
            throw new AppError('SQL_UNSUPPORTED');
        }
        for (const o of list(n.objects)) {
          if (n.objtype === 'OBJECT_SCHEMA') {
            if (!schemas.has(String(record(record(o).String).sval)))
              throw new AppError('SQL_UNSUPPORTED');
          } else relation(record(o).RangeVar, schemas);
        }
        break;
      default:
        throw new AppError('SQL_UNSUPPORTED');
    }
  }
  if (tables > 50 || columns > 2000 || policies > 500) throw new AppError('SCHEMA_LIMIT');
}
export async function parseSql(sql: string, expanded = false): Promise<{ ast: Ast; sql: string }> {
  if (Buffer.byteLength(sql) > 2 * 1024 * 1024) throw new AppError('INPUT_LIMIT', 413);
  const parsed = await new Promise<{ ast: Ast; sql: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=128',
        resolvePath(
          process.env.PROOFSEC_ROOT_DIR ?? process.cwd(),
          'packages/core/src/intake/sql-parser.mjs',
        ),
        ...(expanded ? ['--repository-v3'] : []),
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError('SQL_PARSE_TIMEOUT'));
    }, 2000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) {
        child.kill();
        reject(new AppError('SQL_AST_LIMIT'));
      }
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new AppError('SQL_PARSE_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        try {
          const failure = parseStrictJson(output) as { error?: string; statement?: number };
          if (
            typeof failure.error === 'string' &&
            /^SQL_[A-Z_]+$|^SCHEMA_LIMIT$/.test(failure.error)
          )
            return reject(
              new AppError(
                failure.error,
                422,
                Number.isInteger(failure.statement) &&
                failure.statement! >= 1 &&
                failure.statement! <= 2000
                  ? { statement: failure.statement! }
                  : {},
              ),
            );
        } catch {
          /* Raw parser details never escape the child. */
        }
        return reject(new AppError('SQL_PARSE_FAILED'));
      }
      try {
        resolve(
          validate('ParserEnvelope', parseStrictJson(output, 16 * 1024 * 1024)) as {
            ast: Ast;
            sql: string;
          },
        );
      } catch {
        reject(new AppError('SQL_PARSE_FAILED'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(sql);
  });
  return parsed;
}
export async function admitSql(sql: string): Promise<string> {
  if (redactText(sql) !== sql) throw new AppError('SQL_CONTAINS_SECRET');
  const parsed = await parseSql(sql);
  checkAst(parsed.ast);
  return parsed.sql;
}
