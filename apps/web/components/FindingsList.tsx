import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ContractMap } from '../../../packages/contracts/src/index';
import { badge } from './state-copy';
import styles from './workbench.module.css';
export default function FindingsList({
  view,
  showSuppressed,
  setShowSuppressed,
  onSelect,
}: {
  view: ContractMap['ProjectView'] | null;
  showSuppressed: boolean;
  setShowSuppressed: Dispatch<SetStateAction<boolean>>;
  onSelect: (id: string) => void;
}) {
  const [category, setCategory] = useState('all');
  const [state, setState] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [source, setSource] = useState('all');
  const visible =
    view?.findings.filter(
      (f) =>
        (showSuppressed || !f.suppression) &&
        (category === 'all' || f.category === category) &&
        (state === 'all' || f.state === state) &&
        (severity === 'all' || f.severity === severity) &&
        (source === 'all' || (f.expectation?.source ?? 'static') === source),
    ) ?? [];
  return (
    <>
      <div className={styles.metrics}>
        <div>
          <small>CONFIRMED RLS FINDINGS · SEE INTENT SOURCE</small>
          <strong>
            {view?.findings.filter(
              (f) =>
                f.state === 'confirmed' && f.category === 'RLS_MISCONFIGURATION' && !f.suppression,
            ).length ?? 0}
          </strong>
        </div>
        <div>
          <small>FIXED FINDINGS · SEE EVIDENCE SCOPE</small>
          <strong>
            {view?.findings.filter((f) => f.state === 'fixed' && !f.suppression).length ?? 0}
          </strong>
        </div>
        <div className={styles.filterBar}>
          <label>
            Category{' '}
            <select
              aria-label="Category filter"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              <option value="RLS_MISCONFIGURATION">RLS configuration</option>
              <option value="CREDENTIAL_EXPOSURE">Credential exposure</option>
            </select>
          </label>
          <label>
            State{' '}
            <select
              aria-label="State filter"
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="all">All states</option>
              {[
                'needs_expectation',
                'suspected',
                'confirmed',
                'not_reproduced',
                'blocked',
                'not_testable',
                'fixed',
                'fix_not_verified',
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity{' '}
            <select
              aria-label="Severity filter"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              <option value="all">All severities</option>
              {['info', 'low', 'medium', 'high', 'critical'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Expectation source{' '}
            <select
              aria-label="Expectation source filter"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All sources</option>
              {['declared', 'inferred', 'unknown', 'static'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <small>INTENTIONALLY PUBLIC / SUPPRESSED</small>
          <strong>{view?.findings.filter((f) => f.suppression).length ?? 0}</strong>
        </div>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Findings</h2>
          <label>
            <input
              type="checkbox"
              checked={showSuppressed}
              onChange={(e) => setShowSuppressed(e.target.checked)}
            />{' '}
            Show suppressed
          </label>
        </div>
        {!view && <p>Import a repository or upload files to begin.</p>}
        {view && view.findings.length > 0 && visible.length === 0 && (
          <p>No findings match these filters.</p>
        )}
        {view && view.findings.length === 0 && (
          <p>No findings detected in the submitted scope. See scan coverage and limitations.</p>
        )}
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Finding</th>
                <th>Category</th>
                <th>State</th>
                <th>Severity</th>
                <th>Intent</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <tr key={f.id}>
                  <td>
                    <button className={styles.findingLink} onClick={() => onSelect(f.id)}>
                      {f.title}
                    </button>
                    <small>
                      {f.location.kind === 'database'
                        ? `${f.location.resource.schema}.${f.location.resource.table} · ${f.location.operation}`
                        : f.location.path}
                    </small>
                  </td>
                  <td>
                    {f.category === 'RLS_MISCONFIGURATION'
                      ? 'RLS configuration'
                      : 'Credential exposure'}
                  </td>
                  <td>
                    <span className={styles.badge}>
                      {f.suppression?.reason === 'intentionally_public'
                        ? 'Intentionally public — declared SELECT access'
                        : badge(f)}
                    </span>
                  </td>
                  <td>{f.severity}</td>
                  <td>{f.expectation?.source ?? 'Static'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
