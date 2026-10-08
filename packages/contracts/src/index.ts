import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../contracts.schema.json' with { type: 'json' };
import type * as Wire from './generated';

export * from './generated';
export { parseStrictJson } from './strict-json';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);
export type ContractName = keyof typeof schema.$defs;
export interface ContractMap {
  RuntimeState: Wire.RuntimeState;
  ImportRequest: Wire.ImportRequest;
  ImportSource: Wire.ImportSource;
  ImportSelection: Wire.ImportSelection;
  ImportReport: Wire.ImportReport;
  ImportStatus: Wire.ImportStatus;
  GithubTree: Wire.GithubTree;
  Finding: Wire.Finding;
  Expectation: Wire.Expectation;
  ExpectationEdit: Wire.ExpectationEdit;
  ExpectationManifest: Wire.ExpectationManifest;
  TestResult: Wire.TestResult;
  Run: Wire.Run;
  GemmaInput: Wire.GemmaInput;
  GemmaOutput: Wire.GemmaOutput;
  MigrationPatch: Wire.MigrationPatch;
  Project: Wire.Project;
  Job: Wire.Job;
  ApiError: Wire.ApiError;
  InputRequest: Wire.InputRequest;
  CreateProjectRequest: Wire.CreateProjectRequest;
  ExpectationUpdateRequest: Wire.ExpectationUpdateRequest;
  InvestigateRequest: Wire.InvestigateRequest;
  VerifyRequest: Wire.VerifyRequest;
  PatchRequest: Wire.PatchRequest;
  ApproveRequest: Wire.ApproveRequest;
  ScanReport: Wire.ScanReport;
  SchemaSnapshot: Wire.SchemaSnapshot;
  AdmittedInputs: Wire.AdmittedInputs;
  JobPayload: Wire.JobPayload;
  JobEnvelope: Wire.JobEnvelope;
  FindingsResponse: Wire.FindingsResponse;
  ProjectsResponse: Wire.ProjectsResponse;
  RunResponse: Wire.RunResponse;
  ProjectView: Wire.ProjectView;
  FindingView: Wire.FindingView;
  SessionResponse: Wire.SessionResponse;
  DeleteResponse: Wire.DeleteResponse;
  ExportReport: Wire.ExportReport;
  OllamaTags: Wire.OllamaTags;
  OllamaEnvelope: Wire.OllamaEnvelope;
  CredentialContextFacts: Wire.CredentialContextFacts;
  CredentialFingerprint: Wire.CredentialFingerprint;
  RescanRequest: Wire.RescanRequest;
  EmptyRequest: Wire.EmptyRequest;
  ParserEnvelope: Wire.ParserEnvelope;
  RlsFixtureLabels: Wire.RlsFixtureLabels;
  RlsFixtureResult: Wire.RlsFixtureResult;
  DetectorRecipe: Wire.DetectorRecipe;
  ContextFixture: Wire.ContextFixture;
  AdversarialFixture: Wire.AdversarialFixture;
  AIFixture: Wire.AIFixture;
  DatasetManifest: Wire.DatasetManifest;
  EvalCounts: Wire.EvalCounts;
  EvalCase: Wire.EvalCase;
  EvaluationReport: Wire.EvaluationReport;
  EvaluationResponse: Wire.EvaluationResponse;
  RehearsalReport: Wire.RehearsalReport;
}
export function validate<K extends keyof ContractMap>(name: K, data: unknown): ContractMap[K] {
  const check = ajv.getSchema(`urn:proofsec:contracts:1.0#/$defs/${name}`);
  if (!check || !check(data)) throw new Error('CONTRACT_INVALID');
  const typed = data as ContractMap[K];
  if (name === 'Expectation') expectationInvariant(typed as Wire.Expectation);
  if (name === 'TestResult') resultInvariant(typed as Wire.TestResult);
  if (name === 'Finding') findingInvariant(typed as Wire.Finding);
  if (name === 'Run') {
    const { coverage: v } = typed as Wire.Run;
    if (
      v.planned !== v.executed + v.skipped ||
      v.errored > v.executed ||
      v.not_testable > v.planned
    )
      throw new Error('COVERAGE_INVALID');
  }
  return typed;
}
export function expectationInvariant(e: Wire.Expectation | Wire.ExpectationEdit): void {
  if (e.actor === 'anon' && e.expected === 'own_rows_only') throw new Error('EXPECTATION_INVALID');
  if (e.expected === 'own_rows_only' && !e.owner_column) throw new Error('EXPECTATION_INVALID');
  if (e.expected === 'team_rows_only' && !e.team_binding) throw new Error('EXPECTATION_INVALID');
  if (
    e.intentionally_public &&
    (e.expected !== 'all_rows' || ('source' in e && e.source !== 'declared'))
  )
    throw new Error('EXPECTATION_INVALID');
  if ('source' in e && (e.source === 'unknown') !== (e.expected === 'unknown'))
    throw new Error('EXPECTATION_INVALID');
}
export function resultInvariant(r: Wire.TestResult): void {
  if (r.observed === 'error' || r.observed === 'not_run') {
    if (r.outcome !== 'inconclusive' || !r.reason_code) throw new Error('EVIDENCE_INVALID');
  }
  if (r.observed === 'deny' && !r.denial_mechanism) throw new Error('EVIDENCE_INVALID');
  if (r.outcome !== 'inconclusive') {
    if (
      !r.role_assertion_passed ||
      !r.target_existence_passed ||
      !r.expected ||
      !['allow', 'deny'].includes(r.observed)
    )
      throw new Error('EVIDENCE_INVALID');
    if ((r.outcome === 'match') !== (r.expected === r.observed))
      throw new Error('EVIDENCE_INVALID');
  }
}
export function findingInvariant(f: Wire.Finding): void {
  if ((f.ai_analysis.status === 'available') !== (f.ai_analysis.output !== null))
    throw new Error('AI_ANALYSIS_INVALID');
  f.verification.evidence.forEach(resultInvariant);
  if (f.category === 'CREDENTIAL_EXPOSURE') {
    if (
      f.location.kind !== 'file' ||
      f.evidence.kind !== 'credential' ||
      f.source.kind !== 'source_scan' ||
      f.expectation !== null ||
      f.verification.status !== 'not_applicable' ||
      f.verification.evidence.length
    )
      throw new Error('FINDING_CATEGORY_INVALID');
  } else {
    if (
      f.location.kind !== 'database' ||
      f.evidence.kind !== 'rls' ||
      f.source.kind !== 'catalog' ||
      !f.expectation
    )
      throw new Error('FINDING_CATEGORY_INVALID');
    expectationInvariant(f.expectation);
    if (
      f.state === 'confirmed' &&
      (f.verification.stale ||
        f.expectation.source === 'unknown' ||
        !f.verification.evidence.some(
          (r) =>
            r.expected === 'deny' &&
            r.observed === 'allow' &&
            r.outcome === 'mismatch' &&
            r.expectation_id === f.expectation?.id &&
            r.expectation_revision === f.expectation?.revision,
        ))
    )
      throw new Error('CONFIRMATION_INVALID');
  }
  if (
    f.state === 'fixed' &&
    (!f.retest_result ||
      f.retest_result.status !== 'passed' ||
      !f.retest_result.identical_scenarios ||
      !f.retest_result.regressions_passed)
  )
    throw new Error('FIX_INVALID');
}
export function contractSchema(name: ContractName): object {
  const needed: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value && typeof value.$ref === 'string') {
      const key = value.$ref.replace('#/$defs/', '') as ContractName;
      if (schema.$defs[key] && !needed[key]) {
        needed[key] = schema.$defs[key];
        visit(needed[key]);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(schema.$defs[name]);
  return { $schema: schema.$schema, ...schema.$defs[name], $defs: needed };
}
export const TEST_IDS = schema.$defs.TestId.enum;
