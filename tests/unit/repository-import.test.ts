import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validate, parseStrictJson, type ImportRequest } from '../../packages/contracts/src/index';
import { importRepository, emptyImportReport } from '../../packages/core/src/repository/import';
import {
  githubSnapshot,
  githubRepository,
  safeRef,
  githubTransport,
} from '../../packages/core/src/repository/github';
import { AppError } from '../../packages/core/src/errors';
import { discoverRoots, chooseSql } from '../../packages/core/src/repository/discovery';
import { Store } from '../../packages/store/src/index';
import { enqueueImport } from '../../packages/store/src/imports';
import { runNext } from '../../apps/worker/src/dispatch';

const source: ImportRequest = {
  source: { kind: 'github', url: 'https://github.com/example/project', ref: null },
  selection: null,
  retry_of: null,
};
const sql =
  'CREATE TABLE public.items(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), value text);';
const key = Buffer.alloc(32, 1);
const run = async (files: Record<string, string>, request = source) =>
  importRepository(request, emptyImportReport('p', 'j', request), key, undefined, {
    entries: Object.entries(files).map(([path, text]) => ({
      path,
      bytes: Buffer.byteLength(text),
    })),
    provenance: {
      kind: 'github',
      label: source.source.kind === 'github' ? source.source.url : '',
      commit: 'a'.repeat(40),
      workspace_digest: null,
    },
    read: async (entry) => Buffer.from(files[entry.path]!),
  });

describe('repository discovery and privacy', () => {
  it('preserves static credentials in SQL defaults while rejecting executable replay', async () => {
    const secret = "TEST_ONLY_DEFAULT_PASSWORD_WITH_QUOTE'SUFFIX";
    const result = await run({
      'schema.sql': `CREATE TABLE public.settings(id uuid PRIMARY KEY, database_password text DEFAULT '${secret.replaceAll("'", "''")}');`,
    });
    expect(result.report.rls.reason_code).toBe('SQL_CONTAINS_SECRET');
    expect(result.inputs.schema_sql).toBe('');
    expect(result.inputs.credential_findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('TEST_ONLY_DEFAULT_PASSWORD');
    expect(JSON.stringify(result)).not.toContain('SUFFIX');
  });
  it('redacts credential metadata to a stable sink projection before persistence', async () => {
    const secret = 'sb_secret_TEST_ONLY_STABLE_SINK';
    const imported = await run({ 'client.ts': `API_KEY = "${secret}";\nconst unrelated = 1;` });
    const store = new Store(':memory:');
    try {
      expect(() => store.setInputs('p', imported.inputs)).not.toThrow();
      expect(JSON.stringify(store.inputs('p'))).not.toContain(secret);
    } finally {
      store.close();
    }
  });
  it('orders nested Prisma/Flyway SQL roots and uses schema fallback only without migrations', () => {
    const paths = [
      'prisma/migrations/20260102_second/migration.sql',
      'prisma/migrations/20260101_first/migration.sql',
      'schema.sql',
    ];
    const roots = discoverRoots(paths, new Set(paths));
    expect(roots).toHaveLength(1);
    expect(roots[0]!.ordered).toBe(true);
    expect(roots[0]!.files).toEqual([paths[1], paths[0]]);
    expect(discoverRoots(['db/schema.sql'], new Set(['db/schema.sql']))[0]!.kind).toBe('schema');
    expect(
      discoverRoots(
        ['db/migrations/V2__b.sql', 'db/migrations/V1__a.sql'],
        new Set(['db/migrations/V2__b.sql', 'db/migrations/V1__a.sql']),
      )[0]!.ordered,
    ).toBe(true);
  });
  it('prioritizes Supabase numeric ordering and retains credential results when the complete chain is unsupported', async () => {
    const secret = 'sb_secret_TEST_ONLY_IMPORT_CANARY';
    const result = await run({
      'db/migrations/1_schema.sql': sql,
      'supabase/migrations/10_policy.sql': 'DO $$ BEGIN NULL; END $$;',
      'supabase/migrations/2_schema.sql': sql,
      'src/app.ts': `const GITHUB_TOKEN = "${secret}";`,
      'supabase/migrations/3_secret.sql': `SELECT '${secret}';`,
    });
    expect(result.report.sql_order).toEqual([
      'supabase/migrations/2_schema.sql',
      'supabase/migrations/3_secret.sql',
      'supabase/migrations/10_policy.sql',
    ]);
    expect(result.report.rls.status).toBe('unsupported_sql');
    expect(result.inputs.schema_sql).toBe('');
    expect(result.inputs.credential_findings.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('reports missing SQL and ORM metadata without inventing RLS results', async () => {
    const result = await run({
      'prisma/schema.prisma': 'model Item { id String @id }',
      'src/app.ts': 'const value = 1;',
    });
    expect(result.report.rls.status).toBe('missing_schema');
    expect(result.report.orm_metadata).toEqual(['prisma/schema.prisma']);
    expect(result.inputs.schema_sql).toBe('');
    const empty = await run({ 'schema.sql': '-- No committed table schema' });
    expect(empty.report.rls.status).toBe('missing_schema');
  });
  it('requires root/order choices and refuses partial chains with excluded migrations', async () => {
    const paths = [
      'apps/a/migrations/001.sql',
      'apps/a/migrations/second.sql',
      'apps/b/migrations/1_schema.sql',
    ];
    const roots = discoverRoots(paths, new Set(paths));
    expect(chooseSql(roots, null).root).toBeNull();
    expect(
      chooseSql(roots, { root: roots[0]!.path, sql_order: [paths[1]!, paths[0]!] }).order,
    ).toEqual([paths[1], paths[0]]);
    const result = await run({
      'supabase/migrations/1_schema.sql': sql,
      'supabase/migrations/2_large.sql': ' '.repeat(2097153),
    });
    expect(result.report.exclusions[0]!.reason).toBe('oversized');
    expect(result.report.rls.reason_code).toBe('IMPORT_MIGRATION_GAP');
    expect(result.inputs.sql_analysis?.tables[0]?.rls_enabled).toBeNull();
    expect(result.inputs.schema_sql).toBe('');
  });
  it('allows 500 eligible import files while preserving the 200-file upload contract', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`src/${i}.ts`, 'const n = 1;']),
    );
    expect((await run(files)).report.files_analyzed).toBe(500);
    await expect(run({ ...files, 'src/extra.ts': 'x' })).rejects.toThrow('IMPORT_LIMIT');
    expect(() =>
      validate('InputRequest', {
        files: Object.keys(files).map((path) => ({ path, kind: 'source', content: 'x' })),
        sql_order: [],
        expectations: null,
      }),
    ).toThrow('CONTRACT_INVALID');
    await expect(
      run(
        Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${i}.ts`, ' '.repeat(2097152)])),
      ),
    ).rejects.toThrow('IMPORT_LIMIT');
  });
  it('reads saved Git changes and non-ignored untracked files, excludes links/submodules/binaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'proofsec-import-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      await mkdir(join(dir, 'src'));
      await writeFile(join(dir, 'src/app.ts'), 'const n = 1;');
      execFileSync('git', ['-C', dir, 'add', '.']);
      await writeFile(join(dir, 'src/app.ts'), 'const n = 2;');
      await writeFile(join(dir, '.gitignore'), 'ignored.ts\n');
      await writeFile(join(dir, 'ignored.ts'), 'secret');
      await writeFile(join(dir, 'new.ts'), 'const n = 3;');
      await writeFile(join(dir, 'bad.ts'), Buffer.from([0xff, 0x00]));
      await symlink(join(dir, 'src/app.ts'), join(dir, 'link.ts'));
      execFileSync('git', [
        '-C',
        dir,
        'update-index',
        '--add',
        '--cacheinfo',
        '160000,' + 'a'.repeat(40) + ',sub',
      ]);
      const request: ImportRequest = {
        source: { kind: 'local', directory: dir },
        selection: null,
        retry_of: null,
      };
      const result = await importRepository(request, emptyImportReport('p', 'j', request), key);
      expect(result.inputs.manifest.map((f) => f.path)).toContain('new.ts');
      expect(result.inputs.manifest.map((f) => f.path)).not.toContain('ignored.ts');
      expect(result.report.exclusions.map((e) => e.reason)).toEqual(
        expect.arrayContaining(['symlink', 'submodule', 'unsupported_encoding']),
      );
      const before = result.report.provenance.workspace_digest;
      await writeFile(join(dir, 'src/app.ts'), 'const n = 4;');
      expect(
        (await importRepository(request, emptyImportReport('p', 'j', request), key)).report
          .provenance.workspace_digest,
      ).not.toBe(before);
      expect(JSON.stringify(result)).not.toContain('const n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('GitHub boundaries and queue', () => {
  it('uses private read transport after an auth failure and preserves rate limits/timeouts', async () => {
    let publicCalls = 0;
    let privateCalls = 0;
    const transport = githubTransport(
      async () => {
        publicCalls++;
        throw new AppError('IMPORT_GITHUB_AUTH_REQUIRED');
      },
      async () => {
        privateCalls++;
        return Buffer.from('ok');
      },
    );
    await transport('/repos/a/b', 10);
    await transport('/repos/a/b/git/trees/' + 'a'.repeat(40), 10);
    expect(publicCalls).toBe(1);
    expect(privateCalls).toBe(2);
    for (const code of ['IMPORT_GITHUB_RATE_LIMIT', 'IMPORT_TIMEOUT', 'IMPORT_RESPONSE_LIMIT'])
      await expect(
        githubTransport(
          async () => {
            throw new AppError(code);
          },
          async () => {
            throw new Error('must not fallback');
          },
        )('/repos/a/b', 10),
      ).rejects.toThrow(code);
  });
  it('rejects hostile URLs/refs and strict request unknown/duplicate keys', () => {
    for (const url of [
      'http://github.com/a/b',
      'https://github.com.evil/a/b',
      'https://x@github.com/a/b',
      'https://github.com/a/../b',
      'https://github.com/a/b?token=x',
      'https://github.com/a/b%2f..',
      'https://github.com/a/b/tree/main',
    ])
      expect(() => githubRepository(url)).toThrow('IMPORT_URL_INVALID');
    for (const ref of ['--help', 'a..b', '$(id)', 'refs//head'])
      expect(() => safeRef(ref)).toThrow('IMPORT_REF_INVALID');
    expect(() => validate('ImportRequest', { ...source, token: 'x' })).toThrow();
    expect(() => parseStrictJson('{"source":1,"source":2}')).toThrow();
  });
  it('pins the resolved commit/tree and verifies blob hashes without refetching moving refs', async () => {
    const content = Buffer.from('const n = 1;');
    const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    const seen: string[] = [];
    const transport = async (path: string) => {
      seen.push(path);
      return path.includes('/git/blobs/')
        ? content
        : Buffer.from(
            JSON.stringify(
              path.includes('/git/trees/')
                ? {
                    sha: 'b'.repeat(40),
                    url: 'https://api.github.com/tree',
                    truncated: false,
                    tree: [
                      {
                        path: 'src/app.ts',
                        type: 'blob',
                        mode: '100644',
                        sha,
                        size: content.length,
                        url: 'https://api.github.com/blob',
                      },
                    ],
                  }
                : path.includes('/commits/')
                  ? { sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } }
                  : { default_branch: 'main' },
            ),
          );
    };
    const snapshot = await githubSnapshot('https://github.com/a/b', null, transport);
    expect(snapshot.provenance.commit).toBe('a'.repeat(40));
    expect(await snapshot.read(snapshot.entries[0]!)).toEqual(content);
    expect(seen.at(-1)).toBe('/repos/a/b/git/blobs/' + sha);
    await expect(
      githubSnapshot('https://github.com/a/b', 'main', async (path) =>
        path.includes('/trees/')
          ? Buffer.from(
              JSON.stringify({ sha: 'b'.repeat(40), url: 'x', tree: [], truncated: true }),
            )
          : transport(path),
      ),
    ).rejects.toThrow('IMPORT_GITHUB_TREE_TRUNCATED');
  });
  it('deduplicates requests atomically, rejects key reuse, serializes with other jobs, and records interruption', async () => {
    const store = new Store(':memory:');
    try {
      const one = enqueueImport(store, source, 'one');
      const two = enqueueImport(store, source, 'two');
      expect(two.job.id).toBe(one.job.id);
      expect(store.list('Project')).toHaveLength(1);
      expect(() =>
        enqueueImport(
          store,
          { ...source, source: { kind: 'github', url: 'https://github.com/a/other', ref: null } },
          'one',
        ),
      ).toThrow('IMPORT_IDEMPOTENCY_CONFLICT');
      expect(store.claim()!.job.id).toBe(one.job.id);
      enqueueImport(
        store,
        { ...source, source: { kind: 'github', url: 'https://github.com/a/second', ref: null } },
        'three',
      );
      expect(store.claim()).toBeNull();
      store.recover();
      expect(store.get('ImportReport', one.job.id).status).toBe('interrupted');
      expect(store.job(one.job.id).error_code).toBe('WORKER_INTERRUPTED');
    } finally {
      store.close();
    }
  });
  it('persists only redacted credential work for an unsupported local SQL chain through the real queue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'proofsec-worker-import-'));
    const store = new Store(':memory:');
    try {
      execFileSync('git', ['init', '-q', dir]);
      await mkdir(join(dir, 'supabase/migrations'), { recursive: true });
      const secret = 'sb_secret_TEST_ONLY_SQL_IMPORT_CANARY';
      await writeFile(
        join(dir, 'supabase/migrations/1.sql'),
        `CREATE FUNCTION public.bad() RETURNS text AS $$ SELECT '${secret}' $$ LANGUAGE sql;`,
      );
      const queued = enqueueImport(
        store,
        { source: { kind: 'local', directory: dir }, selection: null, retry_of: null },
        'local',
        true,
      );
      expect(await runNext(store)).toBe(true);
      expect(store.job(queued.job.id).status).toBe('succeeded');
      expect(store.get('ImportReport', queued.job.id).rls.status).toBe('unsupported_sql');
      expect(store.list('Finding', queued.job.project_id).length).toBeGreaterThan(0);
      expect(JSON.stringify(store.db.prepare('SELECT * FROM records').all())).not.toContain(secret);
      expect(store.inputs(queued.job.project_id).schema_sql).toBe('');
      const next = enqueueImport(
        store,
        { source: { kind: 'local', directory: dir }, selection: null, retry_of: null },
        'fresh_scan',
        true,
      );
      expect(next.job.id).not.toBe(queued.job.id);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
