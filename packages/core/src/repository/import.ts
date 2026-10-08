import {
  validate,
  type ImportReport,
  type ImportRequest,
  type AdmittedInputs,
} from '../../../contracts/src/index';
import { hash } from '../hash';
import { createHmac } from 'node:crypto';
import { AppError, errorCode } from '../errors';
import { analyzeSqlFiles } from '../rls/sql-analysis';
import { admitSql } from '../intake/admit';
import { admitRepositorySql } from '../intake/repository-profile';
import { replayManifest } from './replay';
import { credentialFindings } from '../secrets/findings';
import { redactValue } from '../secrets/sink';
import { localSnapshot } from './local';
import { githubSnapshot } from './github';
import { IMPORT_LIMITS, exclusion, discoverRoots, chooseSql } from './discovery';
import type { RepositorySnapshot } from './types';

export function emptyImportReport(
  project_id: string,
  job_id: string,
  request: ImportRequest,
  input_revision = 1,
): ImportReport {
  return validate('ImportReport', {
    id: job_id,
    project_id,
    job_id,
    input_revision,
    status: 'queued',
    provenance: {
      kind: request.source.kind,
      label: request.source.kind === 'github' ? request.source.url : 'Saved local Git workspace',
      commit: null,
      workspace_digest: null,
    },
    files_analyzed: 0,
    bytes_analyzed: 0,
    credential_findings: 0,
    exclusions: [],
    roots: [],
    orm_metadata: [],
    selected_root: null,
    sql_order: [],
    rls: { status: 'pending', reason_code: null },
    error_code: null,
    sql_profile: 'repository-v2',
    created_at: new Date().toISOString(),
  });
}
export async function importRepository(
  request: ImportRequest,
  initial: ImportReport,
  key: Buffer,
  check = () => {},
  snapshot?: RepositorySnapshot,
  progress: (report: ImportReport) => void = () => {},
): Promise<{ inputs: AdmittedInputs; report: ImportReport }> {
  validate('ImportRequest', request);
  const started = Date.now();
  const guard = () => {
    check();
    if (Date.now() - started > 120000) throw new AppError('IMPORT_TIMEOUT');
  };
  guard();
  const source =
    snapshot ??
    (request.source.kind === 'github'
      ? await githubSnapshot(request.source.url, request.source.ref)
      : await localSnapshot(request.source.directory));
  const report: ImportReport = { ...initial, status: 'discovering', provenance: source.provenance };
  const eligible: typeof source.entries = [];
  const paths = new Set<string>();
  for (const entry of source.entries) {
    guard();
    if (paths.has(entry.path)) throw new AppError('IMPORT_PATH_DUPLICATE');
    paths.add(entry.path);
    const reason =
      entry.reason ??
      exclusion(entry.path) ??
      (entry.bytes > IMPORT_LIMITS.file ? 'oversized' : null);
    if (reason)
      report.exclusions.push({ path: entry.path.slice(0, 500), reason, bytes: entry.bytes });
    else eligible.push(entry);
  }
  progress(validate('ImportReport', redactValue(report)));
  if (
    eligible.length > IMPORT_LIMITS.files ||
    eligible.reduce((n, e) => n + e.bytes, 0) > IMPORT_LIMITS.bytes
  )
    throw new AppError('IMPORT_LIMIT', 413);
  const files: { path: string; content: string; bytes: number }[] = [];
  const fingerprints: AdmittedInputs['credential_fingerprints'] = [];
  const findings: AdmittedInputs['credential_findings'] = [];
  // No source is persisted or sent to the model. Batch size is independently bounded.
  for (let start = 0; start < eligible.length; start += 200) {
    const batch = eligible.slice(start, start + 200);
    for (let offset = 0; offset < batch.length; offset += 4) {
      guard();
      const group = batch.slice(offset, offset + 4);
      const loaded = await Promise.allSettled(group.map((entry) => source.read(entry)));
      guard();
      for (const [index, item] of loaded.entries()) {
        if (item.status === 'rejected') throw item.reason;
        const entry = group[index]!;
        const buffer = item.value;
        if (buffer.length !== entry.bytes || buffer.length > IMPORT_LIMITS.file)
          throw new AppError('IMPORT_WORKSPACE_CHANGED');
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
          if (content.includes('\0')) throw new Error();
        } catch {
          report.exclusions.push({
            path: entry.path,
            reason: 'unsupported_encoding',
            bytes: entry.bytes,
          });
          continue;
        }
        files.push({ path: entry.path, content, bytes: buffer.length });
        findings.push(
          ...credentialFindings(entry.path, content, initial.project_id, initial.input_revision, {
            key,
            capture: (finding_id, fingerprint) => fingerprints.push({ finding_id, fingerprint }),
          }),
        );
        if (findings.length > 500) throw new AppError('IMPORT_FINDING_LIMIT');
      }
    }
  }
  report.provenance.workspace_digest =
    request.source.kind === 'local'
      ? createHmac('sha256', key)
          .update(
            hash(
              files
                .map((f) => ({ path: f.path, digest: hash(f.content) }))
                .sort((a, b) => a.path.localeCompare(b.path, 'en')),
            ),
          )
          .digest('hex')
      : null;
  report.files_analyzed = files.length;
  report.bytes_analyzed = files.reduce((n, f) => n + f.bytes, 0);
  report.credential_findings = findings.length;
  report.orm_metadata = files
    .filter((f) => /(?:\.prisma|(?:^|\/)(?:drizzle|sequelize|knex|typeorm)\.config\.)/.test(f.path))
    .map((f) => f.path);
  report.roots = discoverRoots([...paths], new Set(files.map((f) => f.path)));
  const choice = chooseSql(report.roots, request.selection);
  report.selected_root = choice.root?.path ?? null;
  report.sql_order = choice.order;
  let schema_sql = '';
  let replay: AdmittedInputs['replay'];
  const sql_analysis = choice.root
    ? await analyzeSqlFiles(
        choice.order
          .filter((p) => files.some((f) => f.path === p))
          .map((p) => files.find((f) => f.path === p)!),
        initial.input_revision,
        true,
      )
    : undefined;
  if (sql_analysis && !choice.root?.complete) {
    sql_analysis.complete = false;
    sql_analysis.tables.forEach((t) => {
      t.rls_enabled = null;
    });
    sql_analysis.replay_ready = false;
    sql_analysis.replay_reason = 'IMPORT_MIGRATION_GAP';
  }
  if (!report.roots.length)
    report.rls = { status: 'missing_schema', reason_code: 'SCHEMA_MISSING' };
  else if (!choice.root)
    report.rls = { status: 'choice_required', reason_code: 'IMPORT_SQL_CHOICE_REQUIRED' };
  else if (!choice.root.complete)
    report.rls = { status: 'unsupported_sql', reason_code: 'IMPORT_MIGRATION_GAP' };
  else {
    try {
      schema_sql = await admitSql(
        choice.order.map((p) => files.find((f) => f.path === p)!.content).join('\n'),
      );
      report.rls = schema_sql.trim()
        ? { status: 'ready', reason_code: null }
        : { status: 'missing_schema', reason_code: 'SCHEMA_MISSING' };
    } catch {
      try {
        const selected = choice.order.map((p) => files.find((f) => f.path === p)!);
        await admitRepositorySql(selected.map((f) => f.content).join('\n'));
        replay = replayManifest(
          request.source.kind === 'github'
            ? { ...request.source, ref: source.provenance.commit ?? request.source.ref }
            : request.source,
          selected,
        );
        report.sql_profile = 'repository-v3';
        report.rls = { status: 'ready', reason_code: null };
      } catch (e) {
        report.rls = { status: 'unsupported_sql', reason_code: errorCode(e) };
      }
    }
  }
  report.status = 'complete';
  guard();
  return {
    inputs: validate('AdmittedInputs', {
      schema_sql,
      ...(replay ? { replay } : {}),
      ...(sql_analysis ? { sql_analysis } : {}),
      // Snippet extraction/markers can expose another syntactic assignment span.
      // Sanitize metadata again before its sink, never redact executable SQL.
      ...redactValue({
        expectation_edits: [],
        manifest: files.map((f) => ({
          path: f.path,
          kind: choice.order.includes(f.path) ? 'sql' : 'source',
          bytes: f.bytes,
        })),
        credential_findings: findings,
        credential_fingerprints: fingerprints,
        synthetic_demo: false,
      }),
    }),
    report: validate('ImportReport', redactValue(report)),
  };
}
