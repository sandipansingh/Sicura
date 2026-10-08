import { writeFile } from 'node:fs/promises';
import type { EvaluationReport } from '../../packages/contracts/src/index';
import { fixture } from './dataset';
import { totals, ratio, latency } from './metrics';
const rows: EvaluationReport[] = [];
for (const suite of ['deterministic', 'ai'])
  try {
    rows.push(await fixture(`eval/reports/${suite}.latest.json`, 'EvaluationReport'));
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') continue;
    throw e;
  }
if (!rows.length) throw new Error('EVAL_NOT_RUN');
const text = [
  '# Measured evaluation',
  '',
  'Counts are from the frozen curated dataset and actual executions. Context injection is separate from detector recipes. No production accuracy claim.',
  'RLS TP/FP/FN/TN count resource/actor/operation vulnerability tuples (expected-deny/observed-allow); agreement counts individual gold-testable scenarios. These are not full static-rule precision metrics. Inconclusive cases stay in their separately stated denominator.',
  '',
];
for (const report of rows) {
  text.push(
    `## ${report.suite}: ${report.status}`,
    '',
    `Dataset ${report.dataset_id} (${report.dataset_digest}); commit baseline ${report.commit}; working tree dirty ${report.working_tree_dirty}; implementation digest ${report.implementation_digest}.`,
    '',
    `Hardware: ${report.hardware.cpu}; ${report.hardware.os}/${report.hardware.arch}; RAM ${report.hardware.ram_bytes} bytes; GPU ${report.hardware.gpu ?? 'unavailable'}.`,
    `Runtime: Node ${report.runtime.node}, pnpm ${report.runtime.pnpm}, Docker ${report.runtime.docker}, ${report.runtime.ollama}.`,
    `Model ${report.model_tag} (${report.model_digest}); image ${report.postgres_image}; prompt ${report.prompt_version}.`,
    '',
    '| Layer | Cases | TP / FP / FN / TN | Precision | Recall | Agreement / planned testable |',
    '| --- | ---: | --- | --- | --- | --- |',
  );
  const durations: string[] = [];
  for (const suite of ['detector', 'context', 'rls', 'adversarial', 'ai']) {
    const cases = report.cases.filter((c) => c.suite === suite);
    if (!cases.length) continue;
    const c = totals(cases);
    const fmt = (v: number | null) => (v === null ? 'N/A (0 eligible)' : v.toFixed(4));
    text.push(
      `| ${suite} | ${cases.length} | ${c.tp} / ${c.fp} / ${c.fn} / ${c.tn} | ${fmt(ratio(c.tp, c.tp + c.fp))} | ${fmt(ratio(c.tp, c.tp + c.fn))} | ${c.agreement} / ${c.gold_testable} |`,
    );
    const l = latency(cases.map((c) => c.duration_ms));
    durations.push(
      `\n${suite} latency (ms): N=${l.n}; median ${l.median?.toFixed(2)}; nearest-rank p95 ${l.p95?.toFixed(2)}; min ${l.min?.toFixed(2)}; max ${l.max?.toFixed(2)}. Small curated N.\n`,
    );
  }
  const c = totals(report.cases);
  text.push(
    '',
    ...durations,
    `Expected inconclusive/unknown cases: ${c.correct_inconclusive}/${c.expected_inconclusive}. Inspected harness sink projections: ${c.inspected_sinks}; leaked canaries: ${c.leaked_canaries}; attempted unsafe actions: ${c.unsafe_actions}.`,
    `AI accepted responses/attempts: ${c.accepted_responses}/${c.response_attempts}; human faithfulness: ${report.human_faithfulness_rubric}.`,
    `GPU device-used sampled peak: ${report.gpu_peak_used_mib ?? 'not measured'} MiB (${report.gpu_samples} samples, 1-second interval); no allocator high-water mark claimed.`,
    '',
    `Missing suites: ${report.missing_suites.join(', ') || 'none in this run'}.`,
    '',
    ...report.limitations.map((l) => `- ${l}`),
    '',
  );
  for (const failed of report.cases.filter((c) => c.status !== 'passed'))
    text.push(
      `- ${failed.id}: ${failed.status}; ${failed.failures.join('; ') || failed.ai_analysis?.reason_code || 'incomplete'}`,
    );
}
await writeFile('eval/reports/REPORT.md', text.join('\n') + '\n');
console.log('Rendered eval/reports/REPORT.md from existing run files.');
