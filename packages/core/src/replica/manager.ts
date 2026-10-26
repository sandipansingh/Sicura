import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import lock from '../../../../config/runtime-lock.json';
import { AppError } from '../errors';
import { newId } from '../hash';
import { BOOTSTRAP, SUPABASE_BOOTSTRAP } from './bootstrap';
import { openReplicaTransport } from './transport';
import { resolve } from 'node:path';
import { hash } from '../hash';
import { parseSql } from '../intake/admit';
import { deparse } from 'pgsql-parser';
import { quoteIdentifier } from '../rls/introspect';

const execute = promisify(execFile);
const LABEL = 'io.proofsec.owned=1';
const SCOPE =
  'io.proofsec.scope=' + hash(resolve(process.env.PROOFSEC_DATA_DIR ?? '.local')).slice(0, 24);
async function docker(args: string[], timeout = 30_000): Promise<string> {
  try {
    return (await execute('docker', args, { timeout, maxBuffer: 65536 })).stdout.trim();
  } catch {
    throw new AppError('REPLICA_UNAVAILABLE', 503);
  }
}
export interface Replica {
  id: string;
  setup: pg.Client;
  connectVerifier(): Promise<pg.Client>;
  apply(sql: string): Promise<void>;
  profile: 'repository-v2' | 'repository-v3';
  baseline_digest?: string;
  assertNoEgress(): Promise<void>;
}
let active = false;
export async function withReplica<T>(
  callback: (replica: Replica) => Promise<T>,
  profile: 'repository-v2' | 'repository-v3' = 'repository-v2',
): Promise<T> {
  if (active) throw new AppError('REPLICA_BUSY', 409);
  active = true;
  const id = newId('proofsec');
  const network = id + '_net';
  const password = randomBytes(24).toString('hex');
  const verifierPassword = randomBytes(24).toString('hex');
  const started = Date.now();
  let setup: pg.Client | undefined;
  let loader: pg.Client | undefined;
  let transport: Awaited<ReturnType<typeof openReplicaTransport>> | undefined;
  try {
    await docker(['network', 'create', '--internal', '--label', LABEL, '--label', SCOPE, network]);
    await docker([
      'run',
      '--detach',
      '--name',
      id,
      '--label',
      LABEL,
      '--label',
      SCOPE,
      '--label',
      `io.proofsec.created=${Date.now()}`,
      '--network',
      network,
      '--publish',
      '127.0.0.1::5432',
      '--user',
      '999:999',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--cpus',
      '2',
      '--memory',
      '1g',
      '--memory-swap',
      '1g',
      '--pids-limit',
      '128',
      '--log-driver',
      'none',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m,uid=999,gid=999,mode=700',
      '--tmpfs',
      '/var/run/postgresql:rw,noexec,nosuid,size=16m,uid=999,gid=999,mode=775',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--env',
      'POSTGRES_INITDB_ARGS=--no-locale',
      lock.postgres_image,
      '-c',
      'log_statement=none',
      '-c',
      'log_min_error_statement=panic',
      '-c',
      'log_min_messages=panic',
      '-c',
      'lc_messages=C',
      '-c',
      'statement_timeout=5000',
      '-c',
      'lock_timeout=1000',
    ]);
    transport = await openReplicaTransport(id);
    const connection = {
      host: '127.0.0.1',
      port: transport.port,
      database: 'postgres',
      connectionTimeoutMillis: 3000,
    };
    for (let attempt = 0; attempt < 60; attempt++) {
      const candidate = new pg.Client({ ...connection, user: 'postgres', password });
      // Idle transport errors are events; failed queries still reject. Never log raw errors.
      candidate.on('error', () => {});
      try {
        await candidate.connect();
        setup = candidate;
        break;
      } catch {
        await candidate.end().catch(() => {});
        await delay(250);
      }
    }
    if (!setup) throw new AppError('REPLICA_NOT_READY', 503);
    await setup.query(BOOTSTRAP);
    if (profile === 'repository-v3') await setup.query(SUPABASE_BOOTSTRAP);
    // SET ROLE password grammar cannot use a driver parameter: use trusted set_config + fixed DO.
    await setup.query("SELECT set_config('proofsec.verifier_password',$1,false)", [
      verifierPassword,
    ]);
    await setup.query(
      "DO $$ BEGIN EXECUTE format('ALTER ROLE verifier_login PASSWORD %L', current_setting('proofsec.verifier_password')); END $$;",
    );
    if (profile === 'repository-v3') {
      await setup.query("SELECT set_config('proofsec.loader_password',$1,false)", [
        randomBytes(24).toString('hex'),
      ]);
      await setup.query(
        "DO $$ BEGIN EXECUTE format('ALTER ROLE schema_loader_login PASSWORD %L',current_setting('proofsec.loader_password')); END $$;",
      );
      const passwordResult = await setup.query<{ password: string }>(
        "SELECT current_setting('proofsec.loader_password') AS password",
      );
      loader = new pg.Client({
        ...connection,
        user: 'schema_loader_login',
        password: passwordResult.rows[0]!.password,
      });
      loader.on('error', () => {});
      await loader.connect();
      await loader.query('SET ROLE schema_loader; SET search_path=public,extensions');
    }
    const client = setup;
    const replica: Replica = {
      id,
      setup: client,
      profile,
      connectVerifier: async () => {
        const p = new pg.Client({
          ...connection,
          user: 'verifier_login',
          password: verifierPassword,
        });
        p.on('error', () => {});
        await p.connect();
        return p;
      },
      apply: async (sql) => {
        if (loader) {
          // Separate restricted login: even an input COMMIT cannot restore the administrator.
          const { ast } = await parseSql(sql);
          for (const stmt of ast.stmts as { stmt: Record<string, unknown> }[]) {
            if (Date.now() - started > 300_000) throw new AppError('JOB_DEADLINE');
            const identity = await loader.query<{ current_user: string }>('SELECT current_user');
            if (identity.rows[0]?.current_user !== 'schema_loader')
              throw new AppError('IDENTITY_ASSERTION_FAILED');
            try {
              await loader.query(
                await deparse({ version: Number(ast.version), stmts: [stmt] } as Parameters<
                  typeof deparse
                >[0]),
              );
            } catch (e) {
              const sqlstate =
                e &&
                typeof e === 'object' &&
                'code' in e &&
                typeof e.code === 'string' &&
                /^[A-Z0-9]{5}$/.test(e.code)
                  ? e.code
                  : 'unknown';
              throw new AppError('SCHEMA_APPLY_FAILED', 422, {
                sqlstate,
                statement: (ast.stmts as unknown[]).indexOf(stmt) + 1,
              });
            }
          }
          const schemas = await client.query<{ schema: string }>(
            "SELECT nspname AS schema FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='schema_loader') AND nspname NOT IN ('auth','storage') ORDER BY nspname",
          );
          for (const { schema } of schemas.rows) {
            const identifier = quoteIdentifier(schema);
            await client.query(
              `GRANT USAGE ON SCHEMA ${identifier} TO harness_seed; GRANT ALL ON ALL TABLES IN SCHEMA ${identifier} TO harness_seed; GRANT ALL ON ALL SEQUENCES IN SCHEMA ${identifier} TO harness_seed; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${identifier} TO harness_seed`,
            );
          }
          replica.baseline_digest ??= hash(sql);
          return;
        }
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE schema_loader');
          await client.query(sql);
          await client.query('COMMIT');
        } catch {
          await client.query('ROLLBACK');
          throw new AppError('SCHEMA_APPLY_FAILED');
        }
      },
      assertNoEgress: async () => {
        const internal = await docker(['network', 'inspect', network, '--format', '{{.Internal}}']);
        if (internal !== 'true') throw new AppError('REPLICA_EGRESS_CHECK_FAILED');
        // A fixed app-owned remote TCP probe; no uploaded address or shell text is used.
        const check = await docker([
          'exec',
          id,
          'bash',
          '-c',
          'if timeout 2 bash -c "echo > /dev/tcp/1.1.1.1/443" 2>/dev/null; then exit 1; else echo blocked; fi',
        ]);
        if (check !== 'blocked') throw new AppError('REPLICA_EGRESS_CHECK_FAILED');
      },
    };
    await replica.assertNoEgress();
    return await callback(replica);
  } finally {
    await loader?.end().catch(() => {});
    await setup?.end().catch(() => {});
    await transport?.close();
    const cleanup = await Promise.allSettled([docker(['rm', '--force', id])]);
    await docker(['network', 'rm', network]).catch(() => {});
    active = false;
    if (cleanup.some((r) => r.status === 'rejected')) {
      /* Startup TTL reconciliation retries owned resources. */
    }
  }
}
export async function reconcileReplicas(all = false): Promise<void> {
  const ids = (
    await docker([
      'ps',
      '--all',
      '--filter',
      `label=${LABEL}`,
      '--filter',
      `label=${SCOPE}`,
      '--format',
      '{{.Names}}',
    ])
  )
    .split('\n')
    .filter(Boolean);
  for (const id of ids) {
    if (!/^proofsec_[a-f0-9]{32}$/.test(id)) continue;
    const created = Number(
      await docker(['inspect', id, '--format', '{{index .Config.Labels "io.proofsec.created"}}']),
    );
    if (all || Date.now() - created > 600_000) {
      await docker(['rm', '--force', id]);
      await docker(['network', 'rm', id + '_net']).catch(() => {});
    }
  }
}
