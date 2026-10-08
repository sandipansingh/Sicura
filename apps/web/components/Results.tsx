import type { TestResult } from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';
export default function Results({ results }: { results: TestResult[] }) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>Scenario / actor → target</th>
            <th>Operation</th>
            <th>Expected</th>
            <th>Observed</th>
            <th>Control / mechanism</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.test_id}</code>
                <small>
                  {r.actor} → {r.target ?? '—'}
                </small>
              </td>
              <td>{r.operation}</td>
              <td>{r.expected?.toUpperCase() ?? 'Unknown'}</td>
              <td
                className={
                  r.outcome === 'inconclusive'
                    ? styles.inconclusive
                    : r.outcome === 'mismatch'
                      ? styles.mismatch
                      : styles.match
                }
              >
                {r.outcome === 'inconclusive' ? 'INCONCLUSIVE' : r.observed.toUpperCase()}
                <small>{r.reason_code ?? `${r.row_count ?? 0} synthetic rows`}</small>
              </td>
              <td>
                {r.denial_mechanism ?? '—'}
                <small>
                  {r.role_assertion_passed ? 'Role checked' : 'No probe'} ·{' '}
                  {r.control_result_ids.length} controls
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
