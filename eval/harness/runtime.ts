import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, arch } from 'node:os';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { validate, type EvaluationReport, type EvalCase } from '../../packages/contracts/src/index';
import { redactValue } from '../../packages/core/src/secrets/sink';
import { newId, hash } from '../../packages/core/src/hash';
import lock from '../../config/runtime-lock.json';
import { frozenDataset } from './dataset';

function command(name: string, args: string[]): string {
  return execFileSync(name, args, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }).trim();
}
export function gpuUsed(): number | null {
  try {
    const value = Number(
      command('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']).split(
        '\n',
      )[0],
    );
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
export async function makeReport(
  suite: EvaluationReport['suite'],
  cases: EvalCase[],
  duration_ms: number,
  gpuSamples: number[],
): Promise<EvaluationReport> {
  const { manifest, digest } = await frozenDataset();
  let gpu: string | null = null;
  try {
    gpu = command('nvidia-smi', [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader',
    ]);
  } catch {
    /* No NVIDIA telemetry on M4; no unified-memory peak claimed. */
  }
  const ai = suite === 'ai';
  const paths = command('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'packages',
    'apps',
    'eval/harness',
    'scripts',
    'config/runtime-lock.json',
    'package.json',
    'pnpm-lock.yaml',
  ])
    .split('\n')
    .filter(Boolean)
    .sort();
  const sourceHashes = [];
  for (const path of paths) sourceHashes.push({ path, digest: hash(await readFile(path, 'utf8')) });
  return validate(
    'EvaluationReport',
    redactValue({
      schema_version: '1.0',
      id: newId('evaluation'),
      suite,
      status: cases.some((c) => c.status === 'failed')
        ? 'failed'
        : cases.some((c) => c.status === 'incomplete') || ai
          ? 'incomplete'
          : 'complete',
      dataset_id: manifest.id,
      dataset_digest: digest,
      commit: command('git', ['rev-parse', 'HEAD']),
      implementation_digest: hash(sourceHashes),
      working_tree_dirty: command('git', ['status', '--porcelain']).length > 0,
      harness_version: '1.1.0',
      registry_version: '1',
      prompt_version: '4',
      model_tag: lock.ollama_model,
      model_parameters: {
        temperature: 0,
        context_tokens: 4096,
        output_tokens: 768,
        thinking: false,
        streaming: false,
        deadline_ms: 30000,
        max_attempts: 2,
        warm_state: 'not_controlled_includes_load',
      },
      model_digest: lock.ollama_model_digest,
      postgres_image: lock.postgres_image,
      hardware: {
        os: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? 'unknown',
        ram_bytes: totalmem(),
        gpu,
      },
      runtime: {
        node: process.versions.node,
        pnpm: command('pnpm', ['--version']),
        docker: command('docker', ['version', '--format', '{{.Server.Version}}']),
        ollama: command('ollama', ['--version']),
      },
      created_at: new Date().toISOString(),
      duration_ms,
      cases,
      missing_suites: ai ? ['human_faithfulness_rubric'] : [],
      limitations: [
        ...manifest.limitations,
        'Nearest-rank p95; small curated N; phase values include harness overhead',
        'Leak/unsafe-action counts cover only inspected harness boundaries, not arbitrary application behavior',
        'AI model may misunderstand facts; schema/reference validity is separate from human faithfulness',
      ],
      gpu_peak_used_mib: gpuSamples.length ? Math.max(...gpuSamples) : null,
      gpu_samples: gpuSamples.length,
      human_faithfulness_rubric: ai ? 'pending_human_review' : 'not_applicable',
    }),
  );
}
export async function saveReport(report: EvaluationReport): Promise<void> {
  await mkdir('eval/reports', { recursive: true });
  const body = JSON.stringify(validate('EvaluationReport', redactValue(report)), null, 2) + '\n';
  await writeFile(`eval/reports/${report.id}.json`, body, { flag: 'wx' });
  await writeFile(`eval/reports/${report.suite}.latest.json`, body);
}
