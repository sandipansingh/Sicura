import type { ContractMap } from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';

type Props = {
  view: ContractMap['ProjectView'];
  busy: boolean;
  onInvestigate: () => void;
  onFinding: (id: string) => void;
  onRescan: () => void;
};
export default function ProjectAnalysis({ view, busy, onInvestigate, onFinding, onRescan }: Props) {
  const a = view.sql_analysis,
    summary = view.summary;
  const historical =
    summary &&
    (summary.input_revision !== view.project.input_revision ||
      summary.expectation_set_revision !== view.project.expectation_set_revision);
  const active = view.findings.filter((f) => !f.suppression && f.state !== 'fixed'),
    uncertain = active.filter(
      (f) => f.evidence.kind === 'credential' && f.evidence.classification === 'uncertain',
    );
  return (
    <>
      <section className={styles.panel}>
        <h2>Project overview</h2>
        {(view.imports?.length ?? 0) > 0 && (
          <p>
            Source files and migrations were collected automatically. Save changes in your project,
            then use Rescan repository to refresh this analysis.
          </p>
        )}
        <p>
          {active.length} active findings · {uncertain.length} credential values need contextual
          review · {view.findings.filter((f) => f.suppression).length} suppressed
        </p>
        {active.some((f) => f.source.kind === 'sql_ast') && (
          <p>
            Includes {active.filter((f) => f.source.kind === 'sql_ast').length} static access review
            entries. These are not verified vulnerability counts.
          </p>
        )}
        <p>
          {a
            ? `${a.tables.length} table declarations · ${a.policies.length} policy declarations · ${a.statements} SQL statements inspected`
            : 'Static SQL inventory has not been generated for this saved project.'}
        </p>
        {a && (
          <p>
            {a.complete
              ? 'SQL declarations modeled'
              : 'SQL declarations partially modeled; final permissions uncertain'}
            .{' '}
            {view.snapshot
              ? 'Replica catalogue available; review intended access before verification.'
              : 'Replica verification unavailable for this input. Static findings remain available.'}
          </p>
        )}
        {(view.imports?.length ?? 0) > 0 && (
          <button disabled={busy} onClick={onRescan}>
            Rescan repository
          </button>
        )}
        {a && a.diagnostics.length > 0 && (
          <>
            <h3>What prevents replica verification</h3>
            <ul>
              {a.diagnostics.slice(0, 5).map((d, i) => (
                <li key={i}>
                  <code>
                    {d.path}:{d.line}
                  </code>{' '}
                  · {d.code} · {d.message}
                </li>
              ))}
            </ul>
            <details>
              <summary>All {a.diagnostics.length} SQL diagnostics</summary>
              <ul>
                {a.diagnostics.map((d, i) => (
                  <li key={i}>
                    {d.path}:{d.line} · statement {d.statement} · {d.code} · {d.construct}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
      <section className={styles.aiPanel} aria-live="polite">
        <h2>Gemma Analysis — advisory</h2>
        {summary && (
          <p>
            {summary.model} · {summary.status} · {summary.created_at} ·{' '}
            {(summary.duration_ms / 1000).toFixed(1)}s{' '}
            {historical && '· Historical — inputs or intended access changed'}
          </p>
        )}
        {summary?.status === 'available' && summary.output ? (
          <>
            <p>{summary.output.summary}</p>
            <ul>
              {summary.output.priorities.map((p) => (
                <li key={p.finding_id}>
                  <button
                    onClick={() => onFinding(p.finding_id)}
                    disabled={!view.findings.some((f) => f.id === p.finding_id)}
                  >
                    {view.findings.find((f) => f.id === p.finding_id)?.title ??
                      'Historical finding'}
                  </button>
                  <p>{p.explanation}</p>
                </li>
              ))}
            </ul>
            <h3>Next steps</h3>
            <ul>
              {summary.output.next_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h3>Limitations</h3>
            <ul>
              {summary.output.limitations.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            {summary?.status === 'pending'
              ? 'Gemma summary is queued or running. Deterministic scan results are available in Findings.'
              : summary?.status === 'unavailable'
                ? `Gemma analysis is unavailable (${summary.reason_code}). Deterministic evidence remains available.`
                : 'Generate an advisory explanation of findings, SQL blockers and next steps.'}
          </p>
        )}
        <button disabled={busy} onClick={onInvestigate}>
          {summary ? 'Retry Gemma summary' : 'Analyze project with Gemma'}
        </button>
        <p>
          AI explanations are advisory. Recorded replica observations determine verification
          results.
        </p>
      </section>
    </>
  );
}
