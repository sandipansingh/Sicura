import type { Finding, MigrationPatch } from '../../../packages/contracts/src/index';
import Results from './Results';
import { badge } from './state-copy';
import styles from './workbench.module.css';
type Props = {
  finding: Finding;
  patch: MigrationPatch | undefined;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onProposal: () => void;
  onInvestigate: () => Promise<void>;
  onReview: () => Promise<void>;
  onApply: () => Promise<void>;
  onInspectRetest: () => Promise<void>;
};
export default function FindingStory({
  finding,
  patch,
  busy,
  onBack,
  onEdit,
  onProposal,
  onInvestigate,
  onReview,
  onApply,
  onInspectRetest,
}: Props) {
  const expectation = finding.expectation;
  return (
    <>
      <button className={styles.back} onClick={onBack}>
        ← All findings
      </button>
      <div className={styles.storyHeader}>
        <span className={styles.badge}>{badge(finding)}</span>
        <span className={styles.badge}>
          {finding.expectation?.source ?? 'Static exposure'} intent
        </span>
        <span className={styles.badge}>
          {finding.category === 'CREDENTIAL_EXPOSURE'
            ? 'Submitted artifact • Static analysis'
            : 'Local replica • Synthetic data'}
        </span>
        <h2>{finding.title}</h2>
        <p>
          {finding.severity.toUpperCase()} · {finding.category} · Revision {finding.revision}
        </p>
      </div>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>01 / FINDING AND STATIC EVIDENCE</p>
        <h2>
          {finding.evidence.kind === 'credential'
            ? 'Static exposure evidence — validity not tested'
            : 'Static Evidence'}
        </h2>
        <p>{finding.source.rule_ids.join(' · ')}</p>
        {finding.evidence.kind !== 'credential' ? (
          <>
            <pre>{finding.evidence.policy_condition}</pre>
            <p>{finding.evidence.grant_summary}</p>
          </>
        ) : (
          <pre>{finding.evidence.redacted_snippet}</pre>
        )}
        <h3>Why It Matters</h3>
        <p>{finding.severity_basis}</p>
        {finding.context.limitations.map((l) => (
          <p key={l} className={styles.subtle}>
            {l}
          </p>
        ))}
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>02 / EXPECTATION</p>
        <h2>Expected Access Model</h2>
        {expectation ? (
          <>
            <div className={styles.expectation}>
              <strong>{expectation.expected.replaceAll('_', ' ')}</strong>
              <span>
                {expectation.actor} · {expectation.operation} · {expectation.source} · r
                {expectation.revision}
              </span>
            </div>
            <p>{expectation.rationale}</p>
            <p>
              Owner binding: <code>{expectation.owner_column ?? 'None'}</code>
            </p>
            {expectation.source === 'unknown' && (
              <p>We need your intended access rule before testing this operation.</p>
            )}
            <button disabled={busy} onClick={onEdit}>
              Edit or confirm expectation
            </button>
          </>
        ) : (
          <p>Not applicable — contextual static analysis.</p>
        )}
      </section>
      <section className={styles.aiPanel}>
        <p className={styles.eyebrow}>03 / AI INVESTIGATION</p>
        <h2>AI Analysis — advisory</h2>
        {finding.ai_analysis.status === 'available' ? (
          <>
            <p className={styles.subtle}>
              {finding.ai_analysis.model} · prompt {finding.ai_analysis.prompt_version} ·{' '}
              {finding.ai_analysis.created_at}
            </p>
            <details>
              <summary>Model digest</summary>
              <code>{finding.ai_analysis.model_digest}</code>
            </details>
            <p>{finding.ai_analysis.output!.explanation}</p>
            <p>{finding.ai_analysis.output!.context_interpretation}</p>
            <p>{finding.ai_analysis.output!.impact}</p>
            <p>
              Advisory {finding.ai_analysis.output!.confidence.level} confidence:{' '}
              {finding.ai_analysis.output!.confidence.basis}
            </p>
            {finding.ai_analysis.output!.uncertainties.map((u) => (
              <p key={u} className={styles.subtle}>
                {u}
              </p>
            ))}
            {finding.ai_analysis.output!.proposed_expectation && (
              <div>
                <p>
                  Inactive proposal: {finding.ai_analysis.output!.proposed_expectation.expected}.
                  Open the expectation editor and Save to declare intent.
                </p>
                <button disabled={busy} onClick={onProposal}>
                  Review inactive expectation proposal
                </button>
              </div>
            )}
          </>
        ) : (
          <p>
            {finding.ai_analysis.status === 'pending'
              ? 'No AI analysis requested yet.'
              : 'AI analysis unavailable. Gemma analysis is unavailable. Deterministic evidence remains available.'}
          </p>
        )}
        <button disabled={busy} onClick={() => void onInvestigate()}>
          Investigate with Gemma
        </button>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>04 / ATTACK HYPOTHESIS</p>
        <h2>A falsifiable scenario</h2>
        <p>
          {finding.ai_analysis.output?.attack_hypothesis.statement ??
            finding.attack_hypothesis?.statement ??
            'Establish an access expectation before scheduling a probe.'}
        </p>
        <code>
          {finding.ai_analysis.output?.recommended_test_id ??
            finding.attack_hypothesis?.test_id ??
            'Static only'}
        </code>
        <p className={styles.subtle}>
          AI suggestion is priority only. The application runs every eligible registry scenario.
        </p>
      </section>
      <section className={styles.evidencePanel}>
        <p className={styles.eyebrow}>05 / VERIFICATION — EXPECTED VS OBSERVED</p>
        <h2>
          {finding.category === 'CREDENTIAL_EXPOSURE'
            ? 'Static exposure evidence; no credential use attempted'
            : 'Verified Evidence — local replica'}
        </h2>
        {finding.verification.evidence.length ? (
          <>
            <p>
              Run <code>{finding.verification.latest_run_id}</code> ·{' '}
              {finding.verification.stale
                ? 'Historical — intent changed'
                : 'Latest baseline observation of submitted SQL — replica-only patches do not change these inputs'}
            </p>
            <Results results={finding.verification.evidence} />
          </>
        ) : (
          <p>
            {finding.category === 'CREDENTIAL_EXPOSURE'
              ? 'Validity was not tested.'
              : 'No verification result yet.'}
          </p>
        )}
      </section>
      {finding.category === 'RLS_MISCONFIGURATION' && (
        <section className={styles.panel}>
          <p className={styles.eyebrow}>06 / REMEDIATION</p>
          <h2>Review a replica migration</h2>
          {patch ? (
            <>
              <p>
                {patch.rationale} ·{' '}
                {patch.origin === 'gemma_intent'
                  ? 'Gemma suggestion, application-rendered patch'
                  : 'Deterministic template'}
              </p>
              <pre>{patch.migration_sql}</pre>
              <details>
                <summary>Approval bindings and regression scope</summary>
                <p>
                  Patch: <code>{patch.patch_digest}</code>
                </p>
                <p>
                  Baseline: <code>{patch.baseline_schema_digest}</code>
                </p>
                <p>Expectations: {patch.expectation_revision_ids.join(', ')}</p>
                <p>
                  Identical original matrix, reciprocal attacks, own-row operations and previously
                  allowed access.
                </p>
              </details>
              <p>
                Apply this reviewed migration to a disposable local replica, then rerun the recorded
                scenarios and regressions.
              </p>
              <button disabled={busy || patch.status !== 'proposed'} onClick={() => void onApply()}>
                Approve and apply to replica
              </button>
            </>
          ) : (
            <>
              <p>
                Application code renders a typed owner-SELECT intent. A current confirmed baseline
                is required.
              </p>
              <button
                disabled={
                  busy ||
                  finding.state !== 'confirmed' ||
                  finding.expectation?.operation !== 'SELECT'
                }
                onClick={() => void onReview()}
              >
                Review suggested patch
              </button>
            </>
          )}
        </section>
      )}
      <section className={styles.evidencePanel}>
        <p className={styles.eyebrow}>07 / RETEST</p>
        <h2>{finding.state === 'fixed' ? badge(finding) : 'Retest comparison'}</h2>
        {finding.retest_result ? (
          <>
            <p>
              {finding.retest_result.kind === 'credential_rescan'
                ? finding.retest_result.scope
                : finding.retest_result.status !== 'passed'
                  ? 'Fix not verified — failed or incomplete retest.'
                  : finding.expectation?.source === 'inferred'
                    ? 'Fix verified against the inferred owner-only expectation in the replica.'
                    : 'Fix verified for the tested replica scenarios; own-row access still passes.'}
            </p>
            <p>
              Identical scenarios: {finding.retest_result.identical_scenarios ? 'pass' : 'fail'} ·
              Regressions: {finding.retest_result.regressions_passed ? 'pass' : 'fail'}
            </p>
            {finding.retest_result.kind === 'rls' && (
              <button onClick={() => void onInspectRetest()}>Inspect immutable retest run</button>
            )}
          </>
        ) : (
          <p>
            {finding.category === 'CREDENTIAL_EXPOSURE'
              ? 'Removal, issuer rotation and previously published artifacts remain unverified.'
              : 'No passing retest applies to this current baseline.'}
          </p>
        )}
        {patch?.approval && patch.status !== 'superseded' && (
          <a
            className={styles.download}
            href={`/api/findings/${finding.id}/export?format=sql`}
            download
          >
            Export migration file
          </a>
        )}
        <a className={styles.download} href={`/api/findings/${finding.id}/export`} download>
          Export redacted report
        </a>
        <a
          className={styles.download}
          href={`/api/findings/${finding.id}/export?format=md`}
          download
        >
          Export readable report
        </a>
      </section>
    </>
  );
}
