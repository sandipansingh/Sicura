import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { validate, parseStrictJson, type RehearsalReport } from '../packages/contracts/src/index';
import { hash, newId } from '../packages/core/src/hash';
import { makeReport } from '../eval/harness/runtime';
import { redactValue } from '../packages/core/src/secrets/sink';

const id = newId('rehearsal');
const output = resolve('.local/rehearsal', id);
await mkdir(output, { recursive: true });
// Reuse the measured provenance collector; no evaluation metrics/run are published here.
const metadata = await makeReport('deterministic', [], 0, []);
const report: RehearsalReport = {
  schema_version: '1.0',
  id,
  label: 'PRERECORDED FALLBACK — actual local-replica browser runs; not live',
  status: 'failed',
  commit: metadata.commit,
  implementation_digest: metadata.implementation_digest,
  working_tree_dirty: metadata.working_tree_dirty,
  hardware: metadata.hardware,
  runtime: metadata.runtime,
  model_tag: metadata.model_tag,
  model_digest: metadata.model_digest,
  postgres_image: metadata.postgres_image,
  prompt_version: metadata.prompt_version,
  dataset_id: metadata.dataset_id,
  dataset_digest: metadata.dataset_digest,
  created_at: new Date().toISOString(),
  runs: [],
  limitations: [
    'Three automated browser rehearsals using fresh local replicas and real Gemma, not timed human narration',
    'Video has no audio; retain this provenance and visible prerecorded label when using the fallback',
    'Synthetic privileged credential beat is an explicit trusted fixture; no credential validity tested',
    'Apple M4 installation and human AI faithfulness rubric remain unverified',
  ],
};
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
for (let ordinal = 1; ordinal <= 3; ordinal++) {
  const runOutput = join(output, `run-${ordinal}`);
  const data = join(output, `data-${ordinal}`);
  await mkdir(runOutput, { recursive: true });
  const start = performance.now();
  const code = await new Promise<number>((resolveExit) => {
    const child = spawn('pnpm', ['run', 'test:e2e', '--output', runOutput], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        PROOFSEC_E2E_DATA_DIR: data,
        PROOFSEC_RECORD_FALLBACK: '1',
        PROOFSEC_RECORD_COMMIT: report.commit,
        PROOFSEC_RECORD_TIMESTAMP: report.created_at,
      },
    });
    child.once('error', () => resolveExit(1));
    child.once('exit', (c) => resolveExit(c ?? 1));
  });
  const remaining = execFileSync(
    'docker',
    ['ps', '-aq', '--filter', `label=io.proofsec.scope=${hash(resolve(data)).slice(0, 24)}`],
    { encoding: 'utf8', timeout: 10000 },
  ).trim();
  const artifacts: RehearsalReport['runs'][number]['artifacts'] = [];
  for (const path of await files(runOutput)) {
    const kind = path.endsWith('.webm')
      ? 'video'
      : path.endsWith('report.json')
        ? 'report_json'
        : path.endsWith('report.md')
          ? 'report_markdown'
          : null;
    if (!kind) continue;
    const buffer = await readFile(path);
    if (kind === 'report_json')
      validate('ExportReport', parseStrictJson(buffer.toString('utf8'), 16 * 1024 * 1024));
    artifacts.push({
      kind,
      path: relative(resolve('.'), path).split('\\').join('/'),
      digest: createHash('sha256').update(buffer).digest('hex'),
    });
  }
  const complete =
    code === 0 &&
    !remaining &&
    ['video', 'report_json', 'report_markdown'].every((k) => artifacts.some((a) => a.kind === k));
  report.runs.push({
    ordinal,
    status: complete ? 'passed' : 'failed',
    duration_ms: performance.now() - start,
    owned_resources_remaining: remaining ? remaining.split('\n').length : 0,
    artifacts,
  });
  report.status =
    report.runs.length === 3 && report.runs.every((r) => r.status === 'passed')
      ? 'complete'
      : 'failed';
  const body = JSON.stringify(validate('RehearsalReport', redactValue(report)), null, 2) + '\n';
  await writeFile(join(output, 'provenance.json'), body);
  await writeFile(resolve('.local/rehearsal/latest.json'), body);
  console.log(
    `${complete ? 'PASS' : 'FAIL'} rehearsal ${ordinal}; ${Math.round(report.runs.at(-1)!.duration_ms)}ms; owned resources remaining=${report.runs.at(-1)!.owned_resources_remaining}`,
  );
  if (!complete) process.exit(1);
}
console.log(
  `PASS three clean automated rehearsals. Labeled fallback/provenance: ${relative(resolve('.'), output)}`,
);
