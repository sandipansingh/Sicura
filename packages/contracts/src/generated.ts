/* Generated from contracts.schema.json. Do not edit. */

export type UrnProofsecContracts10 =
  | Resource
  | Confidence
  | FindingState
  | TestId
  | TeamBinding
  | ExpectationEdit
  | Expectation
  | ExpectationProposal
  | Location
  | RlsEvidence
  | CredentialEvidence
  | Hypothesis
  | TestReasonCode
  | TestResult
  | Coverage
  | Run
  | GemmaInput
  | GemmaOutput
  | AIAnalysis
  | Remediation
  | RetestResult
  | Approval
  | MigrationPatch
  | Finding
  | ExpectationManifest
  | Project
  | Job
  | ApiError
  | CreateProjectRequest
  | ExpectationUpdateRequest
  | InvestigateRequest
  | VerifyRequest
  | PatchRequest
  | ApproveRequest
  | InputFile
  | InputRequest
  | ScanReport
  | Column
  | Policy
  | Table
  | SchemaSnapshot
  | AdmittedInputs
  | JobPayload
  | JobEnvelope
  | FindingsResponse
  | ProjectsResponse
  | RunResponse
  | ProjectView
  | FindingView
  | SessionResponse
  | DeleteResponse
  | ExportReport
  | OllamaTags
  | OllamaEnvelope
  | CredentialContextFacts
  | CredentialFingerprint
  | RescanRequest
  | EmptyRequest
  | RlsFixtureLabels
  | RlsFixtureResult
  | DetectorRecipe
  | ContextFixture
  | AdversarialFixture
  | AIFixture
  | DatasetManifest
  | EvalCounts
  | EvalCase
  | EvaluationReport
  | EvaluationResponse
  | ParserEnvelope
  | RehearsalReport
  | ImportSource
  | ImportSelection
  | ImportRequest
  | ImportExclusion
  | ImportRoot
  | ImportProvenance
  | ImportReport
  | ImportStatus
  | GithubTree
  | RuntimeState
  | SQLDiagnostic
  | SQLTable
  | SQLPolicy
  | SQLGrant
  | SQLAnalysis
  | SqlRlsEvidence
  | ProjectSummaryOutput
  | ProjectSummary
  | ProjectInvestigateRequest
  | ReplayManifest;
export type FindingState =
  | "needs_expectation"
  | "suspected"
  | "confirmed"
  | "not_reproduced"
  | "blocked"
  | "not_testable"
  | "fixed"
  | "fix_not_verified";
export type TestId =
  | "rls.cross_user_read.v1"
  | "rls.cross_user_update.v1"
  | "rls.cross_user_delete.v1"
  | "rls.insert_as_other.v1"
  | "rls.reassign_owner.v1"
  | "rls.anon_access.v1"
  | "rls.own_row_access.v1";
export type Location =
  | {
      kind: "database";
      resource: Resource;
      /**
       * @maxItems 500
       */
      policy_names: string[];
      operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
    }
  | {
      kind: "file";
      path: string;
      line_start: number;
      line_end: number;
    };
export type TestReasonCode =
  | "NO_ROW_LOCATOR"
  | "OWNER_BINDING_MISSING"
  | "TYPE_UNSUPPORTED"
  | "DEFAULT_UNSUPPORTED"
  | "CHECK_UNSATISFIED"
  | "FK_CYCLE_UNSUPPORTED"
  | "FK_TARGET_UNSUPPORTED"
  | "FK_DELETE_BLOCKED"
  | "NO_MUTABLE_COLUMN"
  | "CLAIMS_UNMODELED"
  | "TEAM_SEMANTICS_UNSUPPORTED"
  | "UNSUPPORTED_SCHEMA_SEMANTICS"
  | "POSITIVE_CONTROL_FAILED"
  | "CONSTRAINT_OR_SETUP_ERROR"
  | "AMBIGUOUS_PERMISSION_ERROR"
  | "OBSERVER_MISMATCH"
  | "IDENTITY_ASSERTION_FAILED"
  | "REPLICA_UNAVAILABLE"
  | "STATEMENT_TIMEOUT"
  | "CONNECTION_LOST"
  | "JOB_DEADLINE"
  | "CANCELLED"
  | "EXPECTATION_UNKNOWN"
  | "UNEXPECTED_DB_ERROR"
  | "SEED_ASSIGNMENT_LIMIT";
export type ImportSource =
  | {
      kind: "github";
      url: string;
      ref: string | null;
    }
  | {
      kind: "local";
      directory: string;
    };

export interface Resource {
  schema: string;
  table: string;
}
export interface Confidence {
  level: "low" | "medium" | "high";
  basis: string;
}
export interface TeamBinding {
  row_team_column: string;
  membership_resource: Resource;
  member_user_column: string;
  member_team_column: string;
}
export interface ExpectationEdit {
  resource: Resource;
  actor: "authenticated" | "anon";
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  expected: "own_rows_only" | "all_rows" | "deny_all" | "team_rows_only" | "unknown";
  owner_column: string | null;
  team_binding: TeamBinding | null;
  intentionally_public: boolean;
  rationale: string;
}
export interface Expectation {
  id: string;
  revision_id: string;
  revision: number;
  resource: Resource;
  actor: "authenticated" | "anon";
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  expected: "own_rows_only" | "all_rows" | "deny_all" | "team_rows_only" | "unknown";
  source: "declared" | "inferred" | "unknown";
  origin: "manifest" | "user" | "heuristic";
  owner_column: string | null;
  team_binding: TeamBinding | null;
  intentionally_public: boolean;
  rationale: string;
  /**
   * @maxItems 500
   */
  signals: string[];
  confirmed_by: string | null;
  created_at: string;
}
export interface ExpectationProposal {
  resource: Resource;
  actor: "authenticated" | "anon";
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  expected: "own_rows_only" | "all_rows" | "deny_all" | "team_rows_only" | "unknown";
  owner_column: string | null;
  rationale: string;
  /**
   * @maxItems 500
   */
  evidence_refs: string[];
}
export interface RlsEvidence {
  kind: "rls";
  id: string;
  /**
   * @maxItems 500
   */
  rule_ids: string[];
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  role: "authenticated" | "anon";
  rls_enabled: boolean;
  force_rls: boolean;
  /**
   * @maxItems 500
   */
  policy_names: string[];
  policy_condition: string;
  grant_summary: string;
  snapshot_id: string;
}
export interface CredentialEvidence {
  kind: "credential";
  id: string;
  /**
   * @maxItems 500
   */
  rule_ids: string[];
  credential_type:
    | "api_key"
    | "database_credential"
    | "jwt_secret"
    | "private_key"
    | "client_secret"
    | "cloud_credential"
    | "privileged_backend_credential"
    | "unknown_secret";
  value: "[REDACTED]";
  exposure: "frontend" | "backend" | "config" | "unknown";
  classification: "likely_secret" | "public_identifier" | "placeholder" | "uncertain";
  variable_name: string | null;
  redacted_snippet: string;
  validity: "not_tested";
  use_context: string;
}
export interface Hypothesis {
  statement: string;
  actor: ("user_a" | "user_b" | "anon") | null;
  target: ("user_a" | "user_b" | "anon") | null;
  operation: ("SELECT" | "INSERT" | "UPDATE" | "DELETE") | null;
  test_id: TestId | null;
  /**
   * @maxItems 500
   */
  evidence_refs: string[];
  origin: "deterministic" | "gemma";
}
export interface TestResult {
  id: string;
  run_id: string;
  scenario_key: string;
  test_id: TestId;
  resource: Resource;
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  actor: "user_a" | "user_b" | "anon";
  target: ("user_a" | "user_b" | "anon") | null;
  expectation_id: string;
  expectation_revision: number;
  expected: ("allow" | "deny") | null;
  observed: "allow" | "deny" | "error" | "not_run";
  outcome: "match" | "mismatch" | "inconclusive";
  denial_mechanism: ("rls_filter" | "rls_check" | "grant") | null;
  reason_code: TestReasonCode | null;
  row_count: number | null;
  /**
   * @maxItems 500
   */
  synthetic_row_aliases: string[];
  sqlstate: string | null;
  /**
   * @maxItems 500
   */
  control_result_ids: string[];
  role_assertion_passed: boolean;
  target_existence_passed: boolean;
  duration_ms: number;
  recorded_at: string;
}
export interface Coverage {
  planned: number;
  executed: number;
  skipped: number;
  errored: number;
  not_testable: number;
}
export interface Run {
  id: string;
  project_id: string;
  kind: "baseline" | "retest";
  baseline_run_id: string | null;
  status: "complete" | "partial" | "failed" | "cancelled";
  mode: "postgres_role_simulation" | "supabase_postgrest";
  schema_digest: string;
  patch_digest: string | null;
  seed_digest: string;
  registry_version: "1";
  harness_version: string;
  postgres_version: string;
  image_digest: string;
  claims_digest: string;
  /**
   * @maxItems 500
   */
  expectation_revision_ids: string[];
  input_revision: number;
  schema_snapshot_id: string;
  coverage: Coverage;
  /**
   * @maxItems 500
   */
  fidelity_gaps: string[];
  /**
   * @maxItems 2000
   */
  result_ids: string[];
  created_at: string;
  replay_profile?: "repository-v2" | "repository-v3";
  bootstrap_version?: "legacy-v1" | "supabase-database-v1";
  replay_sql_digest?: string;
}
export interface GemmaInput {
  schema_version: "1.0";
  finding_id: string;
  category: "RLS_MISCONFIGURATION" | "CREDENTIAL_EXPOSURE";
  resource: null | {
    schema: string;
    table: string;
  };
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | null;
  /**
   * @maxItems 20
   */
  evidence: {
    id: string;
    fact: string;
  }[];
  context: {
    classification: "user_owned" | "public_read" | "shared_team" | "unknown" | null;
    owner_column: string | null;
    /**
     * @maxItems 20
     */
    policy_names: string[];
    /**
     * @maxItems 10
     */
    signals: string[];
  };
  expectation: null | {
    id: string;
    revision: number;
    actor: "authenticated" | "anon";
    expected: "own_rows_only" | "all_rows" | "deny_all" | "team_rows_only" | "unknown";
    source: "declared" | "inferred" | "unknown";
  };
  /**
   * @maxItems 7
   */
  allowed_test_ids: (
    | "rls.cross_user_read.v1"
    | "rls.cross_user_update.v1"
    | "rls.cross_user_delete.v1"
    | "rls.insert_as_other.v1"
    | "rls.reassign_owner.v1"
    | "rls.anon_access.v1"
    | "rls.own_row_access.v1"
  )[];
  /**
   * @maxItems 10
   */
  limitations: string[];
}
export interface GemmaOutput {
  schema_version: "1.0";
  finding_id: string;
  explanation: string;
  context_interpretation: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: {
    level: "low" | "medium" | "high";
    basis: string;
  };
  impact: string;
  proposed_expectation: null | {
    actor: "authenticated" | "anon";
    expected: "own_rows_only" | "all_rows" | "deny_all" | "team_rows_only" | "unknown";
    owner_column: string | null;
    rationale: string;
  };
  attack_hypothesis: {
    statement: string;
    actor: "user_a" | "user_b" | "anon" | null;
    target: "user_a" | "user_b" | "anon" | null;
    operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | null;
  };
  recommended_test_id:
    | "rls.cross_user_read.v1"
    | "rls.cross_user_update.v1"
    | "rls.cross_user_delete.v1"
    | "rls.insert_as_other.v1"
    | "rls.reassign_owner.v1"
    | "rls.anon_access.v1"
    | "rls.own_row_access.v1"
    | null;
  remediation_intent: null | {
    template_id: "owner_select_v1" | "owner_insert_v1" | "owner_update_v1" | "owner_delete_v1" | "enable_rls_v1";
    policy_name: string | null;
    owner_column: string | null;
    rationale: string;
  };
  /**
   * @minItems 1
   * @maxItems 20
   */
  evidence_refs: string[];
  /**
   * @minItems 1
   * @maxItems 10
   */
  uncertainties: string[];
}
export interface AIAnalysis {
  status: "pending" | "available" | "unavailable" | "invalid";
  analysis_id: string | null;
  model: string | null;
  model_digest: string | null;
  prompt_version: string | null;
  output: GemmaOutput | null;
  reason_code: string | null;
  created_at: string | null;
}
export interface Remediation {
  status: "none" | "proposed" | "approved" | "applied" | "failed";
  patch_id: string | null;
  patch_digest: string | null;
  summary: string | null;
  approved_by: string | null;
  approved_at: string | null;
}
export interface RetestResult {
  kind: "rls" | "credential_rescan";
  baseline_run_id: string | null;
  run_id: string;
  status: "passed" | "failed" | "not_testable" | "blocked";
  identical_scenarios: boolean;
  regressions_passed: boolean;
  /**
   * @maxItems 500
   */
  failed_result_ids: string[];
  scope: string;
  completed_at: string;
}
export interface Approval {
  actor_id: string;
  approved_at: string;
  patch_digest: string;
  baseline_schema_digest: string;
  /**
   * @maxItems 500
   */
  expectation_revision_ids: string[];
}
export interface MigrationPatch {
  schema_version: "1.0";
  id: string;
  finding_id: string;
  project_id: string;
  input_revision: number;
  baseline_run_id: string;
  baseline_schema_digest: string;
  /**
   * @maxItems 500
   */
  expectation_revision_ids: string[];
  template_id: "owner_select_v1" | "owner_insert_v1" | "owner_update_v1" | "owner_delete_v1" | "enable_rls_v1";
  resource: Resource;
  policy_name: string | null;
  owner_column: string | null;
  migration_sql: string;
  patch_digest: string;
  /**
   * @maxItems 500
   */
  preconditions: string[];
  rationale: string;
  /**
   * @maxItems 500
   */
  risks: string[];
  origin: "gemma_intent" | "deterministic_template";
  status: "proposed" | "approved" | "applied" | "failed" | "superseded";
  approval: Approval | null;
  created_at: string;
}
export interface Finding {
  schema_version: "1.0";
  id: string;
  project_id: string;
  revision: number;
  input_revision: number;
  category: "RLS_MISCONFIGURATION" | "CREDENTIAL_EXPOSURE";
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  severity_basis: string;
  confidence: Confidence;
  source: {
    kind: "catalog" | "source_scan" | "sql_ast";
    analyzer_version: string;
    /**
     * @maxItems 500
     */
    rule_ids: string[];
  };
  location: Location;
  evidence: RlsEvidence | CredentialEvidence | SqlRlsEvidence;
  context: {
    table_classification: ("user_owned" | "public_read" | "shared_team" | "unknown") | null;
    /**
     * @maxItems 500
     */
    signals: string[];
    /**
     * @maxItems 500
     */
    limitations: string[];
    redacted_excerpt: string | null;
  };
  expectation: Expectation | null;
  ai_analysis: AIAnalysis;
  attack_hypothesis: Hypothesis | null;
  state: FindingState;
  suppression: {
    reason: "intentionally_public" | "placeholder" | "accepted_risk";
    rationale: string;
    actor_id: string;
    expectation_revision: number | null;
    created_at: string;
  } | null;
  verification: {
    status: "not_requested" | "queued" | "running" | "complete" | "partial" | "not_applicable";
    latest_run_id: string | null;
    /**
     * @maxItems 2000
     */
    evidence: TestResult[];
    stale: boolean;
  };
  remediation: Remediation;
  retest_result: RetestResult | null;
  timestamps: {
    created_at: string;
    updated_at: string;
    confirmed_at: string | null;
    fixed_at: string | null;
  };
}
export interface SqlRlsEvidence {
  kind: "rls_static";
  id: string;
  /**
   * @maxItems 500
   */
  rule_ids: string[];
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  role: "authenticated" | "anon";
  rls_enabled: boolean | null;
  force_rls: boolean | null;
  /**
   * @maxItems 500
   */
  policy_names: string[];
  policy_condition: string;
  grant_summary: string;
  snapshot_id: string;
}
export interface ExpectationManifest {
  schema_version: "1.0";
  /**
   * @maxItems 400
   */
  expectations: ExpectationEdit[];
}
export interface Project {
  id: string;
  name: string;
  input_revision: number;
  expectation_set_revision: number;
  admitted_schema_digest: string | null;
  created_at: string;
  expires_at: string;
}
export interface Job {
  id: string;
  project_id: string;
  kind:
    | "scan"
    | "verify"
    | "retest"
    | "rescan_credentials"
    | "evaluate"
    | "import"
    | "project_analysis"
    | "rescan_repository";
  phase:
    "intake" | "analyze" | "investigate" | "replica" | "seed" | "verify" | "apply" | "retest" | "report" | "cleanup";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input_revision: number;
  idempotency_key: string;
  lease_until: string | null;
  progress: {
    completed: number;
    total: number;
  };
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  request_id: string;
}
export interface CreateProjectRequest {
  name: string;
}
export interface ExpectationUpdateRequest {
  expected_revision: number;
  /**
   * @maxItems 400
   */
  changes: ExpectationEdit[];
}
export interface InvestigateRequest {
  expected_revision: number;
}
export interface VerifyRequest {
  input_revision: number;
  /**
   * @maxItems 500
   */
  expectation_revision_ids: string[];
}
export interface PatchRequest {
  analysis_id: string | null;
  intent_index: number;
  expected_revision: number;
}
export interface ApproveRequest {
  patch_digest: string;
  baseline_digest: string;
  /**
   * @maxItems 500
   */
  expectation_revision_ids: string[];
}
export interface InputFile {
  path: string;
  content: string;
  kind: "sql" | "source";
}
export interface InputRequest {
  /**
   * @maxItems 200
   */
  files: InputFile[];
  /**
   * @maxItems 200
   */
  sql_order: string[];
  expectations: ExpectationManifest | null;
}
export interface ScanReport {
  id: string;
  input_revision: number;
  source_manifest_digest: string;
  analyzer_version: string;
  complete: boolean;
  /**
   * @maxItems 500
   */
  finding_ids: string[];
  created_at: string;
}
export interface Column {
  name: string;
  type: string;
  not_null: boolean;
  identity: string;
  generated: string;
  default_expression: string | null;
  owner_fk: boolean;
}
export interface Policy {
  name: string;
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  permissive: boolean;
  /**
   * @maxItems 500
   */
  roles: string[];
  using: string | null;
  check: string | null;
}
export interface Table {
  schema: string;
  name: string;
  owner: string;
  rls_enabled: boolean;
  force_rls: boolean;
  /**
   * @maxItems 2000
   */
  columns: Column[];
  /**
   * @maxItems 500
   */
  primary_key: string[];
  /**
   * @maxItems 500
   */
  constraints: {
    name: string;
    kind: string;
    definition: string;
  }[];
  /**
   * @maxItems 500
   */
  policies: Policy[];
  grants: {
    authenticated: {
      SELECT: boolean;
      INSERT: boolean;
      UPDATE: boolean;
      DELETE: boolean;
    };
    anon: {
      SELECT: boolean;
      INSERT: boolean;
      UPDATE: boolean;
      DELETE: boolean;
    };
  };
  /**
   * @maxItems 500
   */
  foreign_keys?: {
    /**
     * @maxItems 32
     */
    columns: string[];
    schema: string;
    table: string;
    /**
     * @maxItems 32
     */
    target_columns: string[];
    deferrable: boolean;
  }[];
}
export interface SchemaSnapshot {
  id: string;
  digest: string;
  /**
   * @maxItems 50
   */
  tables: Table[];
  postgres_version: string;
  admitted_schema_digest?: string;
  replay_profile?: "repository-v2" | "repository-v3";
  bootstrap_version?: "legacy-v1" | "supabase-database-v1";
  replay_sql_digest?: string;
}
export interface AdmittedInputs {
  schema_sql: string;
  /**
   * @maxItems 400
   */
  expectation_edits: ExpectationEdit[];
  /**
   * @maxItems 500
   */
  manifest: {
    path: string;
    kind: "sql" | "source";
    bytes: number;
  }[];
  /**
   * @maxItems 500
   */
  credential_findings: Finding[];
  synthetic_demo: boolean;
  /**
   * @maxItems 500
   */
  credential_fingerprints: CredentialFingerprint[];
  sql_analysis?: SQLAnalysis;
  replay?: ReplayManifest;
}
export interface CredentialFingerprint {
  finding_id: string;
  fingerprint: string;
}
export interface SQLAnalysis {
  id: string;
  input_revision: number;
  complete: boolean;
  replay_ready: boolean;
  replay_reason: string | null;
  statements: number;
  /**
   * @maxItems 50
   */
  tables: SQLTable[];
  /**
   * @maxItems 500
   */
  policies: SQLPolicy[];
  /**
   * @maxItems 2000
   */
  grants: SQLGrant[];
  /**
   * @maxItems 2000
   */
  diagnostics: SQLDiagnostic[];
  created_at: string;
}
export interface SQLTable {
  schema: string;
  name: string;
  rls_enabled: boolean | null;
  /**
   * @maxItems 2000
   */
  columns: {
    name: string;
    type: string;
    owner_fk: boolean;
  }[];
}
export interface SQLPolicy {
  schema: string;
  table: string;
  name: string;
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  /**
   * @maxItems 100
   */
  roles: string[];
  permissive: boolean;
  broad_using: boolean | null;
  broad_check: boolean | null;
  /**
   * @maxItems 100
   */
  helpers: string[];
  path: string;
  line: number;
}
export interface SQLGrant {
  schema: string;
  table: string;
  role: string;
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  granted: boolean;
}
export interface SQLDiagnostic {
  path: string;
  line: number;
  statement: number;
  code: string;
  construct: string;
  message: string;
}
export interface ReplayManifest {
  profile: "repository-v3";
  bootstrap_version: "supabase-database-v1";
  source: ImportSource;
  /**
   * @minItems 1
   * @maxItems 200
   */
  files: {
    path: string;
    bytes: number;
    digest: string;
  }[];
  digest: string;
}
export interface JobPayload {
  finding_id: string | null;
  patch_id: string | null;
  expected_finding_revision: number | null;
  expectation_set_revision: number;
  import_request?: ImportRequest;
}
export interface ImportRequest {
  source: ImportSource;
  selection: ImportSelection | null;
  retry_of: string | null;
}
export interface ImportSelection {
  root: string;
  /**
   * @maxItems 500
   */
  sql_order: string[];
}
export interface JobEnvelope {
  job: Job;
}
export interface FindingsResponse {
  /**
   * @maxItems 500
   */
  findings: Finding[];
}
export interface ProjectsResponse {
  /**
   * @maxItems 500
   */
  projects: Project[];
}
export interface RunResponse {
  run: Run;
  /**
   * @maxItems 2000
   */
  results: TestResult[];
}
export interface ProjectView {
  project: Project;
  /**
   * @maxItems 500
   */
  findings: Finding[];
  /**
   * @maxItems 400
   */
  expectations: Expectation[];
  /**
   * @maxItems 500
   */
  jobs: Job[];
  /**
   * @maxItems 500
   */
  patches: MigrationPatch[];
  /**
   * @maxItems 500
   */
  runs: Run[];
  snapshot: SchemaSnapshot | null;
  /**
   * @maxItems 500
   */
  input_manifest: {
    path: string;
    kind: "sql" | "source";
    bytes: number;
  }[];
  /**
   * @maxItems 500
   */
  imports?: ImportReport[];
  sql_analysis?: SQLAnalysis | null;
  summary?: ProjectSummary | null;
}
export interface ImportReport {
  id: string;
  project_id: string;
  job_id: string;
  status: "queued" | "discovering" | "complete" | "failed" | "interrupted";
  provenance: ImportProvenance;
  files_analyzed: number;
  bytes_analyzed: number;
  credential_findings: number;
  /**
   * @maxItems 20000
   */
  exclusions: ImportExclusion[];
  /**
   * @maxItems 500
   */
  roots: ImportRoot[];
  /**
   * @maxItems 500
   */
  orm_metadata: string[];
  selected_root: string | null;
  /**
   * @maxItems 500
   */
  sql_order: string[];
  rls: {
    status: "pending" | "ready" | "missing_schema" | "choice_required" | "unsupported_sql" | "replica_failed";
    reason_code: string | null;
  };
  error_code: string | null;
  sql_profile: "repository-v2" | "repository-v3";
  created_at: string;
  input_revision: number;
}
export interface ImportProvenance {
  kind: "local" | "github";
  label: string;
  commit: string | null;
  workspace_digest: string | null;
}
export interface ImportExclusion {
  path: string;
  reason:
    | "dependency"
    | "generated"
    | "binary"
    | "archive"
    | "model_weight"
    | "symlink"
    | "submodule"
    | "oversized"
    | "unsupported_encoding"
    | "unsupported_file"
    | "missing"
    | "unsafe_path"
    | "rescan_scope_gap";
  bytes: number | null;
}
export interface ImportRoot {
  path: string;
  kind: "supabase" | "migrations" | "schema";
  /**
   * @maxItems 500
   */
  files: string[];
  ordered: boolean;
  complete: boolean;
}
export interface ProjectSummary {
  id: string;
  input_revision: number;
  expectation_set_revision: number;
  status: "available" | "unavailable" | "pending";
  model: string;
  model_digest: string;
  prompt_version: string;
  output: ProjectSummaryOutput | null;
  reason_code: string | null;
  duration_ms: number;
  created_at: string;
}
export interface ProjectSummaryOutput {
  summary: string;
  /**
   * @maxItems 5
   */
  priorities: {
    finding_id: string;
    explanation: string;
  }[];
  /**
   * @maxItems 10
   */
  limitations: string[];
  /**
   * @maxItems 5
   */
  next_steps: string[];
}
export interface FindingView {
  finding: Finding;
  /**
   * @maxItems 500
   */
  patches: MigrationPatch[];
  /**
   * @maxItems 500
   */
  runs: Run[];
}
export interface SessionResponse {
  csrf_token: string;
}
export interface DeleteResponse {
  deleted: boolean;
}
export interface ExportReport {
  schema_version: "1.0";
  finding: Finding;
  /**
   * @maxItems 500
   */
  runs: RunResponse[];
  /**
   * @maxItems 500
   */
  patches: MigrationPatch[];
}
export interface OllamaTags {
  /**
   * @maxItems 500
   */
  models: {
    name: string;
    model?: string;
    digest: string;
    modified_at?: string;
    size?: number;
    capabilities?: string[];
    details?: {
      parent_model?: string;
      format?: string;
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
      context_length?: number;
      embedding_length?: number;
    };
    remote_model?: string;
    remote_host?: string;
  }[];
}
export interface OllamaEnvelope {
  model?: string;
  created_at?: string;
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  message: {
    role?: string;
    content: string;
    thinking?: string;
    /**
     * @maxItems 0
     */
    tool_calls?: unknown[];
    /**
     * @maxItems 0
     */
    images?: string[];
  };
  prompt_eval_cached_count?: number;
}
export interface CredentialContextFacts {
  credential_type:
    | "api_key"
    | "database_credential"
    | "jwt_secret"
    | "private_key"
    | "client_secret"
    | "cloud_credential"
    | "privileged_backend_credential"
    | "unknown_secret";
  literal: boolean;
  exposure: "frontend" | "backend" | "config" | "unknown";
  placeholder: boolean;
  public_identifier: boolean;
  strong_secret_signal: boolean;
}
export interface RescanRequest {
  expected_input_revision: number;
  complete: true;
  /**
   * @maxItems 200
   */
  deleted_paths: string[];
  /**
   * @maxItems 200
   */
  files: InputFile[];
}
export interface EmptyRequest {}
export interface RlsFixtureLabels {
  id: string;
  gold: {
    cross_read?: "allow" | "deny";
    cross_delete?: "allow" | "deny";
    foreign_insert?: "allow" | "deny";
    reassign?: "allow" | "deny";
    profiles_all_auth?: "allow" | "deny";
    profiles_all_anon?: "allow" | "deny";
    unknown_all?: boolean;
    inferred_select?: boolean;
    public_suppressed?: boolean;
    broken_controls?: boolean;
    /**
     * @maxItems 1000
     */
    vulnerability: string[];
    /**
     * @maxItems 1000
     */
    rules: string[];
  };
  purpose: string;
}
export interface RlsFixtureResult {
  id: string;
  duration_ms: number;
  /**
   * @maxItems 1000
   */
  failures: string[];
  gold_testable: number;
  agreement: number;
  expected_inconclusive: number;
  correct_inconclusive: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  static_rules_required: number;
  static_rules_found: number;
  run: Run;
  /**
   * @maxItems 2000
   */
  results: TestResult[];
}
export interface DetectorRecipe {
  id: string;
  recipe:
    | "provider_invalid_marker"
    | "db_invalid_host"
    | "jwt_invalid_signature"
    | "pem_invalid_material"
    | "cloud_invalid_pair"
    | "client_secret_sentinel"
    | "public_client_id"
    | "publishable_identifier"
    | "placeholder"
    | "env_reference"
    | "content_hash"
    | "public_certificate";
  positive: boolean;
  synthetic: true;
  purpose: string;
}
export interface ContextFixture {
  id: string;
  synthetic: true;
  purpose: string;
  facts: CredentialContextFacts;
  positive: boolean;
  expected_classification: ("likely_secret" | "public_identifier" | "placeholder" | "uncertain") | null;
}
export interface AdversarialFixture {
  id: string;
  input_class: "malicious" | "unexpected" | "edge" | "invalid";
  purpose: string;
  expected: "reject_or_inert_no_unsafe_action";
}
export interface AIFixture {
  id: string;
  kind: "declared" | "inferred" | "credential" | "unknown";
  repetitions: 3;
  /**
   * @maxItems 4
   */
  rubric: string[];
}
export interface DatasetManifest {
  id: string;
  version: 1;
  created_at: string;
  suites: {
    /**
     * @maxItems 100
     */
    detector: string[];
    /**
     * @maxItems 100
     */
    context: string[];
    /**
     * @maxItems 100
     */
    rls: string[];
    /**
     * @maxItems 100
     */
    adversarial: string[];
    /**
     * @maxItems 100
     */
    ai: string[];
  };
  /**
   * @maxItems 200
   */
  files: {
    path: string;
    sha256: string;
    bytes: number;
  }[];
  /**
   * @maxItems 100
   */
  variants: string[];
  /**
   * @maxItems 20
   */
  limitations: string[];
}
export interface EvalCounts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  gold_testable: number;
  agreement: number;
  expected_inconclusive: number;
  correct_inconclusive: number;
  response_attempts: number;
  accepted_responses: number;
  inspected_sinks: number;
  leaked_canaries: number;
  unsafe_actions: number;
}
export interface EvalCase {
  id: string;
  suite: "detector" | "context" | "rls" | "adversarial" | "ai";
  status: "passed" | "failed" | "incomplete";
  duration_ms: number;
  /**
   * @maxItems 200
   */
  failures: string[];
  counts: EvalCounts;
  rls: RlsFixtureResult | null;
  ai_analysis: AIAnalysis | null;
}
export interface EvaluationReport {
  schema_version: "1.0";
  id: string;
  suite: "deterministic" | "ai";
  status: "complete" | "failed" | "incomplete";
  dataset_id: string;
  dataset_digest: string;
  commit: string;
  harness_version: string;
  registry_version: string;
  prompt_version: string;
  model_tag: string;
  model_digest: string;
  postgres_image: string;
  hardware: Hardware;
  runtime: Runtime;
  created_at: string;
  duration_ms: number;
  /**
   * @maxItems 200
   */
  cases: EvalCase[];
  /**
   * @maxItems 20
   */
  missing_suites: string[];
  /**
   * @maxItems 20
   */
  limitations: string[];
  gpu_peak_used_mib: number | null;
  gpu_samples: number;
  human_faithfulness_rubric: "not_applicable" | "pending_human_review";
  model_parameters: {
    temperature: 0;
    context_tokens: 4096;
    output_tokens: 768;
    thinking: false;
    streaming: false;
    deadline_ms: 30000;
    max_attempts: 2;
    warm_state: "not_controlled_includes_load";
  };
  implementation_digest: string;
  working_tree_dirty: boolean;
}
export interface Hardware {
  os: string;
  arch: string;
  cpu: string;
  ram_bytes: number;
  gpu: string | null;
}
export interface Runtime {
  node: string;
  pnpm: string;
  docker: string;
  ollama: string;
}
export interface EvaluationResponse {
  /**
   * @maxItems 10
   */
  reports: EvaluationReport[];
}
export interface ParserEnvelope {
  sql: string;
  ast: {
    version: number;
    /**
     * @maxItems 2000
     */
    stmts: {
      stmt: {
        [k: string]: {};
      };
      stmt_location?: number;
      stmt_len?: number;
    }[];
  };
}
export interface RehearsalReport {
  schema_version: "1.0";
  id: string;
  commit: string;
  implementation_digest: string;
  working_tree_dirty: boolean;
  hardware: Hardware;
  runtime: Runtime;
  model_tag: string;
  model_digest: string;
  postgres_image: string;
  prompt_version: string;
  dataset_id: string;
  dataset_digest: string;
  created_at: string;
  label: "PRERECORDED FALLBACK — actual local-replica browser runs; not live";
  status: "complete" | "failed";
  /**
   * @minItems 1
   * @maxItems 3
   */
  runs: {
    ordinal: number;
    status: "passed" | "failed";
    duration_ms: number;
    owned_resources_remaining: number;
    /**
     * @maxItems 10
     */
    artifacts: {
      kind: "video" | "report_json" | "report_markdown";
      path: string;
      digest: string;
    }[];
  }[];
  /**
   * @maxItems 20
   */
  limitations: string[];
}
export interface ImportStatus {
  job: Job;
  report: ImportReport;
}
export interface GithubTree {
  sha: string;
  url: string;
  /**
   * @maxItems 100000
   */
  tree: {
    path: string;
    mode: "100644" | "100755" | "040000" | "160000" | "120000";
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
    url: string;
  }[];
  truncated: boolean;
}
export interface RuntimeState {
  pid: number;
  port: number;
}
export interface ProjectInvestigateRequest {
  input_revision: number;
  expectation_set_revision: number;
}
