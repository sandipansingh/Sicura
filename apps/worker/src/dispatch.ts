import { repositoryScopeComplete } from '../../../packages/core/src/repository/rescan';
import { Store } from '../../../packages/store/src/index';
import {
  validate,
  type Finding,
  type Job,
  type JobPayload,
} from '../../../packages/contracts/src/index';
import { transitionFinding } from '../../../packages/contracts/src/lifecycle';
import { withReplica } from '../../../packages/core/src/replica/manager';
import { introspect } from '../../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../../packages/core/src/rls/analyze';
import { runMatrix } from '../../../packages/core/src/verification/run';
import { retestPatch } from '../../../packages/core/src/remediation/retest';
import { staticExpectations, staticFindings } from '../../../packages/core/src/rls/static-findings';
import { summarizeProject } from '../../../packages/core/src/ai/project-summary';
import { enqueueAutomaticAnalysis } from '../../../packages/store/src/project-analysis';
import { investigate } from '../../../packages/core/src/ai/ollama';
import { AppError, errorCode, logEvent } from '../../../packages/core/src/errors';
import { compareStaticRescan } from '../../../packages/core/src/secrets/rescan';
import { importRepository } from '../../../packages/core/src/repository/import';
import { saveImportReport } from '../../../packages/store/src/imports';
import { inputSchemaDigest, readReplay } from '../../../packages/core/src/repository/replay';

function save(store: Store, f: Finding): void {
  store.put('Finding', f.id, f.project_id, f, f.revision);
}
function persistStaticReview(
  store: Store,
  p: import('../../../packages/contracts/src/index').Project,
  inputs: import('../../../packages/contracts/src/index').AdmittedInputs,
  refresh: boolean,
): void {
  if (!inputs.sql_analysis?.tables.length) return;
  const expectations = staticExpectations(
    inputs.sql_analysis,
    inputs.expectation_edits,
    refresh ? store.list('Expectation', p.id) : [],
    p.id,
    refresh,
  );
  const findings = staticFindings(inputs.sql_analysis, expectations, p.id);
  if (findings.length + inputs.credential_findings.length > 500)
    throw new AppError('IMPORT_FINDING_LIMIT');
  store.transaction(() => {
    expectations.forEach((e) => store.put('Expectation', e.id, p.id, e, e.revision));
    findings.forEach((f) => save(store, f));
    store.saveProject({ ...p, expectation_set_revision: p.expectation_set_revision + 1 });
  });
}
export async function dispatch(store: Store, job: Job, payload: JobPayload): Promise<void> {
  let p = store.get('Project', job.project_id);
  if (
    p.input_revision !== job.input_revision ||
    p.expectation_set_revision !== payload.expectation_set_revision
  )
    throw new AppError('STALE_REVISION', 409);
  let inputs = store.inputs(p.id);
  const cancelled = () => {
    const current = store.job(job.id);
    if (current.status === 'cancelled' || current.error_code === 'CANCELLED')
      throw new AppError('CANCELLED', 409);
  };
  cancelled();
  if (job.kind === 'import' || job.kind === 'rescan_repository') {
    const request = payload.import_request;
    if (!request) throw new AppError('IMPORT_REQUEST_MISSING');
    const initial = store.get('ImportReport', job.id);
    saveImportReport(store, { ...initial, status: 'discovering' });
    const imported = await importRepository(
      request,
      initial,
      store.projectKey(p.id),
      cancelled,
      undefined,
      (report) => saveImportReport(store, report),
    );
    cancelled();
    const previousInputs = inputs;
    const priorFindings = store
      .list('Finding', p.id)
      .filter((f) => f.input_revision === p.input_revision && f.category === 'CREDENTIAL_EXPOSURE');
    const scopeComplete =
      job.kind === 'rescan_repository'
        ? await repositoryScopeComplete(
            {
              ...previousInputs,
              manifest: [
                ...previousInputs.manifest,
                ...priorFindings
                  .filter(
                    (f) =>
                      f.location.kind === 'file' &&
                      !previousInputs.manifest.some(
                        (m) => f.location.kind === 'file' && m.path === f.location.path,
                      ),
                  )
                  .map((f) => ({
                    path: f.location.kind === 'file' ? f.location.path : '',
                    kind: 'source' as const,
                    bytes: 0,
                  })),
              ],
            },
            imported.inputs,
            imported.report,
            request,
          )
        : false;
    if (job.kind === 'rescan_repository' && !scopeComplete) {
      const paths = [
        ...previousInputs.manifest.map((f) => f.path),
        ...priorFindings.flatMap((f) => (f.location.kind === 'file' ? [f.location.path] : [])),
      ];
      for (const path of new Set(paths))
        if (
          !imported.inputs.manifest.some((f) => f.path === path) &&
          !imported.report.exclusions.some((e) => e.path === path)
        )
          imported.report.exclusions.push({ path, reason: 'rescan_scope_gap', bytes: null });
    }
    const comparison =
      job.kind === 'rescan_repository' && scopeComplete
        ? compareStaticRescan(
            priorFindings,
            store.list('CredentialFingerprint', p.id),
            imported.inputs,
            p.input_revision + 1,
          )
        : null;
    store.transaction(() => {
      if (job.kind === 'rescan_repository') {
        p = { ...p, input_revision: p.input_revision + 1 };
        inputs = imported.inputs;
        inputs.expectation_edits = store
          .list('Expectation', p.id)
          .filter(
            (e) =>
              e.source === 'declared' &&
              (!inputs.sql_analysis ||
                inputs.sql_analysis.tables.some(
                  (t) =>
                    t.schema === e.resource.schema &&
                    t.name === e.resource.table &&
                    (!e.owner_column ||
                      t.columns.some((c) => c.name === e.owner_column && c.type === 'uuid')),
                )),
          )
          .map(
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
          );
        const updates =
          comparison?.updates ??
          priorFindings
            .filter(
              (f) =>
                ['confirmed', 'fixed', 'fix_not_verified'].includes(f.state) ||
                (f.location.kind === 'file' &&
                  !imported.inputs.manifest.some(
                    (m) => m.path === (f.location.kind === 'file' ? f.location.path : null),
                  )),
            )
            .map((f) => ({
              ...f,
              revision: f.revision + 1,
              input_revision: p.input_revision,
              state: f.state === 'fixed' ? ('fix_not_verified' as const) : f.state,
              retest_result: null,
              context: {
                ...f.context,
                limitations: [
                  ...f.context.limitations.slice(0, 498),
                  'Rescan coverage is incomplete; removal from the prior scope was not established',
                ],
              },
            }));
        updates.forEach((f) => save(store, f));
        if (comparison) store.put('ScanReport', comparison.report.id, p.id, comparison.report);
        for (const patch of store
          .list('MigrationPatch', p.id)
          .filter((p) => p.status !== 'superseded'))
          store.put(
            'MigrationPatch',
            patch.id,
            p.id,
            { ...patch, status: 'superseded' },
            Date.now(),
          );
      }
      inputs = imported.inputs;
      store.setInputs(p.id, inputs);
      p = { ...p, admitted_schema_digest: inputSchemaDigest(inputs) };
      store.saveProject(p);
      inputs.credential_findings.forEach((f) => {
        const fp = inputs.credential_fingerprints.find((x) => x.finding_id === f.id)?.fingerprint;
        const same =
          job.kind === 'rescan_repository' &&
          priorFindings.some(
            (old) =>
              old.location.kind === 'file' &&
              f.location.kind === 'file' &&
              old.location.path === f.location.path &&
              ['confirmed', 'fixed', 'fix_not_verified'].includes(old.state) &&
              store
                .list('CredentialFingerprint', p.id)
                .some((x) => x.finding_id === old.id && x.fingerprint === fp),
          );
        if (!same) save(store, f);
      });
      inputs.credential_fingerprints.forEach((fp) =>
        store.put('CredentialFingerprint', fp.finding_id, p.id, fp),
      );
      saveImportReport(store, imported.report);
    });
  }
  if (job.kind === 'project_analysis') {
    const summary = await summarizeProject(
      store.list('Finding', p.id).filter((f) => f.input_revision === p.input_revision),
      inputs.sql_analysis ?? null,
      p.input_revision,
      p.expectation_set_revision,
      cancelled,
      store.list('ImportReport', p.id).at(-1) ?? null,
    );
    cancelled();
    store.put(
      'ProjectSummary',
      job.id,
      p.id,
      validate('ProjectSummary', { ...summary, id: job.id }),
      2,
    );
    return;
  }
  if (job.phase === 'investigate') {
    const f = store.get('Finding', payload.finding_id!);
    if (f.revision !== payload.expected_finding_revision) throw new AppError('STALE_REVISION', 409);
    const snapshot = f.category === 'RLS_MISCONFIGURATION' ? store.currentSnapshot(p.id) : null;
    const ai_analysis = await investigate(f, snapshot);
    cancelled();
    save(
      store,
      validate('Finding', {
        ...f,
        revision: f.revision + 1,
        ai_analysis,
        timestamps: { ...f.timestamps, updated_at: new Date().toISOString() },
      }),
    );
  } else if (job.kind === 'rescan_credentials') {
    const previous = store
      .list('Finding', p.id)
      .filter(
        (f) => f.category === 'CREDENTIAL_EXPOSURE' && f.input_revision === p.input_revision - 1,
      );
    const comparison = compareStaticRescan(
      previous,
      store.list('CredentialFingerprint', p.id),
      inputs,
      p.input_revision,
    );
    cancelled();
    store.transaction(() => {
      store.put('ScanReport', comparison.report.id, p.id, comparison.report);
      comparison.updates.forEach((f) => save(store, f));
      inputs.credential_findings.forEach((f) => save(store, f));
      inputs.credential_fingerprints.forEach((fp) =>
        store.put('CredentialFingerprint', fp.finding_id, p.id, fp),
      );
      // Input revisions invalidate earlier verification/approval projections, not history.
      for (const f of store
        .list('Finding', p.id)
        .filter((f) => f.category === 'RLS_MISCONFIGURATION'))
        save(
          store,
          validate('Finding', {
            ...f,
            revision: f.revision + 1,
            input_revision: p.input_revision,
            state: f.expectation?.source === 'unknown' ? 'needs_expectation' : 'suspected',
            verification: { ...f.verification, stale: true },
            remediation: {
              status: 'none',
              patch_id: null,
              patch_digest: null,
              summary: null,
              approved_by: null,
              approved_at: null,
            },
            retest_result: null,
          }),
        );
      for (const patch of store
        .list('MigrationPatch', p.id)
        .filter((p) => p.status !== 'superseded'))
        store.put(
          'MigrationPatch',
          patch.id,
          p.id,
          validate('MigrationPatch', { ...patch, status: 'superseded' }),
          Date.now(),
        );
    });
  } else if (job.kind === 'scan' || job.kind === 'import' || job.kind === 'rescan_repository') {
    if (inputs.schema_sql || inputs.replay) {
      const sql = await readReplay(inputs, cancelled);
      const data = await withReplica(async (replica) => {
        await replica.apply(sql);
        cancelled();
        const snapshot = await introspect(replica, p.id);
        const expectations = resolveExpectations(
          snapshot,
          inputs.expectation_edits,
          job.kind === 'rescan_repository' ? store.list('Expectation', p.id) : [],
          'manifest',
          p.id,
          job.kind === 'rescan_repository',
        );
        const findings = await analyzeRls(snapshot, expectations, p.id, p.input_revision);
        if (findings.length + inputs.credential_findings.length > 500)
          throw new AppError('IMPORT_FINDING_LIMIT');
        return { snapshot, expectations, findings };
      }, inputs.replay?.profile).catch((error: unknown) => {
        cancelled();
        persistStaticReview(store, p, inputs, job.kind === 'rescan_repository');
        throw error;
      });
      cancelled();
      store.transaction(() => {
        store.put(
          'SchemaSnapshot',
          data.snapshot.id,
          p.id,
          { ...data.snapshot, admitted_schema_digest: inputSchemaDigest(inputs)! },
          p.input_revision,
        );
        data.expectations.forEach((e) => store.put('Expectation', e.id, p.id, e, e.revision));
        data.findings.forEach((f) => save(store, f));
        store.saveProject({ ...p, expectation_set_revision: p.expectation_set_revision + 1 });
      });
    } else if (inputs.sql_analysis?.tables.length) {
      persistStaticReview(store, p, inputs, job.kind === 'rescan_repository');
    }
  } else if (job.kind === 'verify') {
    const expectations = store.list('Expectation', p.id);
    const sql = await readReplay(inputs, cancelled);
    const before = await withReplica(async (replica) => {
      await replica.apply(sql);
      cancelled();
      const snapshot = await introspect(replica, p.id);
      return runMatrix(
        replica,
        snapshot,
        expectations,
        p.id,
        p.input_revision,
        false,
        undefined,
        null,
        cancelled,
      );
    }, inputs.replay?.profile);
    cancelled();
    store.transaction(() => {
      store.put('Run', before.run.id, p.id, before.run);
      before.results.forEach((r) => store.put('TestResult', r.id, p.id, r));
      for (const f of store
        .list('Finding', p.id)
        .filter(
          (f) => f.input_revision === p.input_revision && f.category === 'RLS_MISCONFIGURATION',
        )) {
        const results = before.results.filter((r) => r.expectation_id === f.expectation?.id);
        if (f.expectation?.source === 'unknown') {
          save(
            store,
            validate('Finding', {
              ...f,
              revision: f.revision + 1,
              verification: {
                status: 'partial',
                latest_run_id: before.run.id,
                evidence: results,
                stale: false,
              },
            }),
          );
          continue;
        }
        const reproduced = results.some(
          (r) => r.expected === 'deny' && r.observed === 'allow' && r.outcome === 'mismatch',
        );
        // `finding-model-and-lifecycle.md` requires fixed -> confirmed for a new valid mismatch.
        // Other outcomes cannot relabel an immutable approved retest as a new fix.
        if (f.state === 'fix_not_verified' || (f.state === 'fixed' && !reproduced)) continue;
        let next: Finding;
        if (f.expectation?.expected === 'all_rows')
          next = validate('Finding', {
            ...f,
            revision: f.revision + 1,
            verification: {
              status: results.some((r) => r.outcome === 'inconclusive') ? 'partial' : 'complete',
              latest_run_id: before.run.id,
              evidence: results,
              stale: false,
            },
          });
        else
          next = transitionFinding(f, {
            type: 'verification',
            results,
            control_results: before.results,
            run_id: before.run.id,
            current: true,
          });
        if (next.state === 'confirmed') {
          if (f.state === 'fixed') {
            next.retest_result = null;
            next.timestamps.fixed_at = null;
            next.remediation = {
              status: 'none',
              patch_id: null,
              patch_digest: null,
              summary: null,
              approved_by: null,
              approved_at: null,
            };
            if (f.remediation.patch_id) {
              const patch = store.get('MigrationPatch', f.remediation.patch_id);
              store.put(
                'MigrationPatch',
                patch.id,
                p.id,
                validate('MigrationPatch', { ...patch, status: 'superseded' }),
                Date.now(),
              );
            }
          }
          next.title = `${next.expectation!.operation} mismatch reproduced in local replica`;
          next.source.rule_ids = [...new Set([...next.source.rule_ids, 'RLS-009'])];
          next.severity = 'high';
          next.severity_basis = `Expected DENY / observed ALLOW against ${next.expectation!.source} intent; local replica`;
          next.confidence = {
            level: next.expectation!.source === 'inferred' ? 'medium' : 'high',
            basis: 'Valid synthetic reproduction with identity and operation controls',
          };
        }
        save(store, validate('Finding', next));
      }
    });
  } else if (job.kind === 'retest') {
    const patch = store.get('MigrationPatch', payload.patch_id!);
    const f = store.get('Finding', patch.finding_id);
    if (f.revision !== payload.expected_finding_revision) throw new AppError('STALE_REVISION', 409);
    const baseline = {
      run: store.get('Run', patch.baseline_run_id),
      results: store.list('TestResult', p.id).filter((r) => r.run_id === patch.baseline_run_id),
    };
    const pending = transitionFinding(f, { type: 'patch_applied', approved: true });
    save(store, pending);
    const after = await retestPatch(
      await readReplay(inputs, cancelled),
      patch,
      baseline,
      store.list('Expectation', p.id),
      false,
      cancelled,
      inputs.replay?.profile,
    );
    cancelled();
    store.transaction(() => {
      store.put('Run', after.run.id, p.id, after.run);
      after.results.forEach((r) => store.put('TestResult', r.id, p.id, r));
      store.put(
        'MigrationPatch',
        patch.id,
        p.id,
        validate('MigrationPatch', { ...patch, status: 'applied' }),
        3,
      );
      const fixed = transitionFinding(pending, {
        type: 'retest',
        result: after.comparison,
        approved: true,
        current: true,
      });
      fixed.remediation = { ...fixed.remediation, status: 'applied' };
      save(store, fixed);
    });
  } else throw new AppError('JOB_KIND_UNSUPPORTED');
}
export async function runNext(store: Store): Promise<boolean> {
  const item = store.claim();
  if (!item) return false;
  const { job, payload } = item;
  try {
    await dispatch(store, job, payload);
    if (store.job(job.id).error_code !== 'CANCELLED') {
      job.status = 'succeeded';
      job.progress.completed = 1;
      store.updateJob(job);
      if (
        (job.kind === 'import' ||
          (job.kind === 'scan' && job.phase !== 'investigate') ||
          job.kind === 'rescan_credentials' ||
          job.kind === 'rescan_repository') &&
        store.inputs(job.project_id)
      )
        enqueueAutomaticAnalysis(store, job.project_id);
    }
  } catch (error) {
    if (job.kind === 'import' || job.kind === 'rescan_repository') {
      const report = store.get('ImportReport', job.id);
      saveImportReport(store, {
        ...report,
        status: report.status === 'complete' ? 'complete' : 'failed',
        error_code: errorCode(error),
        rls:
          report.rls.status === 'ready'
            ? { status: 'replica_failed', reason_code: errorCode(error) }
            : report.rls,
      });
    }
    if (store.job(job.id).error_code !== 'CANCELLED') {
      job.status = 'failed';
      job.error_code = errorCode(error);
      store.updateJob(job);
    }
    if (
      (job.kind === 'import' ||
        job.kind === 'rescan_repository' ||
        (job.kind === 'scan' && job.phase !== 'investigate')) &&
      store.job(job.id).status === 'failed' &&
      store.inputs(job.project_id).sql_analysis &&
      store.get('Project', job.project_id).expectation_set_revision >
        payload.expectation_set_revision
    )
      enqueueAutomaticAnalysis(store, job.project_id);
    const f = payload.finding_id ? store.get('Finding', payload.finding_id) : null;
    if (job.kind === 'project_analysis') {
      const pending = store.get('ProjectSummary', job.id);
      store.put(
        'ProjectSummary',
        job.id,
        job.project_id,
        { ...pending, status: 'unavailable', reason_code: errorCode(error) },
        2,
      );
    }
    if (f && f.state === 'fix_not_verified')
      save(
        store,
        validate('Finding', {
          ...f,
          revision: f.revision + 1,
          remediation: { ...f.remediation, status: 'failed' },
        }),
      );
    logEvent('worker', errorCode(error), { job_id: job.id });
  } finally {
    const current = store.job(job.id);
    if (current.status === 'running' && current.error_code === 'CANCELLED') {
      current.status = 'cancelled';
      store.updateJob(current);
    }
  }
  return true;
}
