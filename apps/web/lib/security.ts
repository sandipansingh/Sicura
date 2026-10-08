import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from '../../../packages/store/src/index';
import { AppError } from '../../../packages/core/src/errors';
import { parseStrictJson } from '../../../packages/contracts/src/index';

export const origin = process.env.PROOFSEC_ORIGIN ?? 'http://127.0.0.1:3000';
const configured = new URL(origin);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname) ||
  configured.protocol !== 'http:'
)
  throw new AppError('API_ORIGIN_INVALID');
export function checkHost(request: Request): void {
  if (request.headers.get('host') !== configured.host) throw new AppError('HOST_REJECTED', 403);
  const supplied = request.headers.get('origin');
  if (supplied && supplied !== origin) throw new AppError('ORIGIN_REJECTED', 403);
}
const equal = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function session(
  request: Request,
  store: Store,
  create = false,
): { token: string; csrf: string; fresh: boolean } {
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL)',
  );
  const token = /proofsec_session=([a-f0-9]{64})(?:;|$)/.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
  const record = token
    ? (store.db.prepare('SELECT csrf,expires_at FROM sessions WHERE token=?').get(token) as
        | { csrf: string; expires_at: number }
        | undefined)
    : undefined;
  if (token && record && record.expires_at > Date.now())
    return { token, csrf: record.csrf, fresh: false };
  if (!create) throw new AppError('SESSION_REQUIRED', 403);
  const next = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  store.db
    .prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run(next, csrf, Date.now() + 24 * 3600_000);
  return { token: next, csrf, fresh: true };
}
export function checkMutation(request: Request, store: Store): void {
  if (request.headers.get('origin') !== origin) throw new AppError('ORIGIN_REJECTED', 403);
  if (!equal(request.headers.get('x-csrf-token') ?? '', session(request, store).csrf))
    throw new AppError('CSRF_REJECTED', 403);
}
export function idempotency(request: Request): string {
  const key = request.headers.get('idempotency-key') ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new AppError('IDEMPOTENCY_REQUIRED', 400);
  return key;
}
export async function readJson(request: Request, max = 14 * 1024 * 1024): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError('CONTENT_TYPE_INVALID', 400);
  if (!request.body) throw new AppError('INPUT_INVALID', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      throw new AppError('INPUT_LIMIT', 413);
    }
    chunks.push(value);
  }
  try {
    return parseStrictJson(Buffer.concat(chunks).toString('utf8'), max);
  } catch {
    throw new AppError('INPUT_INVALID', 400);
  }
}
