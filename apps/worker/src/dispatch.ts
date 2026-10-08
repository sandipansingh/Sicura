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
import { investigate } from '../../../packages/core/src/ai/ollama';
import { AppError, errorCode, logEvent } from '../../../packages/core/src/errors';
import { compareStaticRescan } from '../../../packages/core/src/secrets/rescan';
import { importRepository } from '../../../packages/core/src/repository/import';
import { saveImportReport } from '../../../packages/store/src/imports';
import { hash } from '../../../packages/core/src/hash';

function save(store: Store, f: Finding): void {
  store.put('Finding', f.id, f.project_id, f, f.revision);
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
  if (job.kind === 'import') {
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
    store.transaction(() => {
      inputs = imported.inputs;
      store.setInputs(p.id, inputs);
      p = { ...p, admitted_schema_digest: inputs.schema_sql ? hash(inputs.schema_sql) : null };
      store.saveProject(p);
      inputs.credential_findings.forEach((f) => save(store, f));
      inputs.credential_fingerprints.forEach((fp) =>
        store.put('CredentialFingerprint', fp.finding_id, p.id, fp),
      );
      saveImportReport(store, imported.report);
    });
  }
  if (job.phase === 'investigate') {
    const f = store.get('Finding', payload.finding_id!);
    if (f.revision !== payload.expected_finding_revision) throw new AppError('STALE_REVISION', 409);
    const snapshot =
      f.category === 'RLS_MISCONFIGURATION'
        ? (store.list('SchemaSnapshot', p.id).at(-1) ?? null)
        : null;
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
  } else if (job.kind === 'scan' || job.kind === 'import') {
    if (inputs.schema_sql) {
      const data = await withReplica(async (replica) => {
        await replica.apply(inputs.schema_sql);
        cancelled();
        const snapshot = await introspect(replica, p.id);
        const expectations = resolveExpectations(
          snapshot,
          inputs.expectation_edits,
          [],
          'manifest',
          p.id,
        );
        const findings = await analyzeRls(snapshot, expectations, p.id, p.input_revision);
        if (findings.length + inputs.credential_findings.length > 500)
          throw new AppError('IMPORT_FINDING_LIMIT');
        return { snapshot, expectations, findings };
      });
      cancelled();
      store.transaction(() => {
        store.put('SchemaSnapshot', data.snapshot.id, p.id, data.snapshot, p.input_revision);
        data.expectations.forEach((e) => store.put('Expectation', e.id, p.id, e, e.revision));
        data.findings.forEach((f) => save(store, f));
        store.saveProject({ ...p, expectation_set_revision: p.expectation_set_revision + 1 });
      });
    }
  } else if (job.kind === 'verify') {
    const expectations = store.list('Expectation', p.id);
    const before = await withReplica(async (replica) => {
      await replica.apply(inputs.schema_sql);
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
    });
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
      inputs.schema_sql,
      patch,
      baseline,
      store.list('Expectation', p.id),
      false,
      cancelled,
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
    }
  } catch (error) {
    if (job.kind === 'import') {
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
    const f = payload.finding_id ? store.get('Finding', payload.finding_id) : null;
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
