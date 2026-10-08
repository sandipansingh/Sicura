# Glossary, findings and lifecycle

Sicura is the product name (D-27). The dashboard and browser title use Sicura with an S logo initial. Finding vocabulary, exact workflow wording, persisted contracts and internal identifiers remain unchanged.

## Glossary

These definitions are normative across the documentation.

| Term                                    | Definition                                                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finding                                 | A versioned record of a suspicious static fact or demonstrated mismatch. Its existence does not imply exploitability. Categories are only `RLS_MISCONFIGURATION` and `CREDENTIAL_EXPOSURE`.                                                                      |
| Detection                               | Deterministic recognition of a fact, such as an applicable permissive policy with a constant-true condition, or a credential-shaped literal.                                                                                                                     |
| Investigation                           | Interpretation of redacted facts and context. May combine deterministic classification with visibly attributed AI analysis.                                                                                                                                      |
| AI analysis                             | Untrusted Gemma explanation, impact assessment and suggestions. Never observation evidence.                                                                                                                                                                      |
| Attack hypothesis                       | A falsifiable statement about an actor performing a specific operation on a target, paired with an application test ID. A credential hypothesis is static and has no executable test ID.                                                                         |
| Expected Access Model                   | Versioned developer declarations or visible heuristic expectations describing permitted actors and operations for each resource.                                                                                                                                 |
| Expectation                             | One `(resource, actor, operation)` access rule with an explicit source and revision. `own_rows_only` means access is allowed to the actor's rows and denied to other users' rows.                                                                                |
| Declared expectation                    | An expectation explicitly supplied or confirmed by a human through an imported manifest or the UI. Its source is `declared`.                                                                                                                                     |
| Inferred expectation                    | A visible deterministic heuristic that has not been confirmed as developer intent. Source is `inferred`; any mismatch must retain that qualifier.                                                                                                                |
| Unknown expectation                     | No sufficient statement of intended access; source and expected value are `unknown`. Verification for that operation is not scheduled.                                                                                                                           |
| Expectation proposal                    | An inactive suggestion, including every Gemma-produced expectation. It becomes active only by an explicit user action; accepting it creates a declared expectation.                                                                                              |
| Resource                                | A schema-qualified base table, represented as separate `schema` and `table` fields, never as executable SQL text.                                                                                                                                                |
| Table classification                    | `user_owned`, `public_read`, `shared_team`, or `unknown`; a descriptive signal, not authorization by itself.                                                                                                                                                     |
| Intentionally public                    | A human declaration allowing a specific operation to a specific actor on all rows. Public read never implies public writes.                                                                                                                                      |
| Suppression                             | An auditable visibility overlay (`intentionally_public`, `placeholder`, or `accepted_risk`) on a finding; not a verification result or a lifecycle state.                                                                                                        |
| Actor                                   | The identity attempting an operation: synthetic `user_a`, `user_b`, or `anon`. Both users use the low-privilege `authenticated` database role.                                                                                                                   |
| Target                                  | A synthetic row or proposed owner associated with another identity. Target is not a database endpoint.                                                                                                                                                           |
| Replica                                 | A disposable local database populated with the supplied admitted schema and synthetic data. It never contains production credentials or a copy of production data.                                                                                               |
| Role simulation                         | A transaction setting a restricted PostgreSQL role and synthetic request claims; it does not authenticate a real JWT or reproduce a full HTTP application.                                                                                                       |
| Full-fidelity mode                      | Optional local Supabase/PostgREST adapter using local JWTs. The name describes improved API fidelity, not equivalence to production.                                                                                                                             |
| Introspection                           | Reading database catalogues after schema application to learn tables, grants, policies, types and relationships.                                                                                                                                                 |
| Whitelisted test                        | An immutable, versioned application implementation from the fixed registry in `security-and-safety.md`. Neither user text nor Gemma supplies its executable body.                                                                                                |
| Test matrix                             | Every applicable registry scenario for each table and established operation expectation, including positive controls and anon probes. Gemma can prioritize but cannot omit entries.                                                                              |
| Positive control / own-row sanity check | An expected-ALLOW operation on the actor's own synthetic row using the same role and operation prerequisites as the negative test. Failure makes the related negative conclusion inconclusive.                                                                   |
| Seed plan                               | Deterministic generated synthetic values, dependency order, identity mapping and constraints, with a stable digest.                                                                                                                                              |
| Static evidence                         | Redacted, directly observed source or catalogue facts. It does not demonstrate database access or credential validity.                                                                                                                                           |
| Verified evidence                       | A captured deterministic observation under recorded preconditions, compared against a versioned expectation. For credentials, use the more specific label “Static exposure evidence.”                                                                            |
| Observation                             | `allow`, `deny`, `error`, or `not_run`. Errors are never treated as denial.                                                                                                                                                                                      |
| Confirmed (`confirmed`)                 | For RLS: expected DENY and observed ALLOW in a valid replica scenario. An inferred expectation remains qualified. For credentials: static exposure of a credential-like literal in a prohibited location is established; validity and exploitation are untested. |
| Not reproduced (`not_reproduced`)       | The unauthorized scenario was denied under valid test prerequisites. It does not assert absence of all vulnerabilities.                                                                                                                                          |
| Blocked (`blocked`)                     | Temporary infrastructure/workflow failure prevents a finding's required step, such as Docker unavailable. This state does not mean access was denied.                                                                                                            |
| Not testable (`not_testable`)           | A required scenario cannot be evaluated with supported semantics, seeding or controls. It is neither a pass nor a denial.                                                                                                                                        |
| Needs expectation (`needs_expectation`) | An RLS finding lacks an active non-unknown access rule for its actor/operation.                                                                                                                                                                                  |
| Suspected (`suspected`)                 | Static suspicion is present but the relevant evidence threshold for confirmation has not been met.                                                                                                                                                               |
| Fixed (`fixed`)                         | A previously confirmed scenario is now denied on the patched replica and required regressions pass. For credentials, a complete static rescan establishes removal from the submitted artifacts only.                                                             |
| Fix not verified (`fix_not_verified`)   | An attempted remediation lacks a passing complete retest; includes still-allowed attacks, failed regressions or unavailable retest evidence.                                                                                                                     |
| Remediation intent                      | A typed patch template and catalogue-bound parameters suggested by Gemma or a deterministic rule. It is not executable model-authored SQL.                                                                                                                       |
| Migration patch                         | Application-rendered, validated SQL plus its baseline digest, scope, explanation and approval record. Applied only to a replica.                                                                                                                                 |
| Retest                                  | Re-execution of an identical versioned scenario against a patched baseline, with the same seed plan, claims, actor, target and expectation revision.                                                                                                             |
| Fix verified                            | UI wording for `fixed`, always scoped to the tested scenario and accompanied by regression results.                                                                                                                                                              |
| Confidence                              | `low`, `medium`, or `high` with a basis. A judgment about evidence strength, not a calibrated probability. AI confidence is separate.                                                                                                                            |
| Severity                                | Potential impact/privilege rank: `info`, `low`, `medium`, `high`, `critical`. Severity is not proof.                                                                                                                                                             |
| Fidelity gap                            | A difference between replica and real application behavior, including data, claims, hooks, storage, functions or extensions.                                                                                                                                     |
| Run                                     | One immutable baseline or retest matrix execution with a manifest and per-case outcomes.                                                                                                                                                                         |
| Job                                     | Asynchronous local work (`queued`, `running`, `succeeded`, `failed`, `cancelled`); these are not finding states.                                                                                                                                                 |
| Redaction                               | Replacing a complete suspected secret span and any derived representations with `[REDACTED]` before persistence or model/UI delivery.                                                                                                                            |
| Synthetic sentinel                      | A conspicuously invalid fixture string such as `TEST_ONLY_NOT_A_KEY`, never a plausible usable credential.                                                                                                                                                       |
| Coverage                                | Counts of planned, executed, skipped, errored and not-testable scenarios, reported with reasons.                                                                                                                                                                 |

## Expected Access Model

Requirements: FR-6, FR-7, FR-9, FR-22. Canonical types below define Expectation and ExpectationProposal; this document owns their semantics.

### Units, values and precedence

One rule applies to exactly one resource, actor (`authenticated|anon`) and operation. All four operations are independent. An imported manifest has `{ "schema_version": "1.0", "expectations": [ExpectationEdit] }`. `ExpectationEdit` contains `resource`, `actor`, `operation`, `expected`, `owner_column`, `team_binding`, `intentionally_public`, and `rationale`; the server assigns stable id, immutable revision_id, numeric revision and timestamp, plus `source=declared`, `origin=manifest|user`, `confirmed_by=local_operator`. The intake screen shows a manifest summary that the user confirms as their intended permissions. SQL comments do not count as declarations.

| Expected value   | Expected ALLOW                          | Expected DENY                                                                    | Requirements                                                                              |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `own_rows_only`  | Actor's rows and inserts owned by actor | Other users' rows, foreign-owner inserts, ownership reassignment to another user | Non-null resolved owner column; authenticated actor                                       |
| `all_rows`       | Every seeded row for this operation     | None solely by row ownership                                                     | Explicit actor/operation; may be declared public                                          |
| `deny_all`       | None                                    | Every seeded row/insert for this operation                                       | No own-row ALLOW control available; operation-validity controls still required            |
| `team_rows_only` | Rows of actor's synthetic team          | Rows of another team                                                             | Membership binding required; v1 stores/reviews intent but does not execute team semantics |
| `unknown`        | Undetermined                            | Undetermined                                                                     | Source must be unknown; no dependent access tests                                         |

For anon, owner-only is invalid because anon has no owner UUID; use `deny_all`, `all_rows` or unknown. UPDATE owner transfer is denied under `own_rows_only` even if the original row belongs to the actor. Changing this business rule requires a future expectation value/test contract, not arbitrary SQL in the manifest.

Precedence: latest explicit human revision > imported declared manifest for that input revision > deterministic inferred rule > unknown. No overwrite of a declared rule by rescan, heuristic or Gemma. A fresh schema digest marks mappings requiring revalidation; changed/missing columns suspend dependent tests. Resolve duplicate manifest tuples as an input error instead of last-write-wins. Policy SQL, names and comments are evidence about implementation, never proof of intended permission.

### Table classification and inferred expectations

Heuristics propose classification deterministically and record individual signals:

| Signal                                                                                             | Classification contribution | Can establish inferred owner-only?                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Single UUID column with FK to `auth.users(id)` plus ownership semantics in column name             | Strong `user_owned`         | Yes for authenticated SELECT only, with visible inference notice                |
| Same column compared with `auth.uid()` in an existing policy plus an unambiguous UUID owner column | Strong `user_owned`         | Yes for authenticated SELECT only; no claim that existing policy defines intent |
| `user_id`/`owner_id` UUID column alone                                                             | Weak `user_owned`           | No; unknown pending review                                                      |
| `team_id` plus membership relationships, multiple plausible owners                                 | `shared_team` or ambiguous  | No; ask for binding/intent                                                      |
| Table name `posts`/`catalog`, or `USING (true)`                                                    | Weak signal only            | No public or private inference from these alone                                 |
| Declared intentionally-public SELECT rule                                                          | `public_read`               | Declaration already governs that actor/operation                                |
| Contradictory strong ownership signals                                                             | `unknown`                   | No                                                                              |

ASSUMPTION: conservative inference is preferable to guessing CRUD intent. Automated inference establishes authenticated SELECT only; INSERT/UPDATE/DELETE and anon remain unknown until declared. The UI offers a human-reviewed “Private user-owned CRUD” preset setting all four authenticated operations to owner-only and all four anon operations to deny-all. Before the user submits, show the eight changes. The demo uses this declared manifest so the full matrix runs.

Heuristic expectations are persisted visibly with `source=inferred`, `origin=heuristic`, rationale and signals. They can be tested without being declared because the result is explicitly conditional on that inference. Default scan settings state “Test visible inferred expectations”; the review screen lists the rules before scheduling. A Gemma proposal is always inactive and displayed separately; accepting it is a human declaration. Gemma never silently creates even an inferred active rule.

### Source, state and copy

| Source     | Scheduling and lifecycle                                                             | Required UI text                                                                    |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `declared` | Eligible; valid mismatch → confirmed                                                 | “Violates the declared expectation…”                                                |
| `inferred` | Eligible with source recorded; valid mismatch → confirmed, with persistent qualifier | “Violates the inferred expectation that …”; action “Confirm or correct expectation” |
| `unknown`  | Skip this operation with `EXPECTATION_UNKNOWN`; finding `needs_expectation`          | “We need your intended access rule before testing this operation.”                  |

The `confirmed` state alone is never rendered without the source badge for an inferred finding. Confirming an inference creates a new declared revision. The previous run retains its inferred wording; rerun before presenting a declared confirmation. Unknown tables still receive catalogue analysis and coverage rows; no blind probes.

### Intentionally-public handling

Human action sets `expected=all_rows`, `source=declared`, `intentionally_public=true` for selected actors/operations. The default “Make reads public” dialog previews SELECT for authenticated and anon; it does not modify writes. Matching static over-broad findings acquire `suppression.reason=intentionally_public` with actor, rationale and expectation revision. They remain inspectable under “Suppressed / intentional” and in evaluation reports. The underlying catalogue fact stays true; a now-allowed read is not a vulnerability.

If a previously confirmed private-read finding is changed to public, preserve its historical confirmation, archive the old projection, and create the current suppressed suspected projection awaiting the new all-rows checks. Do not mark it fixed. Changing public intent back removes the current suppression and schedules fresh evidence. Broad write or credential findings are unaffected.

### Persistence and circularity safeguards

Edits use optimistic concurrency with the active expectation revision. The API resolves every table/column against the current catalogue, validates bindings and appends an audit event (`actor`, `before_revision`, `after_revision`, `reason`, `timestamp`). Active runs continue on their frozen revisions and become stale for the new intent. Patch approvals bind to exact expectation revisions and are revoked on changes.

No inference from “test returned data, therefore intended public.” No Gemma-generated expectation can be activated by the AI response parser. No existing policy is automatically considered the correct business rule. The matrix evaluator takes expected behavior only from the frozen expectation record; observed behavior only from the engine. Static and AI signals never enter the observed field. Test cases in `security-and-safety.md` explicitly attempt all four circular paths and require rejection.

Requirements: FR-13, FR-14, FR-22, FR-23. Types below are normative wire types, not application implementation. JSON uses snake_case. All object keys are required unless a union variant excludes them; absence uses `null`. Runtime validation rejects extra keys, non-finite numbers, unknown enums and invalid references. Identifiers are opaque app-generated strings (1–128 ASCII letters/digits/underscore/hyphen); timestamps are UTC RFC 3339. Digests are 64 lowercase SHA-256 hex characters. Free text is redacted, plain text, at most 4,000 characters/field; arrays at most 500 entries unless explicitly specified otherwise. Run.result_ids and run-result API arrays allow up to 2,000 entries so the 50-table matrix fits. SQL preview max 32 KiB; no arbitrary extension fields.

## Canonical types

```typescript
type Id = string;
type Timestamp = string;
type Digest = string;
type Category = 'RLS_MISCONFIGURATION' | 'CREDENTIAL_EXPOSURE';
type FindingState =
  | 'needs_expectation'
  | 'suspected'
  | 'confirmed'
  | 'not_reproduced'
  | 'blocked'
  | 'not_testable'
  | 'fixed'
  | 'fix_not_verified';
type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
type Confidence = { level: 'low' | 'medium' | 'high'; basis: string };
type Operation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type Actor = 'user_a' | 'user_b' | 'anon';
type Resource = { schema: string; table: string };
type TableClass = 'user_owned' | 'public_read' | 'shared_team' | 'unknown';
type TestId =
  | 'rls.cross_user_read.v1'
  | 'rls.cross_user_update.v1'
  | 'rls.cross_user_delete.v1'
  | 'rls.insert_as_other.v1'
  | 'rls.reassign_owner.v1'
  | 'rls.anon_access.v1'
  | 'rls.own_row_access.v1';
type Expectation = {
  id: Id;
  revision_id: Id;
  revision: number;
  resource: Resource;
  actor: 'authenticated' | 'anon';
  operation: Operation;
  expected: 'own_rows_only' | 'all_rows' | 'deny_all' | 'team_rows_only' | 'unknown';
  source: 'declared' | 'inferred' | 'unknown';
  origin: 'manifest' | 'user' | 'heuristic';
  owner_column: string | null;
  team_binding: {
    row_team_column: string;
    membership_resource: Resource;
    member_user_column: string;
    member_team_column: string;
  } | null;
  intentionally_public: boolean;
  rationale: string;
  signals: string[];
  confirmed_by: Id | null;
  created_at: Timestamp;
};
type ExpectationProposal = {
  resource: Resource;
  actor: 'authenticated' | 'anon';
  operation: Operation;
  expected: Expectation['expected'];
  owner_column: string | null;
  rationale: string;
  evidence_refs: Id[];
};
type Location =
  | { kind: 'database'; resource: Resource; policy_names: string[]; operation: Operation }
  | { kind: 'file'; path: string; line_start: number; line_end: number };
type RlsEvidence = {
  kind: 'rls';
  id: Id;
  rule_ids: string[];
  operation: Operation;
  role: 'authenticated' | 'anon';
  rls_enabled: boolean;
  force_rls: boolean;
  policy_names: string[];
  policy_condition: string;
  grant_summary: string;
  snapshot_id: Id;
};
type CredentialEvidence = {
  kind: 'credential';
  id: Id;
  rule_ids: string[];
  credential_type:
    | 'api_key'
    | 'database_credential'
    | 'jwt_secret'
    | 'private_key'
    | 'client_secret'
    | 'cloud_credential'
    | 'privileged_backend_credential'
    | 'unknown_secret';
  value: '[REDACTED]';
  exposure: 'frontend' | 'backend' | 'config' | 'unknown';
  classification: 'likely_secret' | 'public_identifier' | 'placeholder' | 'uncertain';
  variable_name: string | null;
  redacted_snippet: string;
  validity: 'not_tested';
  use_context: string;
};
type Hypothesis = {
  statement: string;
  actor: Actor | null;
  target: Actor | null;
  operation: Operation | null;
  test_id: TestId | null;
  evidence_refs: Id[];
  origin: 'deterministic' | 'gemma';
};
type DenialMechanism = 'rls_filter' | 'rls_check' | 'grant' | null;
type TestReasonCode =
  | 'NO_ROW_LOCATOR'
  | 'OWNER_BINDING_MISSING'
  | 'TYPE_UNSUPPORTED'
  | 'DEFAULT_UNSUPPORTED'
  | 'CHECK_UNSATISFIED'
  | 'FK_CYCLE_UNSUPPORTED'
  | 'FK_TARGET_UNSUPPORTED'
  | 'FK_DELETE_BLOCKED'
  | 'NO_MUTABLE_COLUMN'
  | 'CLAIMS_UNMODELED'
  | 'TEAM_SEMANTICS_UNSUPPORTED'
  | 'UNSUPPORTED_SCHEMA_SEMANTICS'
  | 'POSITIVE_CONTROL_FAILED'
  | 'CONSTRAINT_OR_SETUP_ERROR'
  | 'AMBIGUOUS_PERMISSION_ERROR'
  | 'OBSERVER_MISMATCH'
  | 'IDENTITY_ASSERTION_FAILED'
  | 'REPLICA_UNAVAILABLE'
  | 'STATEMENT_TIMEOUT'
  | 'CONNECTION_LOST'
  | 'JOB_DEADLINE'
  | 'CANCELLED'
  | 'EXPECTATION_UNKNOWN'
  | 'UNEXPECTED_DB_ERROR';
type TestResult = {
  id: Id;
  run_id: Id;
  scenario_key: Digest;
  test_id: TestId;
  resource: Resource;
  operation: Operation;
  actor: Actor;
  target: Actor | null;
  expectation_id: Id;
  expectation_revision: number;
  expected: 'allow' | 'deny' | null;
  observed: 'allow' | 'deny' | 'error' | 'not_run';
  outcome: 'match' | 'mismatch' | 'inconclusive';
  denial_mechanism: DenialMechanism;
  reason_code: TestReasonCode | null;
  row_count: number | null;
  synthetic_row_aliases: string[];
  sqlstate: string | null;
  control_result_ids: Id[];
  role_assertion_passed: boolean;
  target_existence_passed: boolean;
  duration_ms: number;
  recorded_at: Timestamp;
};
type Run = {
  id: Id;
  project_id: Id;
  kind: 'baseline' | 'retest';
  baseline_run_id: Id | null;
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  mode: 'postgres_role_simulation' | 'supabase_postgrest';
  schema_digest: Digest;
  patch_digest: Digest | null;
  seed_digest: Digest;
  registry_version: '1';
  harness_version: string;
  postgres_version: string;
  image_digest: string;
  claims_digest: Digest;
  expectation_revision_ids: Id[];
  input_revision: number;
  schema_snapshot_id: Id;
  coverage: {
    planned: number;
    executed: number;
    skipped: number;
    errored: number;
    not_testable: number;
  };
  fidelity_gaps: string[];
  result_ids: Id[];
  created_at: Timestamp;
};
// GemmaOutput and MigrationPatch use the complete strict contracts in ai-layer-gemma.md and security-and-safety.md.
type AIAnalysis = {
  status: 'pending' | 'available' | 'unavailable' | 'invalid';
  analysis_id: Id | null;
  model: string | null;
  model_digest: string | null;
  prompt_version: string | null;
  output: GemmaOutput | null;
  reason_code: string | null;
  created_at: Timestamp | null;
};
type Remediation = {
  status: 'none' | 'proposed' | 'approved' | 'applied' | 'failed';
  patch_id: Id | null;
  patch_digest: Digest | null;
  summary: string | null;
  approved_by: Id | null;
  approved_at: Timestamp | null;
};
type RetestResult = {
  kind: 'rls' | 'credential_rescan';
  baseline_run_id: Id | null;
  run_id: Id;
  status: 'passed' | 'failed' | 'not_testable' | 'blocked';
  identical_scenarios: boolean;
  regressions_passed: boolean;
  failed_result_ids: Id[];
  scope: string;
  completed_at: Timestamp;
};
type Finding = {
  schema_version: '1.0';
  id: Id;
  project_id: Id;
  revision: number;
  input_revision: number;
  category: Category;
  title: string;
  severity: Severity;
  severity_basis: string;
  confidence: Confidence;
  source: { kind: 'catalog' | 'source_scan'; analyzer_version: string; rule_ids: string[] };
  location: Location;
  evidence: RlsEvidence | CredentialEvidence;
  context: {
    table_classification: TableClass | null;
    signals: string[];
    limitations: string[];
    redacted_excerpt: string | null;
  };
  expectation: Expectation | null;
  ai_analysis: AIAnalysis;
  attack_hypothesis: Hypothesis | null;
  state: FindingState;
  suppression: null | {
    reason: 'intentionally_public' | 'placeholder' | 'accepted_risk';
    rationale: string;
    actor_id: Id;
    expectation_revision: number | null;
    created_at: Timestamp;
  };
  verification: {
    status: 'not_requested' | 'queued' | 'running' | 'complete' | 'partial' | 'not_applicable';
    latest_run_id: Id | null;
    evidence: TestResult[];
    stale: boolean;
  };
  remediation: Remediation;
  retest_result: RetestResult | null;
  timestamps: {
    created_at: Timestamp;
    updated_at: Timestamp;
    confirmed_at: Timestamp | null;
    fixed_at: Timestamp | null;
  };
};
```

Identifiers obtained from PostgreSQL are stored exactly, limited to the server's identifier byte limit and quoted by the SQL renderer. Paths are normalized relative paths; never host absolute paths. Positive integers are required for revisions and lines; durations/counts are nonnegative. `GemmaOutput` is defined in [Ai layer gemma](ai-layer-gemma.md). A credential rescan's `run_id` references a static ScanReport (`id`, `input_revision`, `source_manifest_digest`, `analyzer_version`, `complete`, `finding_ids`, `created_at`), not an RLS Run.

Cross-field invariants: RLS → database location, rls evidence, catalog source, non-null expectation; unknown intent is an explicit Expectation. Credentials → file location, credential evidence, source_scan, null expectation, `verification.status=not_applicable`, empty verification evidence. `AIAnalysis.output` exists only for `available`. `observed=error|not_run` requires inconclusive and reason; `deny` requires a denial mechanism. `mismatch` means unequal expected/observed allow/deny, never errors. RLS `confirmed` requires a current valid expected-deny/observed-allow result. Credential `confirmed` has no RLS proof requirement. A suppression never creates `fixed`.

Expectation `id` is stable across revisions; `revision_id` identifies one immutable stored revision. Every `expectation_revision_ids` array in Run, MigrationPatch, approval and API contracts contains these immutable revision_id values, not just stable expectation IDs. TestResult stores stable ID plus numeric revision for display/join and must resolve to the same revision row. A project's `expectation_set_revision` advances on every edit batch and guards concurrent editor saves.

Finding identity: deduplicate RLS by project/input lineage/resource/actor/operation, merging rule IDs and retaining individual catalogue facts. Credential identity uses normalized file location, rule family and a local keyed fingerprint; that fingerprint is internal, not exported. A moved credential is detected as a new occurrence and included in removal checks. Historical source scans are not silently merged across revisions.

## Lifecycle

The story stages (Detected → Investigated → Expectation Established → Attack Hypothesis → Verification → Remediation → Retest) are timeline events; they are not additional enum values. Investigation may be unavailable while deterministic verification proceeds.

| From                                                               | Event / owner and precondition                                                                                 | To                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| New RLS                                                            | Analyzer; no established expectation                                                                           | `needs_expectation`                                                                                      |
| New RLS / `needs_expectation`                                      | Expectation Engine; active non-unknown expectation                                                             | `suspected`                                                                                              |
| New credential                                                     | Analyzer; insufficient context for exposure confirmation                                                       | `suspected`                                                                                              |
| New credential / `suspected`                                       | Static analyzer or human contextual review establishes prohibited exposure under `security-and-safety.md`      | `confirmed`                                                                                              |
| `suspected`, `not_reproduced`, `blocked`, `not_testable`           | Verification Engine; valid negative-case ALLOW, positive controls pass                                         | `confirmed`                                                                                              |
| `suspected`, `blocked`, `not_testable`                             | All required negative cases conclusively denied; controls pass                                                 | `not_reproduced`                                                                                         |
| `needs_expectation`, `suspected`, `not_reproduced`, `not_testable` | Required infrastructure fails before conclusion                                                                | `blocked`                                                                                                |
| `suspected`, `blocked`, `not_reproduced`                           | Required scenario structurally unsupported or setup/control error is understood                                | `not_testable`                                                                                           |
| `blocked`, `not_testable`                                          | User repairs prerequisite; scheduler starts fresh baseline                                                     | `suspected` (or `needs_expectation` if intent absent)                                                    |
| `confirmed`                                                        | Human approves patch / begins credential removal workflow                                                      | Remains `confirmed`; remediation status advances                                                         |
| `confirmed`, `fix_not_verified`                                    | Approved patch applied or static replacement input received; retest pending/incomplete/fails                   | `fix_not_verified`                                                                                       |
| `fix_not_verified`                                                 | Retest coordinator; identical attack denied and all regressions pass, or complete static removal rescan passes | `fixed`                                                                                                  |
| `fixed`                                                            | New current valid replica run reproduces the same mismatch, or credential reappears                            | `confirmed`                                                                                              |
| Any                                                                | User changes intent or input schema/source                                                                     | Archive current projection; new revision → `needs_expectation` or `suspected`; old evidence marked stale |

AI output cannot trigger confirmation, suppression, approval or `fixed`. A valid result aggregate prioritizes a confirmed mismatch even if other cases are incomplete; UI retains coverage warnings. Without a mismatch, any required inconclusive case prevents `not_reproduced`; classify supported-but-temporarily-unavailable as `blocked`, supported setup/semantic failure as `not_testable`. Once baseline confirmation exists, an unrelated later failed job does not erase it: retain confirmed baseline with a blocked job, or `fix_not_verified` if a remediation attempt has begun. Retest failure never becomes `not_reproduced`.

Invalid transitions: unknown intent → confirmation; any AI message → evidence state; error/zero-row unvalidated probe → not_reproduced; suspected → fixed; suppression → fixed; stale run/changed expectation → fixed; denied attack with failed own-row regression → fixed. API returns 409 for invalid lifecycle mutations. State writes belong to server reducers, never arbitrary client-supplied state strings.

## Wording

Declared mismatch: “User A retrieved User B's row, violating the declared owner-only SELECT expectation. Reproduced in a local replica of your schema.” Inferred mismatch: “This violates the inferred expectation that profiles is owner-only. Confirm or correct the expectation.” Denial: “The tested unauthorized-read scenario was blocked.” Error: “No access conclusion: the own-row control failed.” Fix: “Fix verified for the tested replica scenarios; own-row access still passes.” Credentials: “Privileged credential-like literal exposed in submitted frontend code; validity was not tested.” Never “your production database is vulnerable” or “your database is secure.”

## UI workflow and wording

This section incorporates former document 10. It owns screen requirements and exact UI copy; D-10/D-20 still govern implementation choices and tier scope.

Repository import extension (D-23–D-26): Project includes a GitHub repository URL → Import form, durable progress/status, pinned commit, independent credential/RLS coverage, exclusions/oversized files, ORM metadata, and a root/order choice form when conventions are ambiguous. Choices are explicit retries against the pinned commit; local choices reuse the CLI-owned server request. Missing SQL, unsupported/incomplete chains and replica failures display fixed reasons and **No passing-test claim**. Supported admission invites expectation review before verification and is not evidence of denied access. Refresh resumes the durable job; failed/interrupted imports provide explicit retry. CLI dashboard URLs select their exact project. Existing evidence, Gemma advisory, unknown/inferred wording and digest-bound approval copy remain authoritative.

Requirements: FR-6–FR-8, FR-13–FR-17, FR-20, FR-24; NFR-7/NFR-10. A serious developer/security workbench, with navigation and review forms. No chat transcript, chat input, assistant avatar or free-form tool execution.

### Navigation and visual system

Header navigation: Project, Findings, Expected Access and Verification Runs (D-30). Header: project name, input revision, local-replica mode, active job status. Persistent scope text on evidence screens: “Local replica • Synthetic data.” Use restrained neutral surfaces, monospace SQL/evidence, readable tables and prominent source labels. The connected dark emerald design uses shared UI components and CSS Modules for the existing workflow panels (D-28).

AI panels have a distinct tinted border and label **AI Analysis — advisory**. Observation panels have a solid border and label **Verified Evidence — local replica**, run ID and timestamp. Static panels say **Static Evidence**; credential evidence says **Static exposure evidence — validity not tested**. Icons, headings and labels carry the distinction even without color. AI prose may not appear inside a verified-evidence card. Raw HTML and remote Markdown images are disabled.

### Screens

#### 1. Project intake / project home

Use input labels “Schema and policies” and “Optional source/config”. Accept bounded ordered schema/policy files, optional source/config and an expectation manifest with a review summary. Display sanitized relative filenames, sizes and order; no source previews or production endpoint/credential fields. Offer “Analyze files” (D-30). Show unsupported constructs before replica work; source analysis can finish independently. GitHub ingress follows the import form above.

Project home replaces input controls with category counts, expected-access coverage, last run, input revision and actions “Replace inputs”, “Review expectations”, “Run verification”, “Delete local project”. State counts exclude suppressed findings by default with a visible suppressed count. No aggregate “security score” or “secure” banner.

Empty: “Add schema and policies to investigate RLS. Source files can be scanned independently.” Error: “This schema uses an unsupported function. No replica verification was performed.” Include statement location and supported-profile link, never unsanitized SQL error text. Docker unavailable shows “Verification setup blocked” and a retry action; credential results remain visible.

#### 2. Findings list

Offer category/state/severity/expectation-source/suppression filters and title, resource, evidence scope and updated time. Use “Potentially over-broad SELECT policy” before evidence; “Cross-user read reproduced in replica.” requires a valid result.

Suppressed public entries show “Intentionally public — declared SELECT access” and remain expandable. Inferred confirmation badge reads “Confirmed against inferred intent,” never a standalone unqualified “Confirmed.” Credential confirmation badge reads “Static exposure confirmed.” Zero findings text: “No findings detected in the submitted scope. See scan coverage and limitations.” If files were skipped, that sentence must include the count.

#### 3. Finding detail (the central story)

1. **Finding:** title/category/severity, resource or relative path, input revision, current/stale status.
2. **Evidence:** catalogue or redacted source facts, rule IDs, policy condition and grants. Never a clickable reveal-secret control.
3. **Why It Matters:** deterministic impact statement qualified by intent and scope; any AI impact is explicitly labeled.
4. **Expectation:** actor/operation/expected/source/revision, ownership binding, rationale; actions “Edit”, “Confirm inferred expectation”, “Mark reads intentionally public”. Unknown shows the access editor before any run button is enabled for that tuple.
5. **AI Investigation:** Gemma model/digest, generated/cached time, explanation, context interpretation, advisory confidence/severity and uncertainties; “Investigate”/“Retry” action. Independent verification remains available if AI fails.
6. **Attack Hypothesis:** actor, target, operation, source and enum test ID. Gemma recommendation gets “Suggested priority”; matrix count stays visible.
7. **Verification (Expected vs Observed):** paired cells for expectation and observation, synthetic row aliases/count, controls, denial mechanism, run ID, role assertion, source revision and coverage. Details expose a read-only application query template with placeholders and synthetic bindings. Errors occupy an “Inconclusive” panel, never a green denied cell.
8. **Remediation:** rendered SQL, changed policy, rationale, baseline hash, expectation revision, risks/regression scope. Buttons “Approve and apply to replica” or “Revise intent”. Unsupported proposal shows guidance with no apply action.
9. **Retest:** before/after comparison on matching scenario keys, own-row and matrix regressions, immutable run links, scoped fix status, “Export migration and report”.

For credentials, expectation section reads “Not applicable — contextual static analysis”; verification reads “Static exposure evidence; no credential use attempted”; remediation has removal guidance; retest is “Rescan submitted files.” Do not show disabled replica buttons that imply the category should eventually be exploited.

#### 4. Expected Access editor

Show a per-table two-actor/four-operation grid, classification, owner/team bindings, source, rationale and a change summary before Save. Disable invalid actor/value combinations. Team-only says “Intent supported; verification not available in v1.”

Gemma proposals appear in a separate drawer labeled “Inactive proposal”; acceptance opens the same editor and requires Save. Public-read action previews SELECT changes for authenticated and anon only. A previously private confirmation warns, factually: “Changing intent archives the old comparison and requires a new run.” Display each expectation revision and who declared it. Never infer public intent from an observed successful read.

#### 5. Verification runs

Show baseline/retest manifest, mode, status, immutable run ID/time, table cases, expected/observed/mechanism/outcome/control and Executed, Skipped, Inconclusive, All views. Report planned/executed/skipped/errors/not-testable with `security-and-safety.md`'s overlapping-count rules.

Run verification dialog summarizes input revision, expectation sources, table count, synthetic data and eligible/skipped counts; primary action “Run local verification.” Buttons disable only while a conflicting mutation job owns the project. Status polling every second; cancel stops work and tears down the replica. After refresh, status comes from the job API. Old run header says “Historical — expectation/schema has changed.”

#### 6. Patch approval and comparison

Show old/new policy, baseline evidence, regression scope, `patch_digest`, baseline digest and expectation revision. Exact approval copy: “Apply this reviewed migration to a disposable local replica, then rerun the recorded scenarios and regressions.” Only “Approve and apply to replica” records server approval; showing the button is insufficient. Stale digest says “The patch or baseline changed. Review the current version.”

Comparison has separate rows for attacks and positive controls; a denied attack with a failed own-row check shows “Fix not verified — own-row access regressed.” Export remains possible as a clearly failed/unverified report; label a migration unverified if applicable. Never imply a failed patch is recommended for production.

#### 7. Engineering evaluation

D-30 removes Evaluation from the release UI and its API. Internal tooling/report files retain dataset/version/model/runtime, actual layer counts, numerator/denominator, fixture expected/actual results, failures and skips/errors. Fixture results remain separate from project evidence; AI validation is separate from deterministic verification. No invented accuracy cards.

### State and result copy

| Wire state          | Badge / supporting copy                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `needs_expectation` | Needs expectation — declare who should access these rows                                                           |
| `suspected`         | Suspected — static facts require contextual verification                                                           |
| `confirmed`         | Confirmed in replica / Confirmed against inferred intent / Static exposure confirmed, depending on category/source |
| `not_reproduced`    | Not reproduced — the tested unauthorized-read scenario was blocked (adapt operation label)                         |
| `blocked`           | Verification setup blocked — no access conclusion                                                                  |
| `not_testable`      | Not testable — reason and affected scope                                                                           |
| `fixed`             | Fix verified in replica / Exposure removed from submitted files                                                    |
| `fix_not_verified`  | Fix not verified — failed or incomplete retest                                                                     |

AI unavailable: “Gemma analysis is unavailable. Deterministic evidence remains available.” Empty verified-evidence panel: “No verification result yet.” Timeout: “The test timed out; access was not classified.” Inferred findings always retain “inferred” through list/detail/export/retest. Success copy never says “secure”, “fully safe”, “guaranteed” or asserts a production exploit.

Accessibility acceptance: keyboard-only intake-to-retest flow, logical heading/focus order, visible focus, aria-live job updates without focus theft, labeled comparison columns, expandable SQL readable by screen readers and sufficient contrast. Responsive narrow view stacks comparisons while retaining expected/observed headers.

The landing page leads to `/app`; loading the flagship from the landing page creates one actual project. Workbench refresh retains the selected project. Verification uses an accessible review dialog with scope and expectation-source counts, focus trapping, Escape dismissal and focus restoration. Immutable run inspection offers All, Executed, Skipped and Inconclusive views and identifies historical input/expectation revisions. Cosmetic status indicators never assert an online replica, current AI availability or passing benchmark without actual data.

D-30 release presentation: the landing page offers Open workbench; Project begins with repository import and file analysis. No sample/demo action or promotional hero appears in Project. The empty Findings screen says “Import a repository or upload files to begin.” Remove repeated decorative workflow subtitles and the technical ticker; use a static product footer. Preserve evidence scope on findings/runs/dialogs, AI advisory labels, declared/inferred/unknown qualification, exact approvals and historical evidence. Existing stored project names and histories are unchanged.

## Static SQL evidence and project overview (D-31)

RLS findings may use source `sql_ast` and evidence kind `rls_static`; catalogue findings still use `catalog` and `rls`. These variants must agree. Static evidence stores normalized declarations and its SQLAnalysis ID, never an observed snapshot. RLS flags may be unknown; direct grant declarations do not establish effective privileges. Unsupported semantics qualify the entire inventory. Static findings retain explicit expectations and cannot become confirmed, fix_not_verified or fixed, contain verification results, bind replica runs or expose executable patches. Unknown intent uses needs_expectation; established intent with unsupported replay uses not_testable.

Project shows active/suppressed/uncertain counts and declaration coverage separately from replica readiness. One actor/operation review entry is not one vulnerability. Explain disabled verification with diagnostic locations. Entry forms are collapsed behind Import another project or analyze replacement files after import; initial project loading is explicit and user-opened intake stays open during file selection. Manual rescan is collapsed; imported projects offer Rescan repository.

Gemma Analysis — advisory is a visible project panel with summary, linked priorities, next steps, limitations, model/status/time/duration and retry. Summary statuses are pending, available or unavailable. Different input/expectation revisions are historical. Pending/failed advice never replaces deterministic evidence. Per-finding Investigate with Gemma remains available. No private reasoning transcript is shown. Existing four tabs, immutable runs, inference qualification and exact approval copy remain binding.

SchemaSnapshot optionally records admitted_schema_digest for current-input matching. Replica failure keeps static findings unobserved and its job failed; ProjectSummary is queued separately and does not turn failure into passing verification.

Imported-project views omit manual file-admission and replacement-file controls entirely. State that files and migrations were collected automatically; Rescan repository refreshes the original source. Manual admission remains available only in project entry without an imported repository.
