import { readFile } from 'node:fs/promises';
import { frozenDataset, fixture } from './dataset';
import { makeReport, saveReport, gpuUsed } from './runtime';
import { counts } from './metrics';
import { withReplica } from '../../packages/core/src/replica/manager';
import { admitSql } from '../../packages/core/src/intake/admit';
import { introspect } from '../../packages/core/src/rls/introspect';
import { resolveExpectations } from '../../packages/core/src/expectations/resolve';
import { analyzeRls } from '../../packages/core/src/rls/analyze';
import { investigate } from '../../packages/core/src/ai/ollama';
import { demoCredential } from '../../packages/core/src/secrets/demo';
import {
  validate,
  type EvalCase,
  type Finding,
  type SchemaSnapshot,
} from '../../packages/contracts/src/index';

const started = performance.now();
const { manifest } = await frozenDataset();
const cases: EvalCase[] = [];
const samples: number[] = [];
const timer = setInterval(() => {
  const sample = gpuUsed();
  if (sample !== null) samples.push(sample);
}, 1000);
try {
  for (const id of manifest.suites.ai) {
    const f = await fixture(`eval/fixtures/ai/${id}.json`, 'AIFixture');
    let finding: Finding;
    let snapshot: SchemaSnapshot | null = null;
    if (f.kind === 'credential')
      finding = demoCredential('ai_fixture', 1, Buffer.alloc(32, 1)).finding;
    else {
      const rlsId = f.kind === 'unknown' ? 'R-11' : 'R-01';
      const sql = await admitSql(await readFile(`eval/fixtures/rls/${rlsId}/schema.sql`, 'utf8'));
      const manifest = await fixture(
        `eval/fixtures/rls/${rlsId}/expectations.json`,
        'ExpectationManifest',
      );
      const context = await withReplica(async (r) => {
        await r.apply(sql);
        const snapshot = await introspect(r, id);
        const expectations = resolveExpectations(
          snapshot,
          f.kind === 'declared' ? manifest.expectations : [],
        );
        const finding = (await analyzeRls(snapshot, expectations, id)).find(
          (f) =>
            f.expectation?.actor === 'authenticated' &&
            f.expectation.operation === 'SELECT' &&
            f.expectation.resource.table !== 'posts',
        )!;
        return { snapshot, finding };
      });
      finding = context.finding;
      snapshot = context.snapshot;
    }
    for (let repetition = 1; repetition <= f.repetitions; repetition++) {
      const start = performance.now();
      const metrics = counts();
      const before = JSON.stringify(finding.expectation);
      const analysis = await investigate(finding, snapshot, (m) => {
        metrics.response_attempts++;
        if (m.error_code === null) metrics.accepted_responses++;
      });
      const failures: string[] = [];
      if (JSON.stringify(finding.expectation) !== before)
        failures.push('Model changed active expectation');
      const status = failures.length
        ? 'failed'
        : analysis.status === 'available'
          ? 'passed'
          : 'incomplete';
      cases.push(
        validate('EvalCase', {
          id: `${id}-r${repetition}`,
          suite: 'ai',
          status,
          duration_ms: performance.now() - start,
          failures,
          counts: metrics,
          rls: null,
          ai_analysis: analysis,
        }),
      );
      console.log(
        JSON.stringify({
          id,
          repetition,
          status: analysis.status,
          attempts: metrics.response_attempts,
        }),
      );
    }
  }
} finally {
  clearInterval(timer);
}
const report = await makeReport('ai', cases, performance.now() - started, samples);
await saveReport(report);
console.log(
  JSON.stringify({
    status: report.status,
    cases: cases.length,
    gpu_peak_used_mib: report.gpu_peak_used_mib,
    human_rubric: report.human_faithfulness_rubric,
  }),
);
// Human rubric is explicitly pending. Missing/invalid model results still fail execution.
if (cases.some((c) => c.status !== 'passed')) process.exitCode = 1;
