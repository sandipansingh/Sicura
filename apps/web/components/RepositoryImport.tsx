'use client';
import { useState } from 'react';
import type { ContractMap, ImportReport } from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';

type Api = <K extends keyof ContractMap>(
  path: string,
  name: K,
  method?: string,
  body?: unknown,
) => Promise<ContractMap[K]>;
export default function RepositoryImport({
  hideForm = false,
  busy,
  reports,
  api,
  action,
  onProject,
}: {
  hideForm?: boolean;
  busy: boolean;
  reports: ImportReport[];
  api: Api;
  action: (fn: () => Promise<void>) => Promise<void>;
  onProject: (id: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [root, setRoot] = useState('');
  const [order, setOrder] = useState('');
  const report = reports.at(-1);
  return (
    <section className={styles.panel}>
      {!hideForm && (
        <>
          <h2>Import project</h2>
          <p>
            Read one pinned commit. Discover source and migrations without running the project.
            Private access uses your existing GitHub CLI login.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const result = await api('imports', 'ImportStatus', 'POST', {
                  source: { kind: 'github', url: url.trim(), ref: null },
                  selection: null,
                  retry_of: null,
                });
                setUrl('');
                setRoot('');
                setOrder('');
                await onProject(result.job.project_id);
              });
            }}
          >
            <label>
              GitHub repository URL{' '}
              <input
                aria-label="GitHub repository URL"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                required
                disabled={busy}
              />
            </label>{' '}
            <button type="submit" disabled={busy || !url.trim()}>
              Import project
            </button>
          </form>
        </>
      )}
      {report && (
        <div aria-live="polite">
          <h3>Repository coverage</h3>
          <p>
            {report.provenance.label} · {report.status}
            {report.provenance.commit && (
              <>
                {' '}
                · Commit <code>{report.provenance.commit}</code>
              </>
            )}
          </p>
          <p>
            Credential coverage: {report.files_analyzed} UTF-8 files · {report.bytes_analyzed} bytes
            · {report.credential_findings} static findings. Credential validity is untested.
          </p>
          <p>
            RLS verification coverage:{' '}
            {report.rls.status === 'ready'
              ? 'Supported SQL admitted. Review access expectations, then run local verification.'
              : report.rls.status.replaceAll('_', ' ')}
            {report.rls.reason_code && ` · ${report.rls.reason_code}`}.{' '}
            {report.rls.status !== 'ready' && 'No passing-test claim.'}
          </p>
          {report.sql_order.length > 0 && (
            <details>
              <summary>Selected SQL migration order</summary>
              <ol>
                {report.sql_order.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </details>
          )}
          {report.orm_metadata.length > 0 && (
            <p>
              ORM metadata: {report.orm_metadata.join(', ')}. RLS verification requires supported
              SQL.
            </p>
          )}
          <details>
            <summary>{report.exclusions.length} exclusions and coverage gaps</summary>
            <ul>
              {report.exclusions.map((item, i) => (
                <li key={i}>
                  {item.path} · {item.reason}
                  {item.bytes !== null && ` · ${item.bytes} bytes`}
                </li>
              ))}
            </ul>
          </details>
          {report.rls.status === 'choice_required' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  const result = await api(
                    `imports/${report.job_id}/choose`,
                    'ImportStatus',
                    'POST',
                    {
                      root,
                      sql_order: order
                        .split('\n')
                        .map((p) => p.trim())
                        .filter(Boolean),
                    },
                  );
                  await onProject(result.job.project_id);
                });
              }}
            >
              <label>
                SQL root{' '}
                <select
                  aria-label="SQL root"
                  value={root}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setRoot(event.target.value);
                    setOrder(
                      report.roots.find((r) => r.path === event.target.value)?.files.join('\n') ??
                        '',
                    );
                  }}
                >
                  <option value="">Choose a migration root</option>
                  {report.roots.map((r) => (
                    <option key={r.path} value={r.path}>
                      {r.path}
                      {!r.complete && ' (coverage gap)'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Migration order (one path per line){' '}
                <textarea
                  aria-label="Migration order"
                  value={order}
                  onChange={(event) => setOrder(event.target.value)}
                  rows={6}
                  disabled={busy}
                />
              </label>
              <button disabled={busy || !root}>Save SQL choice and retry import</button>
            </form>
          )}
          {['failed', 'interrupted'].includes(report.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api(
                    `imports/${report.job_id}/retry`,
                    'ImportStatus',
                    'POST',
                    {},
                  );
                  await onProject(result.job.project_id);
                })
              }
            >
              Retry interrupted or failed import
            </button>
          )}
        </div>
      )}
    </section>
  );
}
