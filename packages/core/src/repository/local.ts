import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { AppError } from '../errors';
import { readCommand } from './process';
import type { RepositorySnapshot, RepositoryEntry } from './types';
import { exclusion } from './discovery';

export async function localSnapshot(directory: string): Promise<RepositorySnapshot> {
  const root = await realpath(resolve(directory));
  const git = async (args: string[]) =>
    readCommand('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root,
      env: {
        NODE_ENV: 'production',
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    });
  let listing: Buffer;
  try {
    listing = await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  } catch {
    throw new AppError('IMPORT_LOCAL_GIT_REQUIRED');
  }
  const stage = (await git(['ls-files', '--stage', '-z'])).toString('utf8').split('\0');
  const modes = new Map(
    stage.filter(Boolean).map((line) => [line.slice(line.indexOf('\t') + 1), line.slice(0, 6)]),
  );
  const paths = [
    ...new Set(
      new TextDecoder('utf-8', { fatal: true }).decode(listing).split('\0').filter(Boolean),
    ),
  ];
  if (paths.length > 20000) throw new AppError('IMPORT_TREE_LIMIT');
  const entries: RepositoryEntry[] = [];
  for (const path of paths) {
    if (exclusion(path) === 'unsafe_path') {
      entries.push({ path, bytes: 0, reason: 'unsafe_path' });
      continue;
    }
    const mode = modes.get(path);
    if (mode === '160000' || mode === '120000') {
      entries.push({ path, bytes: 0, reason: mode === '160000' ? 'submodule' : 'symlink' });
      continue;
    }
    // No link (including an ancestor) may lead outside the saved workspace.
    const parts = path.split('/');
    let reason: RepositoryEntry['reason'];
    let size = 0;
    try {
      for (let i = 1; i <= parts.length; i++)
        if ((await lstat(resolve(root, ...parts.slice(0, i)))).isSymbolicLink()) {
          reason = 'symlink';
          break;
        }
      if (!reason) {
        const stat = await lstat(resolve(root, path));
        if (!stat.isFile()) reason = 'unsupported_file';
        size = stat.size;
      }
    } catch {
      reason = 'missing';
    }
    entries.push({ path, bytes: size, ...(reason ? { reason } : {}) });
  }
  let commit: string | null = null;
  try {
    const value = (await git(['rev-parse', '--verify', 'HEAD'])).toString().trim();
    if (/^[a-f0-9]{40}$/.test(value)) commit = value;
  } catch {
    /* unborn workspace */
  }
  return {
    entries,
    provenance: {
      kind: 'local',
      label: 'Saved local Git workspace',
      commit,
      workspace_digest: null,
    },
    read: async (entry) => {
      const target = resolve(root, entry.path);
      const actual = await realpath(target);
      const rel = relative(root, actual);
      if (actual !== target || rel === '..' || rel.startsWith('..' + sep))
        throw new AppError('IMPORT_WORKSPACE_CHANGED');
      const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== entry.bytes)
          throw new AppError('IMPORT_WORKSPACE_CHANGED');
        const buffer = Buffer.alloc(entry.bytes + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== entry.bytes) throw new AppError('IMPORT_WORKSPACE_CHANGED');
        return buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    },
  };
}
