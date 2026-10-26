import factory from './vendor/pg-query.mjs';
import fields from './sql-node-fields.json' with { type: 'json' };
import plFields from './pl-node-fields.json' with { type: 'json' };
import catalogueBuiltins from './postgres-builtin-names.json' with { type: 'json' };

const node = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const names = (v) => list(v).map((x) => String(node(x.String).sval ?? ''));
const fail = (code = 'SQL_UNSUPPORTED') => {
  throw new Error(code);
};
const builtins = new Set(
  `auth.uid auth.role auth.jwt storage.foldername gen_random_uuid uuid_generate_v4 now current_timestamp length char_length btrim jsonb_typeof row_number acldefault aclexplode avg count encode digest format has_function_privilege has_table_privilege hashtextextended jsonb_agg jsonb_build_array jsonb_build_object jsonb_each left lower lpad make_interval max nextval pg_advisory_xact_lock position pg_get_constraintdef power quote_ident replace round string_agg sum to_jsonb to_regclass to_regprocedure unnest upper`.split(
    ' ',
  ),
);
const types = new Set(
  `uuid text varchar bpchar int2 int4 int8 numeric bool date timestamp timestamptz json jsonb float4 float8 interval record void trigger regclass regprocedure oid name aclitem`.split(
    ' ',
  ),
);
const operators = new Set(
  `= <> != < > <= >= IN BETWEEN + - * / % || -> ->> #> #>> @> <@ ? ?| ?& ~~ !~~ ~~* !~~* ~ !~ ~* !~*`.split(
    ' ',
  ),
);
const reservedFunctions = new Set(catalogueBuiltins);
const top = new Set(
  `CreateSchemaStmt CreateExtensionStmt CreateStmt AlterTableStmt IndexStmt CreatePolicyStmt AlterPolicyStmt CreateFunctionStmt CreateTrigStmt CreateSeqStmt ViewStmt DropStmt GrantStmt AlterDefaultPrivilegesStmt RenameStmt DoStmt InsertStmt UpdateStmt TransactionStmt`.split(
    ' ',
  ),
);
const routineStatements = new Set(
  `SelectStmt InsertStmt UpdateStmt DeleteStmt PLAssignStmt`.split(' '),
);
const catalogTables = new Set(
  `pg_class pg_namespace pg_proc pg_constraint pg_attribute pg_roles pg_default_acl pg_policy pg_trigger pg_index pg_type pg_auth_members`.split(
    ' ',
  ),
);
const m = await factory({ print: () => {}, printErr: () => {} });
function parse(query, mode = 0, pl = false) {
  const length = m.lengthBytesUTF8(query) + 1,
    ptr = m._malloc(length);
  let result = 0;
  try {
    m.stringToUTF8(query, ptr, length);
    result = pl ? m._parse_plpgsql(ptr) : m._parse_sql(ptr, mode);
    if (!result) fail('SQL_ROUTINE_PARSE_FAILED');
    return JSON.parse(m.UTF8ToString(result));
  } finally {
    m._free(result);
    m._free(ptr);
  }
}
function objectName(parts, schemas, trusted = false) {
  if (!parts.length || parts.length > 2 || parts.some((p) => !p || Buffer.byteLength(p) > 63))
    fail();
  const schema = parts.length === 2 ? parts[0] : 'public';
  if (
    !schemas.has(schema) &&
    !(trusted && ['auth', 'storage', 'extensions', 'pg_catalog'].includes(schema))
  )
    fail('SQL_NAMESPACE_UNSUPPORTED');
}
function relation(r, ctx, write = false) {
  r = node(r);
  if (r.catalogname) fail('SQL_NAMESPACE_UNSUPPORTED');
  const schema = r.schemaname ?? 'public';
  if (!r.relname || Buffer.byteLength(r.relname) > 63) fail();
  if (ctx.schemas.has(schema)) return;
  if (schema === 'auth' && r.relname === 'users') return;
  if (schema === 'storage' && ['objects', 'buckets'].includes(r.relname)) return;
  if (
    !write &&
    ((schema === 'pg_catalog' && catalogTables.has(r.relname)) ||
      (schema === 'public' && catalogTables.has(r.relname)))
  )
    return;
  if (!write && schema === 'supabase_migrations' && r.relname === 'schema_migrations') return;
  if (
    !write &&
    schema === 'information_schema' &&
    [
      'tables',
      'columns',
      'routines',
      'table_constraints',
      'constraint_column_usage',
      'key_column_usage',
    ].includes(r.relname)
  )
    return;
  const error = new Error('SQL_NAMESPACE_UNSUPPORTED');
  error.relation = { schema, table: r.relname };
  throw error;
}
function walk(value, ctx, depth = 0) {
  if (depth > 100) fail('SQL_DEPTH_LIMIT');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v) => walk(v, ctx, depth + 1));
    return;
  }
  for (const [tag, n] of Object.entries(value)) {
    // PostgreSQL embeds these structs without a tagged node wrapper.
    if (['typeName', 'argType', 'returnType'].includes(tag)) walk({ TypeName: n }, ctx, depth + 1);
    if (/^[A-Z]/.test(tag)) {
      if (!fields[tag] || Object.keys(node(n)).some((k) => !fields[tag].includes(k))) {
        const error = new Error('SQL_NODE_UNSUPPORTED');
        error.construct = tag;
        error.field = Object.keys(node(n)).find((k) => !fields[tag]?.includes(k));
        throw error;
      }
      if (tag === 'FuncCall') {
        const parts = names(n.funcname),
          name = parts.join('.');
        const builtin =
          (parts.length === 1 || ['pg_catalog', 'extensions'].includes(parts[0])) &&
          builtins.has(parts.at(-1));
        if (
          !builtins.has(name) &&
          !builtin &&
          !(parts.length === 2 && ctx.functions.has(name)) &&
          !(
            parts.length === 1 &&
            !reservedFunctions.has(name) &&
            ctx.functions.has('public.' + name)
          )
        )
          fail('SQL_CALL_UNSUPPORTED');
      }
      if (tag === 'TypeName') {
        const parts = names(n.names),
          base = parts.at(-1);
        if (
          (!types.has(base) &&
            !ctx.composites.has(parts.length === 1 ? 'public.' + base : parts.join('.'))) ||
          (parts.length > 1 && parts[0] !== 'pg_catalog' && !ctx.schemas.has(parts[0])) ||
          n.pct_type
        )
          fail('SQL_TYPE_UNSUPPORTED');
      }
      if (tag === 'RangeVar') relation(n, ctx);
      if (['InsertStmt', 'UpdateStmt', 'DeleteStmt'].includes(tag)) relation(n.relation, ctx, true);
      if (
        tag === 'RoleSpec' &&
        n.roletype !== 'ROLESPEC_PUBLIC' &&
        (n.roletype !== 'ROLESPEC_CSTRING' ||
          !['anon', 'authenticated', 'service_role'].includes(n.rolename))
      )
        fail('SQL_ROLE_UNSUPPORTED');
      if (tag === 'A_Expr' && names(n.name).some((x) => !operators.has(x)))
        fail('SQL_OPERATOR_UNSUPPORTED');
      if (tag === 'RangeFunction' && n.is_rowsfrom) fail();
      if (tag === 'VariableSetStmt') {
        if (!ctx.functionOptions || n.name !== 'search_path' || n.kind !== 'VAR_SET_VALUE')
          fail('SQL_SETTING_UNSUPPORTED');
        for (const a of list(n.args)) {
          const s = a.A_Const?.sval?.sval;
          if (!s || ![...ctx.schemas, 'pg_catalog', 'pg_temp', 'extensions'].includes(s))
            fail('SQL_SETTING_UNSUPPORTED');
        }
      }
      if (
        tag === 'CreateExtensionStmt' &&
        !['uuid-ossp', 'pgcrypto', 'pg_trgm'].includes(n.extname)
      )
        fail('SQL_EXTENSION_UNSUPPORTED');
      if (
        tag === 'CreateSchemaStmt' &&
        (!n.schemaname ||
          /^(?:auth|storage|extensions|pg_|information_schema|proofsec)/.test(n.schemaname))
      )
        fail('SQL_NAMESPACE_UNSUPPORTED');
      if (['CreateStmt', 'AlterTableStmt', 'IndexStmt', 'CreateTrigStmt'].includes(tag))
        relation(n.relation, ctx, true);
      if (tag === 'IndexStmt' && !['btree', 'gin'].includes(n.accessMethod))
        fail('SQL_INDEX_UNSUPPORTED');
      if (tag === 'IndexElem' && names(n.opclass).some((x) => !['gin_trgm_ops'].includes(x)))
        fail('SQL_INDEX_UNSUPPORTED');
      if (
        tag === 'AlterTableCmd' &&
        ![
          'AT_AddColumn',
          'AT_AddConstraint',
          'AT_DropConstraint',
          'AT_SetNotNull',
          'AT_DropNotNull',
          'AT_ColumnDefault',
          'AT_EnableRowSecurity',
          'AT_DisableRowSecurity',
          'AT_ForceRowSecurity',
          'AT_NoForceRowSecurity',
        ].includes(n.subtype)
      )
        fail('SQL_ALTER_UNSUPPORTED');
      if (tag === 'CreateFunctionStmt') objectName(names(n.funcname), ctx.schemas);
      if (['CreatePolicyStmt', 'AlterPolicyStmt'].includes(tag)) relation(n.table, ctx, true);
      if (tag === 'CreateSeqStmt') relation(n.sequence, ctx, true);
      if (tag === 'ViewStmt') relation(n.view, ctx, true);
      if (
        tag === 'DropStmt' &&
        (![
          'OBJECT_POLICY',
          'OBJECT_TRIGGER',
          'OBJECT_FUNCTION',
          'OBJECT_TABLE',
          'OBJECT_INDEX',
          'OBJECT_VIEW',
          'OBJECT_SEQUENCE',
        ].includes(n.removeType) ||
          n.behavior !== 'DROP_RESTRICT')
      )
        fail('SQL_DROP_UNSUPPORTED');
      if (tag === 'ObjectWithArgs') objectName(names(n.objname), ctx.schemas);
      if (tag === 'DropStmt') {
        for (const object of list(n.objects)) {
          if (object.ObjectWithArgs) continue;
          const parts = names(object.List?.items);
          if (['OBJECT_POLICY', 'OBJECT_TRIGGER'].includes(n.removeType)) {
            const target = parts.slice(0, -1);
            relation(
              { schemaname: target.length === 2 ? target[0] : 'public', relname: target.at(-1) },
              ctx,
              true,
            );
          } else objectName(parts, ctx.schemas);
        }
      }
      if (tag === 'GrantStmt') {
        if (
          !['OBJECT_TABLE', 'OBJECT_FUNCTION', 'OBJECT_SEQUENCE', 'OBJECT_SCHEMA'].includes(
            n.objtype,
          ) ||
          n.grant_option ||
          !['ACL_TARGET_OBJECT', 'ACL_TARGET_ALL_IN_SCHEMA'].includes(n.targtype)
        )
          fail('SQL_GRANT_UNSUPPORTED');
        for (const p of list(n.privileges))
          if (
            p.AccessPriv?.priv_name &&
            ![
              'select',
              'insert',
              'update',
              'delete',
              'execute',
              'usage',
              'references',
              'trigger',
              'truncate',
            ].includes(p.AccessPriv.priv_name)
          )
            fail('SQL_GRANT_UNSUPPORTED');
        for (const o of list(n.objects))
          if (o.RangeVar) relation(o.RangeVar, ctx, true);
          else if (o.String && !ctx.schemas.has(o.String.sval)) fail('SQL_NAMESPACE_UNSUPPORTED');
      }
      if (tag === 'DefElem' && n.defname === 'roles') fail('SQL_ROLE_UNSUPPORTED');
      if (tag === 'RenameStmt') {
        if (n.renameType !== 'OBJECT_FUNCTION') fail('SQL_ALTER_UNSUPPORTED');
        objectName(names(n.object?.ObjectWithArgs?.objname), ctx.schemas);
        if (!n.newname || Buffer.byteLength(n.newname) > 63) fail();
      }
    }
    walk(n, ctx, depth + 1);
  }
}
function valueOfExpr(ast) {
  return ast.stmts?.[0]?.stmt?.SelectStmt?.targetList?.[0]?.ResTarget?.val;
}
function catalogueLoop(ast) {
  const s = ast.stmts?.length === 1 && ast.stmts[0].stmt.SelectStmt;
  if (
    !s ||
    s.withClause ||
    s.op !== 'SETOP_NONE' ||
    s.targetList?.length !== 1 ||
    s.fromClause?.length !== 1
  )
    return false;
  const join = s.fromClause[0].JoinExpr;
  const p = join?.larg?.RangeVar,
    n = join?.rarg?.RangeVar;
  if (
    !p ||
    !n ||
    join.jointype !== 'JOIN_INNER' ||
    p.relname !== 'pg_proc' ||
    n.relname !== 'pg_namespace' ||
    [p, n].some((r) => r.schemaname && r.schemaname !== 'pg_catalog')
  )
    return false;
  const pa = p.alias?.aliasname ?? p.relname,
    na = n.alias?.aliasname ?? n.relname;
  const ref = (v) => names(v?.ColumnRef?.fields).join('.');
  const eq = (v, left, right) =>
    v?.A_Expr?.kind === 'AEXPR_OP' &&
    names(v.A_Expr.name).join('.') === '=' &&
    ref(v.A_Expr.lexpr) === left &&
    ref(v.A_Expr.rexpr) === right;
  const target = s.targetList[0].ResTarget?.val?.TypeCast;
  if (
    !target ||
    names(target.typeName.names).join('.') !== 'regprocedure' ||
    ref(target.arg) !== `${pa}.oid` ||
    !eq(join.quals, `${na}.oid`, `${pa}.pronamespace`)
  )
    return false;
  const restrictsPublic = (v) => {
    if (v?.BoolExpr?.boolop === 'AND_EXPR') return v.BoolExpr.args.some(restrictsPublic);
    const e = v?.A_Expr;
    return (
      e?.kind === 'AEXPR_OP' &&
      names(e.name).join('.') === '=' &&
      ref(e.lexpr) === `${na}.nspname` &&
      e.rexpr?.A_Const?.sval?.sval === 'public'
    );
  };
  return restrictsPublic(s.whereClause);
}
function dynamic(expr, ctx, loop) {
  const ast = parse(expr.query, expr.parseMode),
    v = valueOfExpr(ast);
  const literal = v?.A_Const?.sval?.sval;
  if (typeof literal === 'string') {
    const a = parse(literal);
    for (const s of a.stmts ?? []) {
      if (!['GrantStmt', 'SelectStmt'].includes(Object.keys(s.stmt)[0]))
        fail('SQL_DYNAMIC_UNSUPPORTED');
      walk(s.stmt, ctx);
    }
    return;
  }
  const concat = v?.A_Expr;
  if (
    concat &&
    names(concat.name).join('') === '||' &&
    concat.lexpr?.A_Const?.sval?.sval &&
    concat.rexpr?.FuncCall &&
    names(concat.rexpr.FuncCall.funcname).join('.') === 'quote_ident' &&
    concat.rexpr.FuncCall.args?.length === 1
  ) {
    const prefix = concat.lexpr.A_Const.sval.sval;
    const a = parse(prefix + '"synthetic_constraint"');
    if (
      a.stmts.length !== 1 ||
      !a.stmts[0].stmt.AlterTableStmt ||
      a.stmts[0].stmt.AlterTableStmt.cmds.some(
        (x) => x.AlterTableCmd.subtype !== 'AT_DropConstraint',
      )
    )
      fail('SQL_DYNAMIC_UNSUPPORTED');
    walk(a.stmts[0].stmt, ctx);
    return;
  }
  const f = v?.FuncCall;
  if (f && names(f.funcname).join('.') === 'format' && f.args?.length === 2 && loop) {
    const template = f.args[0]?.A_Const?.sval?.sval,
      ref = names(f.args[1]?.ColumnRef?.fields).join('.');
    if (
      loop.name === ref &&
      loop.catalogue &&
      [
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
      ].includes(template)
    )
      return;
  }
  fail('SQL_DYNAMIC_UNSUPPORTED');
}
function plwalk(value, ctx, loop = null, depth = 0) {
  if (depth > 100) fail('SQL_DEPTH_LIMIT');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v) => plwalk(v, ctx, loop, depth + 1));
    return;
  }
  for (const [tag, n] of Object.entries(value)) {
    if (tag.startsWith('PLpgSQL_')) {
      if (!plFields[tag] || Object.keys(n).some((k) => !plFields[tag].includes(k)))
        fail('SQL_ROUTINE_NODE_UNSUPPORTED');
      if (
        loop &&
        ((tag === 'PLpgSQL_stmt_assign' && loop.varnos.includes(n.varno)) ||
          (tag === 'PLpgSQL_stmt_execsql' &&
            list(n.target?.PLpgSQL_row?.fields).some((f) => f.name === loop.name)))
      )
        fail('SQL_DYNAMIC_UNSUPPORTED');
      if (tag === 'PLpgSQL_stmt_dynexecute') {
        dynamic(n.query.PLpgSQL_expr, ctx, loop);
        continue;
      }
      if (tag === 'PLpgSQL_stmt_fors') {
        const e = n.query.PLpgSQL_expr,
          a = parse(e.query, e.parseMode);
        const row = n.var.PLpgSQL_row;
        // Finite application-function catalogue, not an argument or source-controlled SQL string.
        const catalogue = catalogueLoop(a);
        const name = row?.fields?.[0]?.name ?? n.var.PLpgSQL_var?.refname;
        const varnos = list(row?.fields).map((f) => f.varno);
        walk(a, ctx);
        plwalk(n.body, ctx, { name, catalogue, varnos }, depth + 1);
        continue;
      }
      if (tag === 'PLpgSQL_expr') {
        const a = parse(n.query, n.parseMode);
        for (const s of a.stmts ?? []) {
          const tag = Object.keys(s.stmt)[0];
          if (
            !routineStatements.has(tag) &&
            !(ctx.doBlock && ['AlterTableStmt', 'GrantStmt'].includes(tag))
          ) {
            const error = new Error('SQL_ROUTINE_STATEMENT_UNSUPPORTED');
            error.construct = tag;
            throw error;
          }
        }
        walk(a, ctx);
        continue;
      }
    }
    plwalk(n, ctx, loop, depth + 1);
  }
}
export function validateRepositoryAst(ast, sql) {
  if (Math.floor(ast.version / 10000) !== 17) fail('SQL_PARSER_VERSION');
  if (!ast.stmts.length || ast.stmts.length > 2000) fail('SQL_STATEMENT_LIMIT');
  const schemas = new Set(['public']),
    functions = new Set(),
    composites = new Set();
  for (const s of ast.stmts) {
    const n = s.stmt.CreateSchemaStmt;
    if (n) schemas.add(n.schemaname);
    const table = s.stmt.CreateStmt?.relation;
    if (table) composites.add((table.schemaname ?? 'public') + '.' + table.relname);
    const f = s.stmt.CreateFunctionStmt;
    if (f) {
      const p = names(f.funcname);
      functions.add(p.length === 1 ? 'public.' + p[0] : p.join('.'));
    }
    const r = s.stmt.RenameStmt;
    if (r?.renameType === 'OBJECT_FUNCTION') {
      const p = names(r.object?.ObjectWithArgs?.objname);
      functions.add((p.length === 2 ? p[0] : 'public') + '.' + r.newname);
    }
  }
  const ctx = { schemas, functions, composites, functionOptions: false };
  let transaction = false;
  for (const [index, s] of ast.stmts.entries()) {
    try {
      const [tag, n] = Object.entries(s.stmt)[0];
      if (!top.has(tag)) fail();
      if (tag === 'TransactionStmt') {
        if (n.kind === 'TRANS_STMT_BEGIN' && !transaction) transaction = true;
        else if (n.kind === 'TRANS_STMT_COMMIT' && transaction) transaction = false;
        else fail('SQL_TRANSACTION_UNSUPPORTED');
      }
      if (tag === 'CreateFunctionStmt') {
        const options = n.options.map((x) => x.DefElem),
          language = options.find((x) => x.defname === 'language')?.arg?.String?.sval;
        if (
          !['sql', 'plpgsql'].includes(language) ||
          options.some(
            (x) =>
              ![
                'as',
                'language',
                'security',
                'volatility',
                'set',
                'parallel',
                'strict',
                'cost',
                'rows',
              ].includes(x.defname),
          )
        )
          fail('SQL_FUNCTION_UNSUPPORTED');
        if (n.returnType) walk({ TypeName: n.returnType }, ctx);
        for (const p of n.parameters ?? []) walk({ TypeName: p.FunctionParameter.argType }, ctx);
        walk(s.stmt, { ...ctx, functionOptions: true });
        if (language === 'sql') {
          const body = options.find((x) => x.defname === 'as')?.arg?.List?.items;
          if (body?.length !== 1) fail();
          const a = parse(body[0].String.sval);
          for (const st of a.stmts) if (!routineStatements.has(Object.keys(st.stmt)[0])) fail();
          walk(a, ctx);
        } else {
          const end = s.stmt_len ? (s.stmt_location ?? 0) + s.stmt_len : Buffer.byteLength(sql);
          const pl = parse(
            Buffer.from(sql)
              .subarray(s.stmt_location ?? 0, end)
              .toString('utf8'),
            0,
            true,
          );
          if (pl.length !== 1) fail('SQL_ROUTINE_PARSE_FAILED');
          plwalk(pl, ctx);
        }
      } else if (tag === 'DoStmt') {
        if (
          n.args.some(
            (x) => x.DefElem.defname === 'language' && x.DefElem.arg?.String?.sval !== 'plpgsql',
          )
        )
          fail('SQL_FUNCTION_UNSUPPORTED');
        walk(s.stmt, ctx);
        const end = s.stmt_len ? (s.stmt_location ?? 0) + s.stmt_len : Buffer.byteLength(sql);
        const pl = parse(
          Buffer.from(sql)
            .subarray(s.stmt_location ?? 0, end)
            .toString('utf8'),
          0,
          true,
        );
        if (pl.length !== 1) fail('SQL_ROUTINE_PARSE_FAILED');
        plwalk(pl, { ...ctx, doBlock: true });
      } else walk(s.stmt, ctx);
    } catch (error) {
      error.statement = index + 1;
      throw error;
    }
  }
  if (transaction) fail('SQL_TRANSACTION_UNSUPPORTED');
  if (ast.stmts.filter((s) => s.stmt.CreateStmt).length > 50) fail('SCHEMA_LIMIT');
  return true;
}
