import { validate, type Finding } from '../../../contracts/src/index';
import { newId } from '../hash';
import { redactText, scanCredentials } from './redact';

export function credentialFindings(
  path: string,
  text: string,
  project_id: string,
  input_revision: number,
  privateContext?: { key: Buffer; capture: (id: string, fingerprint: string) => void },
): Finding[] {
  return scanCredentials(path, text, privateContext?.key).map(
    ({ evidence, line, confirmed, fingerprint }) => {
      const now = new Date().toISOString();
      const suppressed = ['placeholder', 'public_identifier'].includes(evidence.classification);
      const finding = validate('Finding', {
        schema_version: '1.0',
        id: newId('finding'),
        project_id,
        revision: 1,
        input_revision,
        category: 'CREDENTIAL_EXPOSURE',
        title: confirmed
          ? 'Credential-like literal exposed in submitted artifacts'
          : 'Credential-shaped value requires contextual review',
        severity: suppressed
          ? 'info'
          : evidence.credential_type === 'privileged_backend_credential' &&
              evidence.exposure === 'frontend'
            ? 'critical'
            : confirmed
              ? 'high'
              : 'low',
        severity_basis: 'Static artifact exposure; credential validity was not tested',
        confidence: {
          level: confirmed ? 'medium' : 'low',
          basis: 'Bounded deterministic literal and context analysis',
        },
        source: { kind: 'source_scan', analyzer_version: '1.0.0', rule_ids: evidence.rule_ids },
        location: { kind: 'file', path: redactText(path), line_start: line, line_end: line },
        evidence,
        context: {
          table_classification: null,
          signals: [`Submitted ${evidence.exposure} artifact`],
          limitations: [
            'Static exposure only; validity, rotation and previously published artifacts were not tested',
          ],
          redacted_excerpt: null,
        },
        expectation: null,
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
            'Someone obtaining a valid credential from a submitted artifact could attempt privileged access; credential use is untested',
          actor: null,
          target: null,
          operation: null,
          test_id: null,
          evidence_refs: [evidence.id],
          origin: 'deterministic',
        },
        state: confirmed ? 'confirmed' : 'suspected',
        suppression: suppressed
          ? {
              reason: evidence.classification === 'placeholder' ? 'placeholder' : 'accepted_risk',
              rationale: 'Deterministic placeholder or public identifier classification',
              actor_id: 'local_operator',
              expectation_revision: null,
              created_at: now,
            }
          : null,
        verification: { status: 'not_applicable', latest_run_id: null, evidence: [], stale: false },
        remediation: {
          status: 'proposed',
          patch_id: null,
          patch_digest: null,
          summary: 'Remove literals, use server-side configuration and review issuer rotation',
          approved_by: null,
          approved_at: null,
        },
        retest_result: null,
        timestamps: {
          created_at: now,
          updated_at: now,
          confirmed_at: confirmed ? now : null,
          fixed_at: null,
        },
      });
      if (fingerprint) privateContext?.capture(finding.id, fingerprint);
      return finding;
    },
  );
}
