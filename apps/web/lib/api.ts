import { validate, type ContractMap } from '../../../packages/contracts/src/index';
import { AppError, logEvent } from '../../../packages/core/src/errors';
import { newId } from '../../../packages/core/src/hash';
import { redactValue } from '../../../packages/core/src/secrets/sink';
import { exportMarkdown, exportMigration } from '../../../packages/core/src/remediation/export';
import { checkHost, checkMutation, session, readJson, idempotency } from './security';
import { enqueueRepositoryRescan } from '../../../packages/store/src/repository-rescan';
import { enqueueImport, retryImport } from '../../../packages/store/src/imports';
import {
  store,
  createProject,
  view,
  upload,
  verifyProject,
  investigateFinding,
  investigateProject,
  proposePatch,
  approve,
  editExpectations,
  rescanCredentials,
} from './service';

function json<K extends keyof ContractMap>(name: K, value: ContractMap[K], status = 200): Response {
  return Response.json(validate(name, redactValue(value)), {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
export async function handle(request: Request, path: string[]): Promise<Response> {
  const request_id = newId('request');
  try {
    checkHost(request);
    if (path.length > 5 || path.some((p) => !/^[-_A-Za-z0-9]+$/.test(p)))
      throw new AppError('NOT_FOUND', 404);
    const method = request.method;
    if (method === 'GET' && path[0] === 'session') {
      const s = session(request, store, true);
      const response = json('SessionResponse', { csrf_token: s.csrf });
      if (s.fresh)
        response.headers.set(
          'Set-Cookie',
          `proofsec_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        );
      return response;
    }
    session(request, store);
    if (method !== 'GET') checkMutation(request, store);
    const [resource, id, action] = path;
    if (resource === 'imports') {
      if (!id && method === 'POST')
        return json(
          'ImportStatus',
          enqueueImport(store, await readJson(request, 65536), idempotency(request)),
          202,
        );
      if (id && method === 'GET')
        return json('ImportStatus', { job: store.job(id), report: store.get('ImportReport', id) });
      if (id && method === 'POST' && action === 'choose')
        return json(
          'ImportStatus',
          retryImport(
            store,
            id,
            validate('ImportSelection', await readJson(request, 65536)),
            idempotency(request),
          ),
          202,
        );
      if (id && method === 'POST' && action === 'retry') {
        validate('EmptyRequest', await readJson(request, 16384));
        return json('ImportStatus', retryImport(store, id, null, idempotency(request)), 202);
      }
    }
    if (resource === 'projects') {
      if (!id) {
        if (method === 'GET') return json('ProjectsResponse', { projects: store.list('Project') });
        if (method === 'POST') return json('Project', createProject(await readJson(request)), 201);
      } else if (!action) {
        if (method === 'GET') return json('ProjectView', view(id));
        if (method === 'DELETE') {
          if (request.body) validate('EmptyRequest', await readJson(request));
          store.deleteProject(id);
          return json('DeleteResponse', { deleted: true });
        }
      } else if (action === 'inputs' && method === 'POST')
        return json(
          'JobEnvelope',
          await upload(id, await readJson(request), idempotency(request)),
          202,
        );
      else if (action === 'investigate' && method === 'POST')
        return json(
          'JobEnvelope',
          investigateProject(id, await readJson(request), idempotency(request)),
          202,
        );
      else if (action === 'rescan-repository' && method === 'POST')
        return json(
          'JobEnvelope',
          enqueueRepositoryRescan(store, id, await readJson(request), idempotency(request)),
          202,
        );
      else if (action === 'verify' && method === 'POST')
        return json(
          'JobEnvelope',
          verifyProject(id, await readJson(request), idempotency(request)),
          202,
        );
      else if (action === 'expectations' && method === 'PUT')
        return json('ProjectView', await editExpectations(id, await readJson(request)));
      else if (action === 'rescan-credentials' && method === 'POST')
        return json(
          'JobEnvelope',
          await rescanCredentials(id, await readJson(request), idempotency(request)),
          202,
        );
      else if (action === 'findings' && method === 'GET')
        return json('FindingsResponse', { findings: view(id).findings });
    }
    if (resource === 'findings' && id) {
      const finding = store.get('Finding', id);
      if (!action && method === 'GET')
        return json('FindingView', {
          finding,
          patches: store
            .list('MigrationPatch', finding.project_id)
            .filter((p) => p.finding_id === id),
          runs: store.list('Run', finding.project_id),
        });
      if (action === 'investigate' && method === 'POST')
        return json(
          'JobEnvelope',
          investigateFinding(id, await readJson(request), idempotency(request)),
          202,
        );
      if (action === 'patches' && method === 'POST')
        return json('MigrationPatch', proposePatch(id, await readJson(request)), 201);
      if (action === 'export' && method === 'GET') {
        const patches = store
          .list('MigrationPatch', finding.project_id)
          .filter((p) => p.finding_id === id);
        if (new URL(request.url).searchParams.get('format') === 'sql') {
          const patch = patches.find((p) => p.id === finding.remediation.patch_id);
          if (!patch) throw new AppError('PATCH_MISSING', 404);
          const safe = exportMigration(patch);
          return new Response(safe, {
            headers: {
              'Content-Type': 'application/sql',
              'Content-Disposition': 'attachment; filename="migration.sql"',
              'Cache-Control': 'no-store',
            },
          });
        }
        const report = validate('ExportReport', {
          schema_version: '1.0',
          finding,
          patches,
          runs: store.list('Run', finding.project_id).map((run) => ({
            run,
            results: store
              .list('TestResult', finding.project_id)
              .filter((r) => r.run_id === run.id),
          })),
        });
        if (new URL(request.url).searchParams.get('format') === 'md')
          return new Response(exportMarkdown(report), {
            headers: {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Disposition': 'attachment; filename="report.md"',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        const response = json('ExportReport', report);
        response.headers.set('Content-Disposition', 'attachment; filename="report.json"');
        return response;
      }
    }
    if (resource === 'patches' && id && action === 'approve' && method === 'POST')
      return json('JobEnvelope', approve(id, await readJson(request), idempotency(request)), 202);
    if (resource === 'runs' && id && method === 'GET') {
      const run = store.get('Run', id);
      return json('RunResponse', {
        run,
        results: store.list('TestResult', run.project_id).filter((r) => r.run_id === id),
      });
    }
    if (resource === 'jobs' && id) {
      const job = store.job(id);
      if (method === 'GET') return json('Job', job);
      if (method === 'POST' && action === 'cancel') {
        validate('EmptyRequest', await readJson(request, 16384));
        return json('JobEnvelope', { job: store.cancelJob(job.id) });
      }
    }
    throw new AppError('NOT_FOUND', 404);
  } catch (e) {
    const code =
      e instanceof AppError
        ? e.code
        : e instanceof Error && ['CONTRACT_INVALID', 'EXPECTATION_INVALID'].includes(e.message)
          ? 'INPUT_INVALID'
          : 'INTERNAL_ERROR';
    logEvent('api', code, { request_id });
    return json(
      'ApiError',
      {
        error: {
          code,
          message:
            code.replaceAll('_', ' ').toLowerCase() +
            '. See docs/security-and-safety.md#stable-error-codes.',
          retryable: ['REPLICA_UNAVAILABLE', 'AI_UNAVAILABLE', 'PROJECT_BUSY'].includes(code),
        },
        request_id,
      },
      e instanceof AppError ? e.status : code === 'INPUT_INVALID' ? 400 : 500,
    );
  }
}
