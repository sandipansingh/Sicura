import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseStrictJson, validate } from '../../packages/contracts/src/index';
import { admitSql } from '../../packages/core/src/intake/admit';
import { withReplica } from '../../packages/core/src/replica/manager';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations, tuple } from '../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../packages/core/src/rls/analyze';
import { runMatrix } from '../../packages/core/src/verification/run';

it('does not invent a support warning for correct owner policies, and detects broad UPDATE checks', async () => {
  for (const id of ['R-02', 'R-05']) {
    const sql = await admitSql(await readFile(`eval/fixtures/rls/${id}/schema.sql`, 'utf8'));
    const manifest = validate(
      'ExpectationManifest',
      parseStrictJson(await readFile(`eval/fixtures/rls/${id}/expectations.json`, 'utf8'), 65536),
    );
    await withReplica(async (replica) => {
      await replica.apply(sql);
      const snapshot = await introspect(replica);
      const expectations = resolveExpectations(snapshot, manifest.expectations);
      const findings = await analyzeRls(snapshot, expectations, 'test');
      const auth = findings.filter(
        (f) =>
          f.expectation?.resource.table === 'profiles' && f.expectation.actor === 'authenticated',
      );
      if (id === 'R-02') {
        expect(auth.every((f) => !f.source.rule_ids.includes('RLS-008'))).toBe(true);
        const select = auth.find((f) => f.expectation?.operation === 'SELECT')!;
        expect(select.evidence.kind).toBe('rls');
        if (select.evidence.kind === 'rls')
          expect(select.evidence.policy_condition).not.toContain('WITH CHECK');
        const insert = auth.find((f) => f.expectation?.operation === 'INSERT')!;
        if (insert.evidence.kind === 'rls')
          expect(insert.evidence.policy_condition).not.toContain('USING');
      } else
        expect(auth.find((f) => f.expectation?.operation === 'UPDATE')?.source.rule_ids).toContain(
          'RLS-003',
        );
    });
  }
});
it('treats an omitted allow expression as a setup warning and blocks dependent probes', async () => {
  const source = await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8');
  const sql = await admitSql(source.replace('USING (true);', ';'));
  await withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica);
    const expectations = resolveExpectations(snapshot, []);
    const finding = (await analyzeRls(snapshot, expectations, 'implicit')).find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!;
    expect(finding.source.rule_ids).not.toContain('RLS-002');
    expect(finding.source.rule_ids).toContain('RLS-008');
    if (finding.evidence.kind === 'rls') {
      expect(finding.evidence.policy_condition).toContain('omitted (no allow expression)');
      expect(finding.evidence.policy_condition).not.toContain('WITH CHECK');
    }
    const observed = await runMatrix(replica, snapshot, expectations, 'implicit');
    expect(
      observed.results.filter((r) => r.test_id === 'rls.cross_user_read.v1').map((r) => r.observed),
    ).toEqual(['not_run', 'not_run']);
    expect(
      observed.results
        .filter((r) => r.test_id === 'rls.cross_user_read.v1')
        .every((r) => r.reason_code === 'POSITIVE_CONTROL_FAILED'),
    ).toBe(true);
    expect(
      observed.results
        .filter(
          (r) =>
            r.resource.table === 'profiles' &&
            r.test_id === 'rls.own_row_access.v1' &&
            r.operation === 'SELECT',
        )
        .map((r) => r.observed),
    ).toEqual(['deny', 'deny']);
  });
});
it('keeps inferred intent qualified, blocks unknown probes, and scopes public intent to one operation', async () => {
  const sql = await admitSql(await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'));
  await withReplica(async (replica) => {
    await replica.apply(sql);
    const snapshot = await introspect(replica);
    const prior = resolveExpectations(snapshot, []);
    const select = prior.find(
      (e) =>
        e.resource.table === 'profiles' && e.actor === 'authenticated' && e.operation === 'SELECT',
    )!;
    expect(select.source).toBe('inferred');
    const result = await runMatrix(replica, snapshot, prior, 'unknown');
    expect(
      result.results
        .filter((r) => prior.find((e) => e.id === r.expectation_id)?.source === 'unknown')
        .every((r) => r.observed === 'not_run' && r.reason_code === 'EXPECTATION_UNKNOWN'),
    ).toBe(true);
    const current = resolveExpectations(
      snapshot,
      [
        {
          resource: select.resource,
          actor: 'authenticated',
          operation: 'SELECT',
          expected: 'all_rows',
          owner_column: null,
          team_binding: null,
          intentionally_public: true,
          rationale: 'Human explicitly declares public read',
        },
      ],
      prior,
      'user',
    );
    const edited = current.find((e) => tuple(e) === tuple(select))!;
    expect(edited.source).toBe('declared');
    expect(edited.revision).toBe(2);
    expect(prior.find((e) => tuple(e) === tuple(select))?.source).toBe('inferred');
    expect(
      current.find(
        (e) =>
          e.resource.table === 'profiles' &&
          e.actor === 'authenticated' &&
          e.operation === 'INSERT',
      )?.source,
    ).toBe('unknown');
    const findings = await analyzeRls(snapshot, current, 'edited');
    expect(findings.find((f) => f.expectation?.id === edited.id)?.suppression?.reason).toBe(
      'intentionally_public',
    );
    expect(() =>
      resolveExpectations(snapshot, [{ ...edited, actor: 'anon', expected: 'own_rows_only' }]),
    ).toThrow();
  });
});
