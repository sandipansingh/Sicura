import type { AdmittedInputs, InputRequest } from '../../../contracts/src/index';
import { validate } from '../../../contracts/src/index';
import { admitPath, admitSql } from './admit';
import { AppError } from '../errors';
import { credentialFindings } from '../secrets/findings';

export function checkInputLimits(data: unknown): void {
  if (!data || typeof data !== 'object' || !('files' in data) || !Array.isArray(data.files)) return;
  if (data.files.length > 200) throw new AppError('INPUT_LIMIT', 413);
  let total = 0;
  for (const f of data.files)
    if (f && typeof f === 'object' && 'content' in f && typeof f.content === 'string') {
      const bytes = Buffer.byteLength(f.content);
      total += bytes;
      if (bytes > 2097152 || total > 10485760) throw new AppError('INPUT_LIMIT', 413);
    }
}

/** Raw contents exist only in the request; returned records never retain source. */
export async function admitInputs(
  input: InputRequest,
  project_id: string,
  revision: number,
  projectKey?: Buffer,
): Promise<AdmittedInputs> {
  checkInputLimits(input);
  validate('InputRequest', input);
  const seen = new Set<string>();
  let total = 0;
  for (const f of input.files) {
    admitPath(f.path);
    if (seen.has(f.path)) throw new AppError('INPUT_DUPLICATE');
    seen.add(f.path);
    const bytes = Buffer.byteLength(f.content);
    total += bytes;
    if (bytes > 2 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new AppError('INPUT_LIMIT', 413);
    if (f.content.includes('\0') || f.content.includes('\uFFFD'))
      throw new AppError('INPUT_ENCODING_UNSUPPORTED');
  }
  const sqlFiles = input.files.filter((f) => f.kind === 'sql');
  if (
    new Set(input.sql_order).size !== input.sql_order.length ||
    input.sql_order.length !== sqlFiles.length ||
    input.sql_order.some((p) => !sqlFiles.some((f) => f.path === p))
  )
    throw new AppError('INPUT_ORDER_INVALID');
  // One parser/allowlist checks the complete ordered schema atomically.
  const joined = input.sql_order.map((p) => sqlFiles.find((f) => f.path === p)!.content).join('\n');
  const schema_sql = joined ? await admitSql(joined) : '';
  const credential_fingerprints: AdmittedInputs['credential_fingerprints'] = [];
  const credential_findings = input.files
    .filter((f) => f.kind === 'source')
    .flatMap((f) =>
      credentialFindings(
        f.path,
        f.content,
        project_id,
        revision,
        projectKey
          ? {
              key: projectKey,
              capture: (finding_id, fingerprint) =>
                credential_fingerprints.push({ finding_id, fingerprint }),
            }
          : undefined,
      ),
    );
  return validate('AdmittedInputs', {
    schema_sql,
    expectation_edits: input.expectations?.expectations ?? [],
    manifest: input.files.map((f) => ({
      path: f.path,
      kind: f.kind,
      bytes: Buffer.byteLength(f.content),
    })),
    credential_findings,
    credential_fingerprints,
    synthetic_demo: false,
  });
}
