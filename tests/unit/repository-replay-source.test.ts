import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { importRepository, emptyImportReport } from '../../packages/core/src/repository/import';
import { readReplay } from '../../packages/core/src/repository/replay';

it('stores only replay identities, rereads matching saved SQL and rejects changed bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sicura-replay-'));
  try {
    execFileSync('git', ['init', '-q', directory]);
    const sql =
      "CREATE TABLE public.notes(id uuid PRIMARY KEY, n integer DEFAULT 0); CREATE FUNCTION public.example() RETURNS text LANGUAGE sql AS $$ SELECT 'transient_body_marker' $$;";
    await writeFile(join(directory, 'schema.sql'), sql);
    const request = {
      source: { kind: 'local' as const, directory },
      selection: null,
      retry_of: null,
    };
    const { inputs, report } = await importRepository(
      request,
      emptyImportReport('project_test', 'job_test', request),
      Buffer.alloc(32, 1),
    );
    expect(report.rls.status).toBe('ready');
    expect(inputs.schema_sql).toBe('');
    expect(inputs.replay?.profile).toBe('repository-v3');
    expect(JSON.stringify(inputs)).not.toContain('transient_body_marker');
    expect(await readReplay(inputs)).toContain('transient_body_marker');
    await writeFile(join(directory, 'schema.sql'), sql.replace('marker', 'change'));
    await expect(readReplay(inputs)).rejects.toThrow('REPLAY_INPUT_CHANGED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
