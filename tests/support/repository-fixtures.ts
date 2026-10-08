import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryFixtures = [
  'unsupported-chain',
  'credential-only',
  'ambiguous-roots',
  'missing-schema',
  'discovery-gaps',
] as const;
export type RepositoryFixture = (typeof repositoryFixtures)[number];
export const repositorySentinel = 'sb_secret_TEST_ONLY_REPOSITORY_FIXTURE';

/** Trusted fixture recipes only; never install or execute the materialized repository. */
export async function materializeRepository(id: RepositoryFixture) {
  const directory = await mkdtemp(join(tmpdir(), 'proofsec-synthetic-repository-'));
  const templates = fileURLToPath(new URL(`../fixtures/repositories/${id}/`, import.meta.url));
  const copy = async (source: string, target: string): Promise<void> => {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name.replace(/\.template$/, ''));
      if (entry.isDirectory()) await copy(from, to);
      else {
        await mkdir(dirname(to), { recursive: true });
        await writeFile(to, await readFile(from));
      }
    }
  };
  try {
    await copy(templates, directory);
    if (id === 'discovery-gaps') {
      // Generate oversized padding from a committed recipe instead of storing it.
      await writeFile(join(directory, 'supabase/migrations/2_large.sql'), ' '.repeat(2097153));
      await symlink('1_schema.sql', join(directory, 'supabase/migrations/3_link.sql'));
    }
    const git = (args: string[]) =>
      execFileSync(
        'git',
        ['-C', directory, '-c', `core.hooksPath=${join(directory, '.no-hooks')}`, ...args],
        {
          encoding: 'utf8',
        },
      );
    git(['init', '-q']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Synthetic Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--no-gpg-sign',
      '-qm',
      'Synthetic repository fixture',
    ]);
    return { directory, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
