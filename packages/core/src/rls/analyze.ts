import { parse } from 'pgsql-parser';
import type { Expectation, Finding } from '../../../contracts/src/index';
import { validate } from '../../../contracts/src/index';
import type { SchemaSnapshot } from './introspect';
import { classifyTable } from '../expectations/resolve';
import { newId } from '../hash';
import { redactText } from '../secrets/redact';

type Node = Record<string, unknown>;
function truth(value: unknown): boolean | null {
  if (!value || typeof value !== 'object') return null;
  const n = value as Node;
  if (n.A_Const) {
    const c = n.A_Const as Node;
    if (c.boolval) return ((c.boolval as Node).boolval ?? false) as boolean;
  }
  if (n.BoolExpr) {
    const b = n.BoolExpr as Node;
    const args = (b.args as unknown[]).map(truth);
    if (b.boolop === 'OR_EXPR' && args.includes(true)) return true;
    if (b.boolop === 'AND_EXPR' && args.every((a) => a === true)) return true;
    if (b.boolop === 'NOT_EXPR' && args[0] !== null) return !args[0];
  }
  if (n.TypeCast) return truth((n.TypeCast as Node).arg);
  return null;
}
async function constantTrue(expression: string | null): Promise<boolean> {
  if (!expression) return false;
  const ast = await parse(`SELECT (${expression})`);
  const root = ast.stmts[0]?.stmt as unknown as Node;
  const select = root.SelectStmt as Node;
  const target = (select.targetList as Node[])[0]!.ResTarget as Node;
  return truth(target.val) === true;
}
export async function analyzeRls(
  snapshot: SchemaSnapshot,
  expectations: Expectation[],
  project_id: string,
  input_revision = 1,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const e of expectations) {
    const table = snapshot.tables.find(
      (t) => t.schema === e.resource.schema && t.name === e.resource.table,
    )!;
    const policies = table.policies.filter(
      (p) =>
        (p.command === e.operation || p.command === 'ALL') &&
        (p.roles.includes(e.actor) || p.roles.includes('public')),
    );
    const rule_ids: string[] = [];
    if (!table.rls_enabled && table.grants[e.actor][e.operation]) rule_ids.push('RLS-001');
    const broad = [];
    const broadChecks = [];
    for (const policy of policies)
      if (policy.permissive) {
        if (e.operation !== 'INSERT' && (await constantTrue(policy.using))) broad.push(policy);
        if (
          ['INSERT', 'UPDATE'].includes(e.operation) &&
          (await constantTrue(policy.check ?? policy.using))
        )
          broadChecks.push(policy);
      }
    if (broad.length) rule_ids.push('RLS-002');
    if (broadChecks.length) rule_ids.push('RLS-003');
    if (policies.filter((p) => p.permissive).length > 1 && (broad.length || broadChecks.length))
      rule_ids.push('RLS-004');
    if (e.actor === 'anon' && broad.length && classifyTable(table, []) === 'user_owned')
      rule_ids.push('RLS-006');
    const hasUsing = policies.some((p) => p.permissive && p.using !== null);
    const hasCheck = policies.some((p) => p.permissive && (p.check ?? p.using) !== null);
    const hasApplicableAllow =
      e.operation === 'INSERT'
        ? hasCheck
        : e.operation === 'UPDATE'
          ? hasUsing && hasCheck
          : hasUsing;
    if (
      !table.grants[e.actor][e.operation] ||
      (table.rls_enabled && !hasApplicableAllow) ||
      (['UPDATE', 'DELETE'].includes(e.operation) && !table.grants[e.actor].SELECT)
    )
      rule_ids.push('RLS-008');
    // Every expectation is represented so the harness can create RLS-009 after a mismatch.
    const now = new Date().toISOString();
    const evidence_id = newId('evidence');
    const ids = rule_ids;
    const test = {
      SELECT: 'rls.cross_user_read.v1',
      INSERT: 'rls.insert_as_other.v1',
      UPDATE: 'rls.cross_user_update.v1',
      DELETE: 'rls.cross_user_delete.v1',
    } as const;
    findings.push(
      validate('Finding', {
        schema_version: '1.0',
        id: newId('finding'),
        project_id,
        revision: 1,
        input_revision,
        category: 'RLS_MISCONFIGURATION',
        title: redactText(
          `${broad.length || broadChecks.length ? 'Potentially over-broad' : 'Access configuration for'} ${e.operation} policy on ${table.name}`,
        ),
        severity: e.intentionally_public ? 'info' : 'medium',
        severity_basis: 'Catalogue facts require an expected-vs-observed comparison',
        confidence: {
          level: e.source === 'unknown' ? 'low' : 'medium',
          basis: 'Static catalogue facts; access has not been observed',
        },
        source: { kind: 'catalog', analyzer_version: '1.0.0', rule_ids: ids },
        location: {
          kind: 'database',
          resource: e.resource,
          policy_names: policies.map((p) => redactText(p.name)),
          operation: e.operation,
        },
        evidence: {
          kind: 'rls',
          id: evidence_id,
          rule_ids: ids,
          operation: e.operation,
          role: e.actor,
          rls_enabled: table.rls_enabled,
          force_rls: table.force_rls,
          policy_names: policies.map((p) => redactText(p.name)),
          policy_condition: redactText(
            policies
              .map((p) => {
                const clauses: string[] = [];
                if (e.operation !== 'INSERT')
                  clauses.push(`USING ${p.using ?? 'omitted (no allow expression)'}`);
                if (e.operation === 'INSERT' || e.operation === 'UPDATE')
                  clauses.push(
                    `WITH CHECK ${p.check ?? (p.using ? `${p.using} (USING fallback)` : 'omitted (no allow expression)')}`,
                  );
                return `${p.name}: ${clauses.join('; ')}`;
              })
              .join('\n'),
          ).slice(0, 4000),
          grant_summary: `${e.actor} ${e.operation} privilege: ${table.grants[e.actor][e.operation]}`,
          snapshot_id: snapshot.id,
        },
        context: {
          table_classification: classifyTable(table, expectations),
          signals: table.columns
            .filter((c) => c.owner_fk)
            .map((c) => `${c.name} references auth.users`),
          limitations: ['Local catalogue facts; synthetic verification is separate'],
          redacted_excerpt: null,
        },
        expectation: e,
        ai_analysis: {
          status: 'pending',
          analysis_id: null,
          model: null,
          model_digest: null,
          prompt_version: null,
          output: null,
          reason_code: null,
          created_at: null,
        },
        attack_hypothesis:
          e.source === 'unknown'
            ? null
            : {
                statement: `${e.actor === 'anon' ? 'An anonymous actor' : 'User A'} may ${e.operation.toLowerCase()} ${e.owner_column ? "User B's row" : 'the synthetic target'} under the ${e.source} expectation`,
                actor: e.actor === 'anon' ? 'anon' : 'user_a',
                target: 'user_b',
                operation: e.operation,
                test_id:
                  e.actor === 'anon'
                    ? 'rls.anon_access.v1'
                    : e.owner_column
                      ? test[e.operation]
                      : 'rls.own_row_access.v1',
                evidence_refs: [evidence_id],
                origin: 'deterministic',
              },
        state: e.source === 'unknown' ? 'needs_expectation' : 'suspected',
        suppression: e.intentionally_public
          ? {
              reason: 'intentionally_public',
              rationale: e.rationale,
              actor_id: 'local_operator',
              expectation_revision: e.revision,
              created_at: now,
            }
          : null,
        verification: { status: 'not_requested', latest_run_id: null, evidence: [], stale: false },
        remediation: {
          status: 'none',
          patch_id: null,
          patch_digest: null,
          summary: null,
          approved_by: null,
          approved_at: null,
        },
        retest_result: null,
        timestamps: { created_at: now, updated_at: now, confirmed_at: null, fixed_at: null },
      }),
    );
  }
  return findings;
}
