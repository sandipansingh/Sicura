import type { Expectation, ExpectationEdit } from '../../../contracts/src/index';
import { expectationInvariant, validate } from '../../../contracts/src/index';
import type { SchemaSnapshot, Table } from '../rls/introspect';
import { AppError } from '../errors';
import { hash } from '../hash';

export const tuple = (e: Pick<Expectation, 'resource' | 'actor' | 'operation'>): string =>
  JSON.stringify([e.resource.schema, e.resource.table, e.actor, e.operation]);
export function classifyTable(
  table: Table,
  expectations: Expectation[],
): 'user_owned' | 'public_read' | 'shared_team' | 'unknown' {
  if (
    expectations.some(
      (e) =>
        e.resource.schema === table.schema &&
        e.resource.table === table.name &&
        e.operation === 'SELECT' &&
        e.intentionally_public,
    )
  )
    return 'public_read';
  const owners = table.columns.filter(
    (c) => c.owner_fk && c.type === 'uuid' && ['user_id', 'owner_id'].includes(c.name),
  );
  if (owners.length === 1) return 'user_owned';
  if (table.columns.some((c) => c.name === 'team_id')) return 'shared_team';
  return 'unknown';
}
export function resolveExpectations(
  snapshot: SchemaSnapshot,
  edits: ExpectationEdit[],
  prior: Expectation[] = [],
  origin: 'manifest' | 'user' = 'manifest',
  project_id = 'standalone',
): Expectation[] {
  const seen = new Set<string>();
  for (const e of edits) {
    expectationInvariant(e);
    const key = tuple(e);
    if (seen.has(key)) throw new AppError('EXPECTATION_DUPLICATE');
    seen.add(key);
    const table = snapshot.tables.find(
      (t) => t.schema === e.resource.schema && t.name === e.resource.table,
    );
    if (
      !table ||
      (e.owner_column && !table.columns.some((c) => c.name === e.owner_column && c.type === 'uuid'))
    )
      throw new AppError('EXPECTATION_BINDING_INVALID');
  }
  const result: Expectation[] = [];
  for (const table of snapshot.tables)
    for (const actor of ['authenticated', 'anon'] as const)
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const) {
        const resource = { schema: table.schema, table: table.name };
        const key = tuple({ resource, actor, operation });
        const edit = edits.find((e) => tuple(e) === key);
        const previous = prior.find((e) => tuple(e) === key);
        if (!edit && previous) {
          result.push(previous);
          continue;
        }
        const owners = table.columns.filter(
          (c) => c.owner_fk && c.type === 'uuid' && ['user_id', 'owner_id'].includes(c.name),
        );
        const inferred =
          !edit && actor === 'authenticated' && operation === 'SELECT' && owners.length === 1;
        const id = previous?.id ?? 'exp_' + hash({ project_id, key }).slice(0, 24);
        const revision = (previous?.revision ?? 0) + 1;
        result.push(
          validate('Expectation', {
            id,
            revision_id: id + '_r' + revision,
            revision,
            resource,
            actor,
            operation,
            expected: edit?.expected ?? (inferred ? 'own_rows_only' : 'unknown'),
            source: edit
              ? edit.expected === 'unknown'
                ? 'unknown'
                : 'declared'
              : inferred
                ? 'inferred'
                : 'unknown',
            origin: edit ? origin : 'heuristic',
            owner_column: edit?.owner_column ?? (inferred ? owners[0]!.name : null),
            team_binding: edit?.team_binding ?? null,
            intentionally_public: edit?.intentionally_public ?? false,
            rationale:
              edit?.rationale ??
              (inferred
                ? 'Single UUID ownership column references auth.users(id)'
                : 'Intended access has not been declared'),
            signals: inferred ? ['UUID ownership FK'] : [],
            confirmed_by: edit ? 'local_operator' : null,
            created_at: new Date().toISOString(),
          }),
        );
      }
  return result;
}
