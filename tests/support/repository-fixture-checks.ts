import assert from 'node:assert/strict';
import type { Job } from '../../packages/contracts/src/index';
import type { Store } from '../../packages/store/src/index';
import { repositorySentinel, type RepositoryFixture } from './repository-fixtures';

export function assertRepositoryFixture(id: RepositoryFixture, store: Store, job: Job): void {
  const report = store.get('ImportReport', job.id);
  const inputs = store.inputs(job.project_id);
  assert.equal(store.job(job.id).status, 'succeeded');
  assert.equal(report.status, 'complete');
  assert.equal(inputs.schema_sql, '');
  assert.equal(store.list('Run', job.project_id).length, 0);
  assert.equal(store.list('TestResult', job.project_id).length, 0);
  assert.equal(
    store.list('Finding', job.project_id).some((f) => f.category === 'RLS_MISCONFIGURATION'),
    false,
  );
  assert.equal(
    JSON.stringify(store.db.prepare('SELECT * FROM records').all()).includes(repositorySentinel),
    false,
  );
  assert.equal(JSON.stringify(inputs).includes(repositorySentinel), false);
  if (id === 'unsupported-chain') {
    assert.equal(report.rls.status, 'unsupported_sql');
    assert.equal(report.rls.reason_code, 'SQL_UNSUPPORTED');
    assert.ok(report.credential_findings > 0);
    assert.deepEqual(report.sql_order, [
      'supabase/migrations/1_schema.sql',
      'supabase/migrations/2_function.sql',
      'supabase/migrations/3_storage.sql',
    ]);
  } else if (id === 'credential-only') {
    assert.equal(report.rls.status, 'missing_schema');
    assert.equal(report.rls.reason_code, 'SCHEMA_MISSING');
    assert.ok(report.credential_findings > 0);
  } else if (id === 'ambiguous-roots') {
    assert.equal(report.rls.status, 'choice_required');
    assert.equal(report.rls.reason_code, 'IMPORT_SQL_CHOICE_REQUIRED');
    assert.equal(report.roots.length, 2);
    assert.ok(report.roots.some((root) => !root.ordered));
    assert.equal(report.selected_root, null);
    assert.deepEqual(report.sql_order, []);
  } else if (id === 'missing-schema') {
    assert.equal(report.rls.status, 'missing_schema');
    assert.equal(report.rls.reason_code, 'SCHEMA_MISSING');
    assert.deepEqual(report.orm_metadata, ['prisma/schema.prisma']);
    assert.equal(report.credential_findings, 0);
  } else {
    assert.equal(report.rls.status, 'unsupported_sql');
    assert.equal(report.rls.reason_code, 'IMPORT_MIGRATION_GAP');
    assert.deepEqual(report.exclusions.map((e) => e.reason).sort(), [
      'generated',
      'oversized',
      'symlink',
    ]);
    assert.equal(report.roots[0]!.complete, false);
    assert.equal(report.credential_findings, 0);
  }
}
