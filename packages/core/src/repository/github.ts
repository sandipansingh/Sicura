import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { validate, parseStrictJson } from '../../../contracts/src/index';
import { AppError } from '../errors';
import { redactText } from '../secrets/redact';
import { readCommand } from './process';
import type { RepositorySnapshot } from './types';

export function githubRepository(url: string): { owner: string; repo: string; url: string } {
  // Match the original input: URL normalization must not conceal traversal/credentials.
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})(?:\/)?$/.exec(
      url,
    );
  if (!match || ['.', '..'].includes(match[2]!) || redactText(url) !== url)
    throw new AppError('IMPORT_URL_INVALID', 400);
  const repo = match[2]!.replace(/\.git$/, '');
  if (!repo || ['.', '..'].includes(repo)) throw new AppError('IMPORT_URL_INVALID', 400);
  return { owner: match[1]!, repo, url: `https://github.com/${match[1]!}/${repo}` };
}
export function safeRef(ref: string): string {
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(ref) ||
    ref.includes('..') ||
    ref.includes('//') ||
    redactText(ref) !== ref
  )
    throw new AppError('IMPORT_REF_INVALID', 400);
  return ref;
}
export type GithubTransport = (
  path: string,
  limit: number,
  raw?: boolean,
  publicPath?: string,
) => Promise<Buffer>;
function publicGet(path: string, limit: number, raw = false, publicPath?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: publicPath ? 'raw.githubusercontent.com' : 'api.github.com',
        port: 443,
        path: publicPath ?? path,
        method: 'GET',
        headers: {
          'User-Agent': 'ProofSec/0.1',
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          const code =
            response.statusCode === 429 ||
            (response.statusCode === 403 && response.headers['x-ratelimit-remaining'] === '0')
              ? 'IMPORT_GITHUB_RATE_LIMIT'
              : [401, 403, 404].includes(response.statusCode ?? 0)
                ? 'IMPORT_GITHUB_AUTH_REQUIRED'
                : 'IMPORT_TRANSPORT_FAILED';
          reject(new AppError(code));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            request.destroy();
            reject(new AppError('IMPORT_RESPONSE_LIMIT'));
          } else chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', () => reject(new AppError('IMPORT_TRANSPORT_FAILED')));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      reject(new AppError('IMPORT_TIMEOUT'));
    }, 15000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new AppError('IMPORT_TRANSPORT_FAILED')));
    request.end();
  });
}
async function privateGet(path: string, limit: number, raw = false): Promise<Buffer> {
  try {
    return await readCommand(
      'gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '-H',
        `Accept: ${raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}`,
        '-H',
        'X-GitHub-Api-Version: 2022-11-28',
        path,
      ],
      {
        maxBuffer: limit,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SYSTEMROOT: process.env.SYSTEMROOT,
          APPDATA: process.env.APPDATA,
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          GH_PROMPT_DISABLED: '1',
        },
      },
    );
  } catch (e) {
    if (
      e instanceof AppError &&
      ['IMPORT_TIMEOUT', 'IMPORT_RESPONSE_LIMIT', 'IMPORT_GITHUB_RATE_LIMIT'].includes(e.code)
    )
      throw e;
    throw new AppError('IMPORT_GITHUB_AUTH_REQUIRED');
  }
}
export function githubTransport(
  publicTransport: GithubTransport = publicGet,
  authenticatedTransport: GithubTransport = privateGet,
): GithubTransport {
  let authenticated = false;
  let privateRepository = false;
  return async (path, limit, raw, publicPath) => {
    if (authenticated && !(raw && publicPath && !privateRepository))
      return authenticatedTransport(path, limit, raw);
    try {
      return await publicTransport(path, limit, raw, publicPath);
    } catch (e) {
      if (
        !(e instanceof AppError) ||
        !['IMPORT_GITHUB_AUTH_REQUIRED', 'IMPORT_GITHUB_RATE_LIMIT'].includes(e.code)
      )
        throw e;
      if (e.code === 'IMPORT_GITHUB_AUTH_REQUIRED') privateRepository = true;
      try {
        const result = await authenticatedTransport(path, limit, raw);
        authenticated = true;
        return result;
      } catch (privateError) {
        if (e.code === 'IMPORT_GITHUB_RATE_LIMIT') throw e;
        throw privateError;
      }
    }
  };
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
  return v as Record<string, unknown>;
};
export async function githubSnapshot(
  url: string,
  ref: string | null,
  transport = githubTransport(),
): Promise<RepositorySnapshot> {
  const repo = githubRepository(url);
  const prefix = `/repos/${repo.owner}/${repo.repo}`;
  let resolved = ref;
  if (!resolved) {
    // GitHub repository/commit envelopes contain unrelated fields. Project only the
    // required documented metadata; trees themselves use a strict wire contract.
    const data = object(
      parseStrictJson((await transport(prefix, 1024 * 1024)).toString(), 1024 * 1024),
    );
    if (typeof data.default_branch !== 'string')
      throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
    resolved = data.default_branch;
  }
  safeRef(resolved);
  const commitData = object(
    parseStrictJson(
      (
        await transport(`${prefix}/commits/${encodeURIComponent(resolved)}`, 2 * 1024 * 1024)
      ).toString(),
      2 * 1024 * 1024,
    ),
  );
  const commit = commitData.sha;
  const treeSha = object(object(commitData.commit).tree).sha;
  if (
    typeof commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof treeSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(treeSha)
  )
    throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
  const tree = validate(
    'GithubTree',
    parseStrictJson(
      (await transport(`${prefix}/git/trees/${treeSha}?recursive=1`, 8 * 1024 * 1024)).toString(),
      8 * 1024 * 1024,
    ),
  );
  if (tree.truncated) throw new AppError('IMPORT_GITHUB_TREE_TRUNCATED');
  if (tree.sha !== treeSha || tree.tree.length > 20000) throw new AppError('IMPORT_TREE_LIMIT');
  const paths = new Set<string>();
  const entries = tree.tree
    .filter((e) => e.type !== 'tree')
    .map((e) => {
      if (paths.has(e.path)) throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
      paths.add(e.path);
      if (e.mode === '160000') return { path: e.path, bytes: 0, reason: 'submodule' as const };
      if (e.mode === '120000')
        return { path: e.path, bytes: e.size ?? 0, reason: 'symlink' as const };
      if (e.type !== 'blob' || e.size === undefined)
        throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
      return { path: e.path, bytes: e.size, sha: e.sha };
    });
  return {
    entries,
    provenance: { kind: 'github', label: repo.url, commit, workspace_digest: null },
    read: async (entry) => {
      const buffer = await transport(
        `${prefix}/git/blobs/${entry.sha!}`,
        2 * 1024 * 1024,
        true,
        `/${repo.owner}/${repo.repo}/${commit}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      );
      const digest = createHash('sha1')
        .update(`blob ${buffer.length}\0`)
        .update(buffer)
        .digest('hex');
      if (buffer.length !== entry.bytes || digest !== entry.sha)
        throw new AppError('IMPORT_GITHUB_RESPONSE_INVALID');
      return buffer;
    },
  };
}
