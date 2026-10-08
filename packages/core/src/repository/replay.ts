import type { AdmittedInputs, ImportRequest, ReplayManifest } from '../../../contracts/src/index';
import { hash } from '../hash';
import { AppError } from '../errors';
import { admitPath } from '../intake/admit';
import {
  admitRepositorySql,
  REPLAY_PROFILE,
  BOOTSTRAP_VERSION,
} from '../intake/repository-profile';
import { localSnapshot } from './local';
import { githubSnapshot } from './github';

export function replayManifest(
  source: ImportRequest['source'],
  files: { path: string; content: string }[],
): ReplayManifest {
  const data = {
    profile: REPLAY_PROFILE as 'repository-v3',
    bootstrap_version: BOOTSTRAP_VERSION as 'supabase-database-v1',
    source,
    files: files.map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.content),
      digest: hash(f.content),
    })),
  };
  return {
    ...data,
    digest: hash({
      profile: data.profile,
      bootstrap_version: data.bootstrap_version,
      files: data.files,
    }),
  };
}
export function inputSchemaDigest(inputs: AdmittedInputs): string | null {
  return inputs.replay?.digest ?? (inputs.schema_sql ? hash(inputs.schema_sql) : null);
}
/** Routines are reread and readmitted transiently, never saved in SQLite. */
export async function readReplay(inputs: AdmittedInputs, check = () => {}): Promise<string> {
  const manifest = inputs.replay;
  if (!manifest) return inputs.schema_sql;
  if (
    inputSchemaDigest(inputs) !==
    hash({
      profile: manifest.profile,
      bootstrap_version: manifest.bootstrap_version,
      files: manifest.files,
    })
  )
    throw new AppError('REPLAY_MANIFEST_INVALID');
  check();
  const snapshot =
    manifest.source.kind === 'local'
      ? await localSnapshot(manifest.source.directory)
      : await githubSnapshot(manifest.source.url, manifest.source.ref);
  const contents: string[] = [];
  for (const file of manifest.files) {
    check();
    admitPath(file.path);
    const entry = snapshot.entries.find((e) => e.path === file.path);
    if (!entry || entry.reason || entry.bytes !== file.bytes)
      throw new AppError('REPLAY_INPUT_CHANGED', 409);
    const buffer = await snapshot.read(entry);
    const content = new TextDecoder('utf8', { fatal: true }).decode(buffer);
    if (hash(content) !== file.digest) throw new AppError('REPLAY_INPUT_CHANGED', 409);
    contents.push(content);
  }
  check();
  return admitRepositorySql(contents.join('\n'));
}
