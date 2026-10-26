import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  validate,
  parseStrictJson,
  type ContractMap,
  type Project,
  type Job,
  type JobPayload,
} from '../../contracts/src/index';
import { newId } from '../../core/src/hash';
import { AppError } from '../../core/src/errors';
import { redactValue } from '../../core/src/secrets/sink';
import { randomBytes } from 'node:crypto';

type Name = keyof ContractMap;
export class Store {
  readonly db: Database.Database;
  constructor(path = resolve(process.env.PROOFSEC_DATA_DIR ?? '.local', 'proofsec.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(kind,id,revision));
      CREATE TABLE IF NOT EXISTS inputs(project_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_keys(project_id TEXT PRIMARY KEY, key_hex TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, body TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(project_id,idempotency_key));`);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  put<K extends Name>(
    kind: K,
    id: string,
    project_id: string,
    value: ContractMap[K],
    revision = 1,
  ): void {
    const safe = validate(kind, redactValue(value));
    this.db
      .prepare('INSERT INTO records(kind,id,project_id,revision,body) VALUES(?,?,?,?,?)')
      .run(kind, id, project_id, revision, JSON.stringify(safe));
  }
  get<K extends Name>(kind: K, id: string): ContractMap[K] {
    const row = this.db
      .prepare('SELECT body FROM records WHERE kind=? AND id=? ORDER BY revision DESC LIMIT 1')
      .get(kind, id) as { body: string } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 404);
    return validate(kind, parseStrictJson(row.body, 16 * 1024 * 1024));
  }
  list<K extends Name>(kind: K, project_id?: string): ContractMap[K][] {
    const rows = this.db
      .prepare(
        `SELECT r.body FROM records r WHERE kind=? ${project_id ? 'AND project_id=?' : ''} AND revision=(SELECT MAX(revision) FROM records x WHERE x.kind=r.kind AND x.id=r.id) ORDER BY rowid`,
      )
      .all(...(project_id ? [kind, project_id] : [kind])) as { body: string }[];
    return rows.map((r) => validate(kind, parseStrictJson(r.body, 16 * 1024 * 1024)));
  }
  currentSnapshot(project_id: string): ContractMap['SchemaSnapshot'] | null {
    const p = this.get('Project', project_id);
    if (!p.admitted_schema_digest) return null;
    return (
      this.list('SchemaSnapshot', project_id)
        .reverse()
        .find((snapshot) => {
          if (snapshot.admitted_schema_digest)
            return snapshot.admitted_schema_digest === p.admitted_schema_digest;
          const row = this.db
            .prepare('SELECT MAX(revision) AS revision FROM records WHERE kind=? AND id=?')
            .get('SchemaSnapshot', snapshot.id) as { revision: number };
          return row.revision === p.input_revision;
        }) ?? null
    );
  }
  saveProject(p: Project): void {
    const row = this.db
      .prepare('SELECT MAX(revision) AS revision FROM records WHERE kind=? AND id=?')
      .get('Project', p.id) as { revision: number | null };
    this.put('Project', p.id, p.id, p, (row.revision ?? 0) + 1);
  }
  setInputs(project_id: string, inputs: ContractMap['AdmittedInputs']): void {
    validate('AdmittedInputs', inputs);
    if (JSON.stringify(redactValue(inputs)) !== JSON.stringify(inputs))
      throw new AppError('SINK_SECRET_REJECTED');
    this.db
      .prepare(
        'INSERT INTO inputs VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET body=excluded.body',
      )
      .run(project_id, JSON.stringify(inputs));
  }
  inputs(project_id: string): ContractMap['AdmittedInputs'] {
    const r = this.db.prepare('SELECT body FROM inputs WHERE project_id=?').get(project_id) as
      | { body: string }
      | undefined;
    if (!r) throw new AppError('INPUTS_MISSING', 409);
    const data = parseStrictJson(r.body, 16 * 1024 * 1024);
    // m1 stored no private identities. Their absence cannot establish removal.
    if (data && typeof data === 'object' && !('credential_fingerprints' in data))
      Object.assign(data, { credential_fingerprints: [] });
    return validate('AdmittedInputs', data);
  }
  projectKey(project_id: string): Buffer {
    return this.transaction(() => {
      let row = this.db
        .prepare('SELECT key_hex FROM project_keys WHERE project_id=?')
        .get(project_id) as { key_hex: string } | undefined;
      if (!row) {
        row = { key_hex: randomBytes(32).toString('hex') };
        this.db.prepare('INSERT INTO project_keys VALUES(?,?)').run(project_id, row.key_hex);
      }
      return Buffer.from(row.key_hex, 'hex');
    });
  }
  jobs(project_id?: string): Job[] {
    const rows = this.db
      .prepare(
        `SELECT body FROM queue ${project_id ? 'WHERE project_id=?' : ''} ORDER BY created_at`,
      )
      .all(...(project_id ? [project_id] : [])) as { body: string }[];
    return rows.map((r) => validate('Job', parseStrictJson(r.body)));
  }
  job(id: string): Job {
    const row = this.db.prepare('SELECT body FROM queue WHERE id=?').get(id) as
      | { body: string }
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', 404);
    return validate('Job', parseStrictJson(row.body));
  }
  jobPayload(id: string): JobPayload {
    const row = this.db.prepare('SELECT payload FROM queue WHERE id=?').get(id) as
      | { payload: string }
      | undefined;
    if (!row) throw new AppError('NOT_FOUND', 404);
    return validate('JobPayload', parseStrictJson(row.payload, 65536));
  }
  enqueue(
    project: Project,
    kind: Job['kind'],
    phase: Job['phase'],
    key: string,
    payload: JobPayload,
  ): Job {
    validate('JobPayload', payload);
    const existing = this.db
      .prepare('SELECT body FROM queue WHERE project_id=? AND idempotency_key=?')
      .get(project.id, key) as { body: string } | undefined;
    if (existing) return validate('Job', parseStrictJson(existing.body));
    this.assertIdle(project.id);
    const now = new Date().toISOString();
    const job = validate('Job', {
      id: newId('job'),
      project_id: project.id,
      kind,
      phase,
      status: 'queued',
      input_revision: project.input_revision,
      idempotency_key: key,
      lease_until: null,
      progress: { completed: 0, total: 1 },
      error_code: null,
      created_at: now,
      updated_at: now,
    });
    this.db
      .prepare('INSERT INTO queue VALUES(?,?,?,?,?,?,?)')
      .run(job.id, project.id, job.status, key, JSON.stringify(job), JSON.stringify(payload), now);
    return job;
  }
  assertIdle(project_id: string): void {
    if (this.jobs(project_id).some((j) => j.status === 'running' || j.status === 'queued'))
      throw new AppError('PROJECT_BUSY', 409);
  }
  claim(): { job: Job; payload: JobPayload } | null {
    return this.transaction(() => {
      if (this.jobs().some((j) => j.status === 'running')) return null;
      const row = this.db
        .prepare("SELECT body,payload FROM queue WHERE status='queued' ORDER BY created_at LIMIT 1")
        .get() as { body: string; payload: string } | undefined;
      if (!row) return null;
      const job = validate('Job', parseStrictJson(row.body));
      job.status = 'running';
      this.updateJob(job);
      return { job, payload: validate('JobPayload', parseStrictJson(row.payload)) };
    });
  }
  updateJob(job: Job): void {
    job.updated_at = new Date().toISOString();
    validate('Job', job);
    this.db
      .prepare('UPDATE queue SET status=?,body=? WHERE id=?')
      .run(job.status, JSON.stringify(job), job.id);
  }
  cancelJob(id: string): Job {
    return this.transaction(() => {
      const job = this.job(id);
      if (job.status === 'cancelled') return job;
      if (!['queued', 'running'].includes(job.status))
        throw new AppError('JOB_NOT_CANCELLABLE', 409);
      // A running job retains its busy lock until the worker acknowledges cleanup.
      if (job.status === 'queued') job.status = 'cancelled';
      job.error_code = 'CANCELLED';
      this.updateJob(job);
      if (job.kind === 'project_analysis' && job.status === 'cancelled') {
        const summary = this.get('ProjectSummary', id);
        this.put(
          'ProjectSummary',
          id,
          job.project_id,
          { ...summary, status: 'unavailable', reason_code: 'CANCELLED' },
          2,
        );
      }
      return job;
    });
  }
  recover(): void {
    for (const j of this.jobs())
      if (j.status === 'running') {
        j.status = j.error_code === 'CANCELLED' ? 'cancelled' : 'failed';
        if (j.error_code !== 'CANCELLED') j.error_code = 'WORKER_INTERRUPTED';
        this.updateJob(j);
        if (j.kind === 'project_analysis') {
          const summary = this.get('ProjectSummary', j.id);
          this.put(
            'ProjectSummary',
            j.id,
            j.project_id,
            { ...summary, status: 'unavailable', reason_code: j.error_code },
            2,
          );
        }
        if (j.kind === 'import' || j.kind === 'rescan_repository') {
          const report = this.get('ImportReport', j.id);
          const row = this.db
            .prepare('SELECT MAX(revision) AS revision FROM records WHERE kind=? AND id=?')
            .get('ImportReport', j.id) as { revision: number };
          this.put(
            'ImportReport',
            j.id,
            j.project_id,
            { ...report, status: 'interrupted', error_code: j.error_code },
            row.revision + 1,
          );
        }
      }
  }
  deleteProject(id: string): void {
    this.assertIdle(id);
    this.transaction(() => {
      this.db.prepare('DELETE FROM records WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM inputs WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM project_keys WHERE project_id=?').run(id);
      this.db.prepare('DELETE FROM queue WHERE project_id=?').run(id);
    });
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
  close(): void {
    this.db.close();
  }
}
