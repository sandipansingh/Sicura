'use client';
import { useEffect, useRef, useState } from 'react';
import { AppShell, Modal, Button } from './ui';
import {
  validate,
  parseStrictJson,
  type ContractMap,
  type ExpectationEdit,
  type InputRequest,
  type RunResponse,
} from '../../../packages/contracts/src/index';
import styles from './workbench.module.css';
import Results from './Results';
import ProjectPanel from './ProjectPanel';
import FindingsList from './FindingsList';
import FindingStory from './FindingStory';
import ExpectationEditor from './ExpectationEditor';

type View = ContractMap['ProjectView'];
type Tab = 'Project' | 'Findings' | 'Expected Access' | 'Verification Runs';
export default function Workbench() {
  const initialized = useRef(false);
  const previousProject = useRef<string | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [runFilter, setRunFilter] = useState('All');
  const [csrf, setCsrf] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<Tab>('Project');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [edits, setEdits] = useState<ExpectationEdit[]>([]);
  const [files, setFiles] = useState<InputRequest['files']>([]);
  const [manifest, setManifest] = useState<InputRequest['expectations']>(null);
  async function api<K extends keyof ContractMap>(
    path: string,
    name: K,
    method = 'GET',
    body?: unknown,
  ): Promise<ContractMap[K]> {
    const response = await fetch(`/api/${path}`, {
      method,
      headers:
        method === 'GET'
          ? {}
          : {
              'Content-Type': 'application/json',
              'x-csrf-token': csrf,
              'idempotency-key': crypto.randomUUID(),
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = parseStrictJson(await response.text(), 16 * 1024 * 1024);
    if (!response.ok) {
      const failure = validate('ApiError', data);
      throw new Error(`${failure.error.code}: ${failure.error.message}`);
    }
    return validate(name, data);
  }
  async function refresh(id: string) {
    const next = await api(`projects/${id}`, 'ProjectView');
    setView(next);
    return next;
  }
  async function action(fn: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    let stopped = false;
    fetch('/api/session')
      .then((r) => r.text())
      .then((t) => {
        const s = validate('SessionResponse', parseStrictJson(t));
        if (!stopped) setCsrf(s.csrf_token);
      })
      .catch(() => setError('Local API unavailable'));
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!csrf || initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has('demo')) {
      url.searchParams.delete('demo');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    void api('projects', 'ProjectsResponse')
      .then(async (r) => {
        const requested = url.searchParams.get('project');
        const p = requested
          ? r.projects.find((project) => project.id === requested)
          : r.projects.at(-1);
        if (requested && !p) {
          setError('Requested project is unavailable.');
          return;
        }
        if (p) await refresh(p.id);
      })
      .catch(() => setError('Project loading failed'))
      .finally(() => setLoadingProjects(false));
  }, [csrf]);
  useEffect(() => {
    const id = view?.project.id ?? null;
    if (id === previousProject.current) return;
    previousProject.current = id;
    setRun(null);
    setSelected(null);
    setEdits([]);
    const url = new URL('/app', window.location.origin);
    if (id) url.searchParams.set('project', id);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [view?.project.id]);
  useEffect(() => {
    if (!view?.jobs.some((j) => j.status === 'running' || j.status === 'queued')) return;
    const timer = setInterval(() => {
      void refresh(view.project.id).catch(() => setError('Job status unavailable'));
    }, 1000);
    return () => clearInterval(timer);
  }, [view?.project.id, view?.jobs]);
  const busy =
    working ||
    loadingProjects ||
    !csrf ||
    !!view?.jobs.some((j) => j.status === 'running' || j.status === 'queued');
  const finding = view?.findings.find((f) => f.id === selected) ?? null;
  const patch = view?.patches.find((p) => p.id === finding?.remediation.patch_id);
  const active = view?.jobs.find((j) => j.status === 'running' || j.status === 'queued');
  const errors = view?.jobs.filter((j) => j.status === 'failed');
  async function load(input: InputRequest) {
    const p = await api('projects', 'Project', 'POST', { name: 'Local investigation' });
    await api(`projects/${p.id}/inputs`, 'JobEnvelope', 'POST', input);
    await refresh(p.id);
    setTab('Findings');
    setSelected(null);
    setFiles([]);
    setManifest(null);
  }
  async function verify() {
    if (view) {
      await api(`projects/${view.project.id}/verify`, 'JobEnvelope', 'POST', {
        input_revision: view.project.input_revision,
        expectation_revision_ids: view.expectations.map((e) => e.revision_id),
      });
      await refresh(view.project.id);
    }
  }
  async function investigate() {
    if (view && finding) {
      await api(`findings/${finding.id}/investigate`, 'JobEnvelope', 'POST', {
        expected_revision: finding.revision,
      });
      await refresh(view.project.id);
    }
  }
  async function reviewPatch() {
    if (view && finding) {
      await api(`findings/${finding.id}/patches`, 'MigrationPatch', 'POST', {
        analysis_id: finding.ai_analysis.output?.remediation_intent
          ? finding.ai_analysis.analysis_id
          : null,
        intent_index: 0,
        expected_revision: finding.revision,
      });
      await refresh(view.project.id);
    }
  }
  async function apply() {
    if (view && patch) {
      await api(`patches/${patch.id}/approve`, 'JobEnvelope', 'POST', {
        patch_digest: patch.patch_digest,
        baseline_digest: patch.baseline_schema_digest,
        expectation_revision_ids: patch.expectation_revision_ids,
      });
      await refresh(view.project.id);
    }
  }
  async function openRun(id: string) {
    setRun(await api(`runs/${id}`, 'RunResponse'));
  }
  const expectationEdits = () =>
    view?.expectations.map(
      ({
        resource,
        actor,
        operation,
        expected,
        owner_column,
        team_binding,
        intentionally_public,
        rationale,
      }) => ({
        resource,
        actor,
        operation,
        expected,
        owner_column,
        team_binding,
        intentionally_public,
        rationale,
      }),
    ) ?? [];
  async function saveEdits() {
    if (view) {
      const next = await api(`projects/${view.project.id}/expectations`, 'ProjectView', 'PUT', {
        expected_revision: view.project.expectation_set_revision,
        changes: edits,
      });
      setView(next);
      setEdits([]);
    }
  }
  return (
    <AppShell
      currentTab={tab}
      projectName={view?.project.name}
      inputRevision={view?.project.input_revision}
      activeJob={active}
      onTabChange={(t) => {
        setTab(t);
        setSelected(null);
        if (t === 'Expected Access') setEdits(expectationEdits());
      }}
      onCancelJob={() =>
        void action(async () => {
          if (active && view) {
            await api(`jobs/${active.id}/cancel`, 'JobEnvelope', 'POST', {});
            await refresh(view.project.id);
          }
        })
      }
    >
      <div className={styles.shell}>
        <div className={styles.content}>
          <div className={styles.heading}>
            <div>
              <h1>{finding ? 'Finding investigation' : tab}</h1>
            </div>
            {view && (
              <button disabled={busy || !view.snapshot} onClick={() => setShowVerify(true)}>
                Run local verification
              </button>
            )}
          </div>
          {view && !view.snapshot && tab !== 'Project' && (
            <p className={styles.notice}>
              Replica verification unavailable:{' '}
              {view.sql_analysis?.replay_reason ??
                view.imports?.at(-1)?.rls.reason_code ??
                'SCHEMA_MISSING'}
              . Review SQL diagnostics in Project. Static analysis is not an access observation.
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {tab !== 'Project' && view?.imports?.at(-1) && (
            <p className={styles.notice}>
              Credential coverage: {view.imports.at(-1)!.files_analyzed} files. RLS coverage:{' '}
              {view.imports.at(-1)!.rls.status.replaceAll('_', ' ')}. Review repository coverage in
              Project.
            </p>
          )}
          {errors?.map((j) => (
            <p className={styles.error} key={j.id}>
              Job {j.id}: {j.error_code}. No access conclusion from this job.
            </p>
          ))}
          {loadingProjects && <p role="status">Loading local projects…</p>}
          {tab === 'Project' && !loadingProjects && (
            <ProjectPanel
              onFinding={(id) => {
                setTab('Findings');
                setSelected(id);
              }}
              busy={busy}
              api={api}
              load={load}
              action={action}
              view={view}
              setView={setView}
              setSelected={setSelected}
              files={files}
              setFiles={setFiles}
              manifest={manifest}
              setManifest={setManifest}
            />
          )}
          {tab === 'Findings' && !finding && (
            <FindingsList
              view={view}
              showSuppressed={showSuppressed}
              setShowSuppressed={setShowSuppressed}
              onSelect={setSelected}
            />
          )}
          {finding && (
            <FindingStory
              finding={finding}
              patch={patch}
              busy={busy}
              onBack={() => setSelected(null)}
              onEdit={() => {
                setTab('Expected Access');
                setSelected(null);
                setEdits(expectationEdits());
              }}
              onProposal={() => {
                const proposed = finding.ai_analysis.output?.proposed_expectation;
                const current = finding.expectation;
                if (!proposed || !current) return;
                setTab('Expected Access');
                setSelected(null);
                setEdits(
                  expectationEdits().map((e) =>
                    e.resource.schema === current.resource.schema &&
                    e.resource.table === current.resource.table &&
                    e.actor === proposed.actor &&
                    e.operation === current.operation
                      ? {
                          ...e,
                          expected: proposed.expected,
                          owner_column: proposed.owner_column,
                          intentionally_public: false,
                          rationale: proposed.rationale,
                        }
                      : e,
                  ),
                );
              }}
              onInvestigate={() => action(investigate)}
              onReview={() => action(reviewPatch)}
              onApply={() => action(apply)}
              onInspectRetest={() =>
                action(async () => {
                  await openRun(finding.retest_result!.run_id);
                  setTab('Verification Runs');
                  setSelected(null);
                })
              }
            />
          )}
          {tab === 'Expected Access' && (
            <ExpectationEditor
              edits={edits}
              setEdits={setEdits}
              expectations={view?.expectations ?? []}
              busy={busy}
              onSave={() => action(saveEdits)}
            />
          )}
          {tab === 'Verification Runs' && (
            <section className={styles.evidencePanel}>
              <h2>Immutable verification runs</h2>
              <p>
                Local replica • Synthetic data. Errors are inconclusive. Executed includes errored
                probes; not-testable overlaps skipped/errored counts.
              </p>
              {view?.runs.map((r) => (
                <button
                  className={styles.runButton}
                  key={r.id}
                  onClick={() => void action(async () => openRun(r.id))}
                >
                  {r.kind} · {r.status} · {r.coverage.executed}/{r.coverage.planned} executed
                </button>
              ))}
              {run && (
                <>
                  <h3>
                    {run.run.kind} · {run.run.id}
                    {(run.run.input_revision !== view?.project.input_revision ||
                      run.run.expectation_revision_ids.some(
                        (id) => !view?.expectations.some((e) => e.revision_id === id),
                      )) &&
                      ' · Historical — expectation/schema has changed'}
                  </h3>
                  <p>
                    {run.run.coverage.planned} planned · {run.run.coverage.executed} executed ·{' '}
                    {run.run.coverage.skipped} skipped · {run.run.coverage.errored} errors ·{' '}
                    {run.run.coverage.not_testable} not testable
                  </p>
                  <p>{run.run.fidelity_gaps.join('; ')}</p>
                  <label>
                    Result view{' '}
                    <select
                      aria-label="Result view"
                      value={runFilter}
                      onChange={(event) => setRunFilter(event.target.value)}
                    >
                      {['All', 'Executed', 'Skipped', 'Inconclusive'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <Results
                    results={run.results.filter(
                      (result) =>
                        runFilter === 'All' ||
                        (runFilter === 'Skipped'
                          ? result.observed === 'not_run'
                          : runFilter === 'Inconclusive'
                            ? result.outcome === 'inconclusive'
                            : result.observed !== 'not_run'),
                    )}
                  />
                </>
              )}
            </section>
          )}
        </div>
      </div>
      <Modal
        open={showVerify}
        onClose={() => setShowVerify(false)}
        title="Run local verification"
        subtitle="Local replica • Synthetic data"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowVerify(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !view?.snapshot}
              onClick={() => {
                setShowVerify(false);
                void action(verify);
              }}
            >
              Run local verification
            </Button>
          </>
        }
      >
        <p>
          Input revision {view?.project.input_revision}. {view?.snapshot?.tables.length ?? 0}{' '}
          tables.
        </p>
        <p>
          {view?.expectations.filter((e) => e.source === 'declared').length ?? 0} declared ·{' '}
          {view?.expectations.filter((e) => e.source === 'inferred').length ?? 0} inferred ·{' '}
          {view?.expectations.filter((e) => e.source === 'unknown').length ?? 0} unknown
          expectations.
        </p>
        <p>
          Every eligible registry scenario runs with synthetic low-privilege identities. Unknown
          intent skips its dependent probes. Errors remain inconclusive; no production connection is
          used.
        </p>
      </Modal>
    </AppShell>
  );
}
