import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
import { withReplica } from '../packages/core/src/replica/manager';
import { admitSql } from '../packages/core/src/intake/admit';
import { introspect } from '../packages/core/src/rls/introspect';
import { analyzeRls } from '../packages/core/src/rls/analyze';
import { resolveExpectations } from '../packages/core/src/expectations/resolve';
import { investigate } from '../packages/core/src/ai/ollama';
import { validate, parseStrictJson } from '../packages/contracts/src/index';
import lock from '../config/runtime-lock.json';
const sql = await admitSql(await readFile('eval/fixtures/rls/R-01/schema.sql', 'utf8'));
if (process.argv.slice(2).some((a) => a !== '--inferred')) throw new Error('CLI_ARGUMENT_INVALID');
const data = await withReplica(async (r) => {
  await r.apply(sql);
  const snapshot = await introspect(r);
  const manifest = validate(
    'ExpectationManifest',
    parseStrictJson(await readFile('eval/fixtures/rls/R-01/expectations.json', 'utf8'), 65536),
  );
  const e = resolveExpectations(
    snapshot,
    process.argv.includes('--inferred') ? [] : manifest.expectations,
  );
  return {
    snapshot,
    finding: (await analyzeRls(snapshot, e, 'ai_preflight')).find(
      (f) =>
        f.expectation?.resource.table === 'profiles' &&
        f.expectation.actor === 'authenticated' &&
        f.expectation.operation === 'SELECT',
    )!,
  };
});
const started = performance.now();
const analysis = await investigate(data.finding, data.snapshot, (m) =>
  console.log(JSON.stringify(m)),
);
const duration_ms = performance.now() - started;
const report = {
  timestamp: new Date().toISOString(),
  hardware: { cpu: cpus()[0]?.model, ram_bytes: totalmem(), os: platform(), arch: arch() },
  runtime: lock,
  kind: 'one live R-01 investigation; not an AI quality evaluation',
  duration_ms,
  analysis,
};
await mkdir('.local/measurements', { recursive: true });
await writeFile('.local/measurements/ai-preflight.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: analysis.status,
    reason_code: analysis.reason_code,
    duration_ms,
    model: analysis.model,
  }),
);
if (analysis.status !== 'available') process.exitCode = 1;
