import {
  validate,
  type SQLAnalysis,
  type Finding,
  type Expectation,
  type ExpectationEdit,
} from '../../../contracts/src/index';
import { resolveExpectations } from '../expectations/resolve';
import { newId } from '../hash';
import { redactValue } from '../secrets/sink';

/** Shape adapter used only to validate intended access. Never persisted as a catalogue snapshot. */
export function staticExpectations(
  a: SQLAnalysis,
  edits: ExpectationEdit[],
  prior: Expectation[],
  project: string,
  refresh = false,
): Expectation[] {
  return resolveExpectations(
    {
      id: a.id,
      digest: 'unobserved',
      postgres_version: 'unobserved',
      tables: a.tables.map((t) => ({
        schema: t.schema,
        name: t.name,
        owner: 'unobserved',
        rls_enabled: false,
        force_rls: false,
        primary_key: [],
        constraints: [],
        policies: [],
        columns: t.columns.map((c) => ({
          ...c,
          not_null: false,
          identity: '',
          generated: '',
          default_expression: null,
        })),
        grants: {
          authenticated: { SELECT: false, INSERT: false, UPDATE: false, DELETE: false },
          anon: { SELECT: false, INSERT: false, UPDATE: false, DELETE: false },
        },
      })),
    },
    edits,
    prior,
    'user',
    project,
    refresh,
  );
}
export function staticFindings(
  a: SQLAnalysis,
  expectations: Expectation[],
  project: string,
): Finding[] {
  return expectations.map((e) => {
    const t = a.tables.find((t) => t.schema === e.resource.schema && t.name === e.resource.table)!;
    const policies = a.policies.filter(
      (p) =>
        p.schema === t.schema &&
        p.table === t.name &&
        (p.operation === e.operation || p.operation === 'ALL') &&
        (p.roles.includes(e.actor) || p.roles.includes('public')),
    );
    const broad = policies.some(
      (p) => p.permissive && (e.operation === 'INSERT' ? p.broad_check : p.broad_using) === true,
    );
    const now = new Date().toISOString(),
      evidence_id = newId('evidence');
    const grants = a.grants.filter(
      (g) =>
        g.schema === t.schema &&
        g.table === t.name &&
        g.operation === e.operation &&
        (g.role === e.actor || g.role === 'public'),
    );
    return validate(
      'Finding',
      redactValue({
        schema_version: '1.0',
        id: newId('finding'),
        project_id: project,
        revision: 1,
        input_revision: a.input_revision,
        category: 'RLS_MISCONFIGURATION',
        title: `${broad ? 'Potentially over-broad' : 'Declared'} ${e.operation} policy on ${t.name} — static SQL`,
        severity: e.intentionally_public ? 'info' : 'medium',
        severity_basis:
          'Submitted SQL declarations only; effective access and deployed behavior have not been observed',
        confidence: {
          level: 'low',
          basis: 'Parsed declarations; unsupported migration semantics may change effective access',
        },
        source: { kind: 'sql_ast', analyzer_version: '1.0.0', rule_ids: broad ? ['RLS-002'] : [] },
        location: {
          kind: 'database',
          resource: e.resource,
          policy_names: policies.map((p) => p.name),
          operation: e.operation,
        },
        evidence: {
          kind: 'rls_static',
          id: evidence_id,
          rule_ids: broad ? ['RLS-002'] : [],
          operation: e.operation,
          role: e.actor,
          rls_enabled: t.rls_enabled,
          force_rls: null,
          policy_names: policies.map((p) => p.name),
          snapshot_id: a.id,
          policy_condition: policies
            .map(
              (p) =>
                `${p.name}: declared ${p.permissive ? 'permissive' : 'restrictive'} ${p.operation}; USING constant ${p.broad_using === null ? 'unresolved' : p.broad_using}; CHECK constant ${p.broad_check === null ? 'unresolved' : p.broad_check}; helpers ${p.helpers.join(', ') || 'none'}`,
            )
            .join('\n')
            .slice(0, 4000),
          grant_summary: `Declared ${e.actor} ${e.operation} grants: ${grants.length ? grants.map((g) => `${g.role} ${g.granted ? 'grant' : 'revoke'}`).join(', ') : 'unknown'}; effective privileges unobserved`,
        },
        context: {
          table_classification: null,
          signals: ['AST-derived SQL declarations'],
          limitations: [
            'Static SQL analysis; no database access observation',
            a.replay_ready
              ? 'Replica catalogue unavailable; declarations remain unobserved'
              : 'Unsupported statements prevent complete replica replay',
            ...(!a.complete ? ['Final schema and permission state is uncertain'] : []),
          ],
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
        attack_hypothesis: {
          statement:
            'Review the declared policy against intended access; effective access remains untested',
          actor: null,
          target: null,
          operation: e.operation,
          test_id: null,
          evidence_refs: [evidence_id],
          origin: 'deterministic',
        },
        state: e.source === 'unknown' ? 'needs_expectation' : 'not_testable',
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
          summary:
            'Review migration dependencies. No executable repair is available without verified baseline evidence.',
          approved_by: null,
          approved_at: null,
        },
        retest_result: null,
        timestamps: { created_at: now, updated_at: now, confirmed_at: null, fixed_at: null },
      }),
    );
  });
}
