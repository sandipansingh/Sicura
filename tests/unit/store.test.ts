import { expect, it } from 'vitest';
import { Store } from '../../packages/store/src/index';
import fixture from '../../packages/contracts/fixtures/rls-finding.json';
import { validate } from '../../packages/contracts/src/index';
it('preserves immutable evidence and rolls back conflicting revision writes', () => {
  const s = new Store(':memory:');
  try {
    const f = validate('Finding', fixture);
    s.put('Finding', f.id, f.project_id, f);
    expect(() => s.put('Finding', f.id, f.project_id, f)).toThrow();
    expect(s.get('Finding', f.id)).toEqual(f);
    expect(() =>
      s.transaction(() => {
        s.put('Finding', 'second', f.project_id, { ...f, id: 'second' });
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(s.list('Finding')).toHaveLength(1);
  } finally {
    s.close();
  }
});
it('serializes queue claims, idempotency and interrupted-work recovery', () => {
  const s = new Store(':memory:');
  try {
    const now = new Date().toISOString();
    const p = validate('Project', {
      id: 'project',
      name: 'test',
      input_revision: 1,
      expectation_set_revision: 1,
      admitted_schema_digest: null,
      created_at: now,
      expires_at: now,
    });
    s.saveProject(p);
    const payload = {
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: 1,
    };
    const j = s.enqueue(p, 'verify', 'verify', 'key', payload);
    expect(s.enqueue(p, 'verify', 'verify', 'key', payload).id).toBe(j.id);
    expect(() => s.enqueue(p, 'verify', 'verify', 'other', payload)).toThrow('PROJECT_BUSY');
    expect(s.claim()?.job.id).toBe(j.id);
    expect(s.claim()).toBeNull();
    s.recover();
    expect(s.job(j.id).error_code).toBe('WORKER_INTERRUPTED');
    s.deleteProject(p.id);
    expect(s.list('Project')).toEqual([]);
    expect(s.jobs()).toEqual([]);
  } finally {
    s.close();
  }
});

it('queues different projects but permits only one running job across worker claims', () => {
  const s = new Store(':memory:');
  try {
    const now = new Date().toISOString();
    const payload = {
      finding_id: null,
      patch_id: null,
      expected_finding_revision: null,
      expectation_set_revision: 1,
    };
    for (const id of ['project_a', 'project_b']) {
      const project = validate('Project', {
        id,
        name: 'Concurrent audit',
        input_revision: 1,
        expectation_set_revision: 1,
        admitted_schema_digest: null,
        created_at: now,
        expires_at: now,
      });
      s.saveProject(project);
      s.enqueue(project, 'verify', 'verify', id, payload);
    }
    const first = s.claim()!.job;
    expect(s.claim()).toBeNull();
    expect(s.jobs().filter((j) => j.status === 'running')).toHaveLength(1);
    s.updateJob({ ...first, status: 'succeeded' });
    expect(s.claim()!.job.id).not.toBe(first.id);
    expect(s.claim()).toBeNull();
  } finally {
    s.close();
  }
});
