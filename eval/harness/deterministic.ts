import { frozenDataset } from './dataset';
import { runDetector, runContext } from './credentials';
import { runAdversarial } from './adversarial';
import { runRlsFixture } from './rls';
import { counts } from './metrics';
import { makeReport, saveReport } from './runtime';
import { validate, type EvalCase } from '../../packages/contracts/src/index';

const started = performance.now();
const { manifest } = await frozenDataset();
const cases: EvalCase[] = [];
for (const id of manifest.suites.detector) cases.push(await runDetector(id));
for (const id of manifest.suites.context) cases.push(await runContext(id));
for (const id of manifest.suites.rls) {
  const result = await runRlsFixture(id);
  cases.push(
    validate('EvalCase', {
      id,
      suite: 'rls',
      status: result.failures.length ? 'failed' : 'passed',
      duration_ms: result.duration_ms,
      failures: result.failures,
      counts: {
        ...counts(),
        tp: result.tp,
        fp: result.fp,
        fn: result.fn,
        tn: result.tn,
        gold_testable: result.gold_testable,
        agreement: result.agreement,
        expected_inconclusive: result.expected_inconclusive,
        correct_inconclusive: result.correct_inconclusive,
      },
      rls: result,
      ai_analysis: null,
    }),
  );
  console.log(`${result.failures.length ? 'FAIL' : 'PASS'} ${id}`);
}
for (const id of manifest.suites.adversarial) {
  const result = await runAdversarial(id);
  cases.push(result);
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${id}`);
}
const report = await makeReport('deterministic', cases, performance.now() - started, []);
await saveReport(report);
console.log(
  JSON.stringify({
    status: report.status,
    dataset: report.dataset_id,
    cases: cases.length,
    duration_ms: report.duration_ms,
  }),
);
if (report.status !== 'complete') process.exitCode = 1;
