import type { Expectation, TestId, TestResult } from '../../../contracts/src/index';
import type { SeedPlan, SeedTable } from './seed';
import { hash } from '../hash';
import { tableSql } from '../rls/introspect';

export interface Scenario {
  test_id: TestId;
  actor: TestResult['actor'];
  target: 'user_a' | 'user_b';
  expectation: Expectation;
  seed: SeedTable | undefined;
  expected: 'allow' | 'deny' | null;
  reason: TestResult['reason_code'];
  key: string;
}
export const claims = (actor: TestResult['actor']) =>
  actor === 'anon'
    ? { role: 'anon' }
    : {
        sub:
          actor === 'user_a'
            ? '00000000-0000-4000-8000-000000000001'
            : '00000000-0000-4000-8000-000000000002',
        role: 'authenticated',
        aud: 'authenticated',
      };
export const CLAIMS_DIGEST = hash(
  ['user_a', 'user_b', 'anon'].map((a) => claims(a as TestResult['actor'])),
);
export function planMatrix(
  expectations: Expectation[],
  plan: SeedPlan,
  selectOnly = false,
): Scenario[] {
  const result: Scenario[] = [];
  const add = (
    e: Expectation,
    test_id: TestId,
    actor: Scenario['actor'],
    target: Scenario['target'],
    expected: Scenario['expected'],
  ) => {
    const seed = plan.tables.find(
      (t) => t.table.schema === e.resource.schema && t.table.name === e.resource.table,
    );
    const reason =
      e.source === 'unknown'
        ? 'EXPECTATION_UNKNOWN'
        : e.expected === 'team_rows_only'
          ? 'TEAM_SEMANTICS_UNSUPPORTED'
          : !seed
            ? ((plan.unsupported[tableSql({ schema: e.resource.schema, name: e.resource.table })] ??
                'TYPE_UNSUPPORTED') as Scenario['reason'])
            : e.operation === 'UPDATE' && !seed.mutable && test_id !== 'rls.reassign_owner.v1'
              ? 'NO_MUTABLE_COLUMN'
              : null;
    const key = hash({
      registry_version: '1',
      test_id,
      resource: e.resource,
      operation: e.operation,
      actor,
      target,
      expected,
      seed_digest: plan.digest,
      claims_digest: CLAIMS_DIGEST,
      expectation_id: e.id,
      expectation_revision: e.revision,
      key_bindings: seed?.key ?? null,
      mutation: seed?.mutable ?? null,
    });
    result.push({ test_id, actor, target, expectation: e, seed, expected, reason, key });
  };
  for (const e of expectations) {
    if (selectOnly && e.operation !== 'SELECT') continue;
    if (e.actor === 'anon') {
      add(
        e,
        'rls.anon_access.v1',
        'anon',
        'user_a',
        e.expected === 'all_rows' ? 'allow' : e.source === 'unknown' ? null : 'deny',
      );
      continue;
    }
    for (const actor of ['user_a', 'user_b'] as const)
      add(
        e,
        'rls.own_row_access.v1',
        actor,
        actor,
        e.source === 'unknown' ? null : e.expected === 'deny_all' ? 'deny' : 'allow',
      );
    if (e.owner_column && e.source !== 'unknown')
      for (const actor of ['user_a', 'user_b'] as const) {
        const other = actor === 'user_a' ? 'user_b' : 'user_a';
        const ids: Record<Expectation['operation'], TestId> = {
          SELECT: 'rls.cross_user_read.v1',
          UPDATE: 'rls.cross_user_update.v1',
          DELETE: 'rls.cross_user_delete.v1',
          INSERT: 'rls.insert_as_other.v1',
        };
        add(e, ids[e.operation], actor, other, e.expected === 'all_rows' ? 'allow' : 'deny');
        if (e.operation === 'UPDATE')
          add(
            e,
            'rls.reassign_owner.v1',
            actor,
            actor,
            e.expected === 'all_rows' ? 'allow' : 'deny',
          );
      }
  }
  // Expected-ALLOW controls run first and cannot be omitted by AI suggestions.
  return result.sort(
    (a, b) =>
      Number(b.test_id === 'rls.own_row_access.v1') - Number(a.test_id === 'rls.own_row_access.v1'),
  );
}
