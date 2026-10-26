import type pg from 'pg';
import type { Replica } from '../replica/manager';
import type { TestResult } from '../../../contracts/src/index';
import { validate } from '../../../contracts/src/index';
import type { Scenario } from './registry';
import { assertIdentity } from './identity';
import { USER_IDS, restoreSeeds, type SeedPlan, type Row } from './seed';
import { tableSql, quoteIdentifier } from '../rls/introspect';
import { AppError } from '../errors';
import { newId } from '../hash';

interface Query {
  sql: string;
  values: unknown[];
  key: unknown;
  expected_value: unknown;
  column: string | null;
}
function query(s: Scenario): Query {
  const seed = s.seed!;
  const table = tableSql(seed.table);
  const key = quoteIdentifier(seed.key);
  const target = seed.rows[s.target][seed.key];
  const operation = s.expectation.operation;
  if (operation === 'SELECT')
    return {
      sql: `SELECT ${key} FROM ${table} WHERE ${key}=$1`,
      values: [target],
      key: target,
      expected_value: null,
      column: null,
    };
  if (operation === 'DELETE')
    return {
      sql: `DELETE FROM ${table} WHERE ${key}=$1`,
      values: [target],
      key: target,
      expected_value: null,
      column: null,
    };
  if (operation === 'UPDATE') {
    const column =
      s.test_id === 'rls.reassign_owner.v1' ? s.expectation.owner_column! : seed.mutable!;
    const value =
      s.test_id === 'rls.reassign_owner.v1'
        ? USER_IDS[s.actor === 'user_a' ? 'user_b' : 'user_a']
        : 'Synthetic alternate';
    return {
      sql: `UPDATE ${table} SET ${quoteIdentifier(column)}=$1 WHERE ${key}=$2`,
      values: [value, target],
      key: target,
      expected_value: value,
      column,
    };
  }
  const actor = s.actor === 'user_b' ? 'user_b' : 'user_a';
  const row: Row = { ...seed.prospective[actor] };
  if (s.expectation.owner_column)
    row[s.expectation.owner_column] =
      USER_IDS[s.test_id === 'rls.insert_as_other.v1' ? s.target : actor];
  const names = Object.keys(row);
  return {
    sql: `INSERT INTO ${table} (${names.map(quoteIdentifier).join(',')}) VALUES (${names.map((_, i) => '$' + (i + 1)).join(',')})`,
    values: names.map((k) => row[k]),
    key: row[seed.key],
    expected_value: row,
    column: null,
  };
}
function code(e: unknown): string | null {
  if (
    e &&
    typeof e === 'object' &&
    'code' in e &&
    typeof e.code === 'string' &&
    /^[A-Z0-9]{5}$/.test(e.code)
  )
    return e.code;
  return null;
}
export async function executeScenario(
  replica: Replica,
  plan: SeedPlan,
  s: Scenario,
  run_id: string,
  previous: TestResult[],
): Promise<TestResult> {
  const start = performance.now();
  const result: TestResult = {
    id: newId('result'),
    run_id,
    scenario_key: s.key,
    test_id: s.test_id,
    resource: s.expectation.resource,
    operation: s.expectation.operation,
    actor: s.actor,
    target: s.target,
    expectation_id: s.expectation.id,
    expectation_revision: s.expectation.revision,
    expected: s.expected,
    observed: 'not_run',
    outcome: 'inconclusive',
    denial_mechanism: null,
    reason_code: s.reason,
    row_count: null,
    synthetic_row_aliases: [],
    sqlstate: null,
    control_result_ids: [],
    role_assertion_passed: false,
    target_existence_passed: false,
    duration_ms: 0,
    recorded_at: new Date().toISOString(),
  };
  if (s.reason) return validate('TestResult', result);
  const seed = s.seed!;
  const controls = previous.filter(
    (r) =>
      r.test_id === 'rls.own_row_access.v1' &&
      r.actor === s.actor &&
      r.resource.schema === s.expectation.resource.schema &&
      r.resource.table === s.expectation.resource.table &&
      r.expected === 'allow' &&
      (r.operation === s.expectation.operation ||
        (['UPDATE', 'DELETE'].includes(s.expectation.operation) && r.operation === 'SELECT')),
  );
  result.control_result_ids =
    s.test_id === 'rls.own_row_access.v1' ? [] : controls.map((r) => r.id);
  if (
    s.test_id !== 'rls.own_row_access.v1' &&
    s.actor !== 'anon' &&
    s.expectation.expected !== 'deny_all' &&
    (!controls.some((r) => r.operation === s.expectation.operation) ||
      controls.some((r) => r.outcome !== 'match' || r.observed !== 'allow'))
  ) {
    result.reason_code = 'POSITIVE_CONTROL_FAILED';
    return validate('TestResult', result);
  }
  let client: pg.Client | undefined;
  try {
    await restoreSeeds(replica, plan, seed);
    const q = query(s);
    const target = (
      await replica.setup.query<Row>(
        `SELECT * FROM ${tableSql(seed.table)} WHERE ${quoteIdentifier(seed.key)}=$1`,
        [seed.rows[s.target][seed.key]],
      )
    ).rows[0];
    if (
      !target ||
      (s.expectation.owner_column && target[s.expectation.owner_column] !== USER_IDS[s.target])
    )
      throw new AppError('TARGET_INVALID');
    result.target_existence_passed = true;
    // Privileged shape control is rolled back; it is never an attack observation.
    await replica.setup.query('BEGIN');
    try {
      if (plan.repository) await replica.setup.query('SET LOCAL ROLE harness_seed');
      await replica.setup.query(q.sql, q.values);
    } finally {
      await replica.setup.query('ROLLBACK');
    }
    client = await replica.connectVerifier();
    await assertIdentity(client, s);
    result.role_assertion_passed = true;
    const response = await client.query(q.sql, q.values);
    const count = response.rowCount ?? 0;
    result.row_count = count;
    if (count > 1) throw new AppError('OBSERVER_MISMATCH');
    if (s.expectation.operation === 'SELECT') {
      if (count === 1 && response.rows[0]?.[seed.key] !== q.key)
        throw new AppError('OBSERVER_MISMATCH');
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      const after = (
        await replica.setup.query<Row>(
          `SELECT * FROM ${tableSql(seed.table)} WHERE ${quoteIdentifier(seed.key)}=$1`,
          [q.key],
        )
      ).rows[0];
      let observed =
        s.expectation.operation === 'DELETE'
          ? !after
          : s.expectation.operation === 'UPDATE'
            ? after?.[q.column!] === q.expected_value
            : false;
      if (s.expectation.operation === 'INSERT') {
        const entries = Object.entries(q.expected_value as Row);
        // Let PostgreSQL compare typed values, including timestamp/numeric/JSON
        // representations, rather than comparing driver objects to seed strings.
        const predicates = entries.map(([name], index) => {
          const json = seed.table.columns.find((column) => column.name === name)?.type === 'json';
          return `${quoteIdentifier(name)}${json ? '::pg_catalog.jsonb' : ''} IS NOT DISTINCT FROM $${index + 2}${json ? '::pg_catalog.jsonb' : ''}`;
        });
        const observation = await replica.setup.query<{ matches: boolean }>(
          `SELECT (${predicates.join(' AND ')}) AS matches FROM ${tableSql(seed.table)} WHERE ${quoteIdentifier(seed.key)}=$1`,
          [q.key, ...entries.map(([, value]) => value)],
        );
        observed = observation.rows.length === 1 && observation.rows[0]!.matches;
      }
      if ((count === 1) !== observed) throw new AppError('OBSERVER_MISMATCH');
    }
    result.observed = count === 1 ? 'allow' : 'deny';
    result.denial_mechanism = count === 0 ? 'rls_filter' : null;
    result.synthetic_row_aliases =
      count === 1 ? [`${seed.table.name}_${s.target === 'user_a' ? 'a' : 'b'}`] : [];
    result.reason_code = null;
    result.outcome = result.observed === s.expected ? 'match' : 'mismatch';
  } catch (e) {
    await client?.query('ROLLBACK').catch(() => {});
    const sqlstate = code(e);
    result.sqlstate = sqlstate;
    const role = s.actor === 'anon' ? 'anon' : 'authenticated';
    const grants = seed.table.grants[role];
    const missing =
      !grants[s.expectation.operation] ||
      (['UPDATE', 'DELETE'].includes(s.expectation.operation) && !grants.SELECT);
    const rlsCheck =
      e instanceof Error && /new row violates row-level security policy/.test(e.message);
    if (
      sqlstate === '42501' &&
      result.role_assertion_passed &&
      result.target_existence_passed &&
      (missing || rlsCheck)
    ) {
      result.observed = 'deny';
      result.denial_mechanism = missing ? 'grant' : 'rls_check';
      result.reason_code = null;
      result.outcome = s.expected === 'deny' ? 'match' : 'mismatch';
    } else {
      result.observed = result.role_assertion_passed ? 'error' : 'not_run';
      result.outcome = 'inconclusive';
      result.reason_code =
        e instanceof AppError && e.code === 'IDENTITY_ASSERTION_FAILED'
          ? 'IDENTITY_ASSERTION_FAILED'
          : e instanceof AppError && e.code === 'OBSERVER_MISMATCH'
            ? 'OBSERVER_MISMATCH'
            : sqlstate === '42501'
              ? 'AMBIGUOUS_PERMISSION_ERROR'
              : sqlstate === '57014'
                ? 'STATEMENT_TIMEOUT'
                : 'CONSTRAINT_OR_SETUP_ERROR';
    }
  } finally {
    await client?.end().catch(() => {});
    result.duration_ms = performance.now() - start;
  }
  return validate('TestResult', result);
}
