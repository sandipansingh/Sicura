import {
  validate,
  type ContractMap,
  type MigrationPatch,
  type TestResult,
} from '../../../contracts/src/index';
import { AppError } from '../errors';
import { redactValue } from '../secrets/sink';
import { verifyPatchIntegrity } from './integrity';

export function exportMigration(patch: MigrationPatch): string {
  verifyPatchIntegrity(patch);
  if (!patch.approval || !['approved', 'applied', 'failed'].includes(patch.status))
    throw new AppError('APPROVAL_REQUIRED', 409);
  const safe = redactValue(patch.migration_sql);
  if (safe !== patch.migration_sql) throw new AppError('SINK_SECRET_REJECTED');
  return safe;
}
// Untrusted identifiers/prose remain plain Markdown text, never HTML or links.
const text = (value: unknown): string =>
  String(value ?? 'unknown')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()!#|]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
const jsonBlock = (value: unknown): string =>
  '```json\n' + JSON.stringify(value, null, 2).replace(/`/g, '\\u0060') + '\n```';
function resultTable(results: TestResult[]): string[] {
  return [
    '| Result / scenario | Test | Synthetic actor → target | Expected | Observed | Outcome / controls | Rows / reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${text(r.id)} / ${text(r.scenario_key)} | ${text(r.test_id)} | ${text(r.actor)} → ${text(r.target)} | ${text(r.expected)} | ${text(r.observed)} | ${text(r.outcome)} / ${text(r.control_result_ids.join(', '))}; role=${r.role_assertion_passed}; target=${r.target_existence_passed} | ${text(r.row_count)} / ${text(r.reason_code ?? r.denial_mechanism)} |`,
    ),
  ];
}
export function exportMarkdown(input: ContractMap['ExportReport']): string {
  const report = validate('ExportReport', redactValue(validate('ExportReport', input)));
  const f = report.finding;
  const lines = [
    '# Redacted finding report',
    '',
    text(f.title),
    '',
    `Category: ${f.category}. State: ${f.state}. Finding: ${f.id}. Input revision: ${f.input_revision}. Evidence stale: ${f.verification.stale}.`,
    '',
    '## Expected Access Model',
    '',
    ...(f.expectation
      ? [
          `Source: ${f.expectation.source}; revision: ${f.expectation.revision} (${f.expectation.revision_id}); actor: ${f.expectation.actor}; operation: ${f.expectation.operation}; expected: ${f.expectation.expected}.`,
          `Resource: ${text(f.expectation.resource.schema)}.${text(f.expectation.resource.table)}; owner: ${text(f.expectation.owner_column)}; intentionally public: ${f.expectation.intentionally_public}.`,
          ...(f.expectation.source === 'inferred'
            ? ['Results are relative to inferred intent; a human declaration is still needed.']
            : []),
        ]
      : ['Not applicable to static credential classification.']),
    '',
    '## Static evidence',
    '',
    jsonBlock(f.evidence),
    '',
    '## AI Analysis — advisory',
    '',
    ...(f.ai_analysis.status === 'available' && f.ai_analysis.output
      ? [
          `Model: ${text(f.ai_analysis.model)}; digest: ${text(f.ai_analysis.model_digest)}; prompt: ${text(f.ai_analysis.prompt_version)}. Proposals remain inactive until human Save.`,
          jsonBlock(f.ai_analysis.output),
        ]
      : ['AI analysis not available. Deterministic evidence remains independent.']),
    '',
    '## Verified Evidence — local replica',
    '',
  ];
  if (f.category === 'CREDENTIAL_EXPOSURE')
    lines.push(
      'No database probe or credential validity test was performed. Exposure classification is static.',
      'Removal applies only to the complete submitted artifact scope; rotation, revocation, history and previously published artifacts are unverified.',
    );
  else {
    lines.push(...resultTable(f.verification.evidence), '');
    for (const { run, results } of report.runs)
      lines.push(
        `### ${run.kind} run ${run.id}`,
        '',
        `Status: ${run.status}; mode: ${run.mode}; baseline: ${text(run.baseline_run_id)}.`,
        `Schema: ${run.schema_digest}; patch: ${text(run.patch_digest)}; seed: ${run.seed_digest}; claims: ${run.claims_digest}.`,
        `Registry: ${run.registry_version}; harness: ${text(run.harness_version)}; PostgreSQL: ${text(run.postgres_version)}; image: ${text(run.image_digest)}.`,
        `Expectation revisions: ${text(run.expectation_revision_ids.join(', '))}.`,
        `Coverage planned=${run.coverage.planned}, executed=${run.coverage.executed}, skipped=${run.coverage.skipped}, errored=${run.coverage.errored}, not-testable=${run.coverage.not_testable}.`,
        '',
        ...resultTable(results),
        '',
        ...run.fidelity_gaps.map((g) => `- ${text(g)}`),
        '',
      );
  }
  lines.push(
    '## Remediation and retest',
    '',
    jsonBlock(f.remediation),
    '',
    jsonBlock(f.retest_result),
    '',
    'Migration export is a file for review in your project workflow. Applying a patch here changes only a disposable replica.',
    '',
    '## Limitations',
    '',
    ...f.context.limitations.map((l) => `- ${text(l)}`),
    '',
    'Recorded scenarios use synthetic identities and rows. They do not establish production access or complete application coverage.',
    '',
  );
  return redactValue(lines.join('\n'));
}
