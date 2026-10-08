import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { Store } from '../../packages/store/src/index';
import { parseStrictJson, validate, type JobPayload } from '../../packages/contracts/src/index';
import { admitInputs } from '../../packages/core/src/intake/inputs';
import { renderPatch, approvePatch } from '../../packages/core/src/remediation/render';
import { runNext } from '../../apps/worker/src/dispatch';
import { badge } from '../../apps/web/components/state-copy';

it('reopens a fixed finding when ordinary verification replays the vulnerable schema, preserving historical proof', async () => {
  const store = new Store(':memory:');
  const now = new Date().toISOString();
  const project = validate('Project', {
    id: 'post_fix_verification',
    name: 'Synthetic post-fix verification regression',
    input_revision: 1,
    expectation_set_revision: 0,
    admitted_schema_digest: null,
    created_at: now,
    expires_at: now,
  });
  const schema = await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8');
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile('eval/fixtures/rls/R-01/expectations.json', 'utf8'), 65536),
  );
  try {
    store.saveProject(project);
    const original = await admitInputs(
      {
        files: [{ path: 'schema.sql', kind: 'sql', content: schema }],
        sql_order: ['schema.sql'],
        expectations: manifest,
      },
      project.id,
      1,
      store.projectKey(project.id),
    );
    store.setInputs(project.id, original);
    const payload = (): JobPayload => ({
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: store.get('Project', project.id).expectation_set_revision,
    });
    const scan = store.enqueue(project, 'scan', 'replica', 'scan', payload());
    await runNext(store);
    expect(store.job(scan.id).status).toBe('succeeded');
    const summary = store.jobs(project.id).find((j) => j.kind === 'project_analysis')!;
    expect(summary.status).toBe('queued');
    store.cancelJob(summary.id); // Independent replica verification remains usable after advisory cancellation.
    const baselineJob = store.enqueue(
      store.get('Project', project.id),
      'verify',
      'verify',
      'baseline',
      payload(),
    );
    await runNext(store);
    expect(store.job(baselineJob.id).status).toBe('succeeded');
    const confirmed = store
      .list('Finding', project.id)
      .find(
        (f) =>
          f.expectation?.resource.table === 'profiles' &&
          f.expectation.actor === 'authenticated' &&
          f.expectation.operation === 'SELECT',
      )!;
    expect(confirmed.state).toBe('confirmed');
    const baseline = store.get('Run', confirmed.verification.latest_run_id!);
    const patch = renderPatch(
      confirmed,
      store.list('SchemaSnapshot', project.id).at(-1)!,
      baseline,
    );
    const approved = approvePatch(
      patch,
      {
        patch_digest: patch.patch_digest,
        baseline_digest: patch.baseline_schema_digest,
        expectation_revision_ids: patch.expectation_revision_ids,
      },
      baseline,
    );
    store.put('MigrationPatch', approved.id, project.id, approved, 2);
    const ready = validate('Finding', {
      ...confirmed,
      revision: confirmed.revision + 1,
      remediation: {
        status: 'approved',
        patch_id: approved.id,
        patch_digest: approved.patch_digest,
        summary: approved.rationale,
        approved_by: 'local_operator',
        approved_at: approved.approval!.approved_at,
      },
    });
    store.put('Finding', ready.id, project.id, ready, ready.revision);
    const retestJob = store.enqueue(
      store.get('Project', project.id),
      'retest',
      'retest',
      'approved-retest',
      {
        ...payload(),
        finding_id: ready.id,
        patch_id: approved.id,
        expected_finding_revision: ready.revision,
      },
    );
    await runNext(store);
    expect(store.job(retestJob.id).status).toBe('succeeded');
    const fixed = store.get('Finding', ready.id);
    expect(fixed.state).toBe('fixed');
    expect(fixed.retest_result?.status).toBe('passed');
    const historicalRetest = store.get('Run', fixed.retest_result!.run_id);
    const historicalResults = store
      .list('TestResult', project.id)
      .filter((r) => r.run_id === historicalRetest.id);
    expect(
      historicalResults
        .filter((r) => r.test_id === 'rls.cross_user_read.v1' && r.resource.table === 'profiles')
        .map((r) => r.observed),
    ).toEqual(['deny', 'deny']);

    // Replica-only apply never edits project SQL. Restoring the submitted vulnerable chain
    // makes the next ordinary verification a new baseline, not a retest of the approved patch.
    store.setInputs(project.id, original);
    const newJob = store.enqueue(
      store.get('Project', project.id),
      'verify',
      'verify',
      'vulnerable-again',
      payload(),
    );
    await runNext(store);
    expect(store.job(newJob.id).status).toBe('succeeded');
    const latestRun = store.list('Run', project.id).at(-1)!;
    expect(latestRun.id).not.toBe(historicalRetest.id);
    const latestResults = store
      .list('TestResult', project.id)
      .filter((r) => r.run_id === latestRun.id);
    const foreignReads = latestResults.filter(
      (r) => r.test_id === 'rls.cross_user_read.v1' && r.resource.table === 'profiles',
    );
    expect(foreignReads.map((r) => [r.expected, r.observed, r.outcome])).toEqual([
      ['deny', 'allow', 'mismatch'],
      ['deny', 'allow', 'mismatch'],
    ]);
    expect(foreignReads.every((r) => r.role_assertion_passed && r.control_result_ids.length)).toBe(
      true,
    );
    const reopened = store.get('Finding', ready.id);
    expect(reopened.state).toBe('confirmed');
    expect(badge(reopened)).toBe('Confirmed in replica');
    expect(reopened.verification.latest_run_id).toBe(latestRun.id);
    expect(reopened.verification.evidence.every((r) => r.run_id === latestRun.id)).toBe(true);
    expect(reopened.retest_result).toBeNull();
    expect(reopened.remediation.patch_id).toBeNull();
    expect(reopened.timestamps.fixed_at).toBeNull();
    expect(store.get('MigrationPatch', approved.id).status).toBe('superseded');
    expect(store.get('Run', historicalRetest.id)).toEqual(historicalRetest);
    expect(
      store.list('TestResult', project.id).filter((r) => r.run_id === historicalRetest.id),
    ).toEqual(historicalResults);
  } finally {
    store.close();
  }
});
