# Repository instructions

Read `docs/README.md` and the relevant binding specs before changing behavior: `docs/architecture.md` (requirements/architecture/import), `docs/finding-model-and-lifecycle.md` (glossary/contracts/expectations/lifecycle/UI), `docs/ai-layer-gemma.md` (AI), `docs/security-and-safety.md` (security/detection/verification/remediation/testing/errors/limits), and `docs/decisions-and-open-questions.md` (decisions). `decisions-and-open-questions.md` owns choices; the other specs own design. D-20 governs tier order. One builder builds now; a bug-fixer works afterwards. Do not delegate implementation to additional agents.

## Non-negotiable boundaries

- Exactly `RLS_MISCONFIGURATION` and `CREDENTIAL_EXPOSURE`; use `finding-model-and-lifecycle.md` vocabulary and `finding-model-and-lifecycle.md` wording and its UI workflow requirements.
- Gemma returns untrusted schema-validated JSON only. No model-authored SQL, tools or arbitrary requests. Test IDs are the fixed registry in `security-and-safety.md`; application code renders typed remediation intents.
- Verification uses only disposable local replicas, synthetic rows and checked low-privilege non-owner/non-superuser/non-BYPASSRLS identities. Never accept production credentials or use discovered credentials.
- Own-row/operation controls establish valid prerequisites. Errors, missing rows without validated controls, timeouts and SQLSTATE ambiguity are never denial.
- Redact before every sink. Raw source/secrets never enter persistence, model requests, UI, logs, evidence, exports or snapshots. Reject secret-bearing executable SQL instead of executing an approximation.
- Expected Access Model is explicit: declared/inferred/unknown. Unknown prevents dependent probes; inferred remains qualified; Gemma proposals are inactive until human save. Confirmation requires an expected-deny/observed-allow mismatch.
- Separate AI analysis from immutable verified evidence in contracts, API and UI. Model failures must preserve deterministic work and show AI unavailable; no canned AI output.
- Human approval binds exact patch/baseline/expectation digests before replica-only apply. Identical scenarios and passing regressions gate `fixed`. Migration export is a file, never deployment.

## Engineering and handoff

TypeScript strict; JSON Schema 2020-12/Ajv at every boundary; generated TypeScript types; reject unknown and duplicate keys. Parse hostile SQL with the PostgreSQL AST admission allowlist; parameters for values and catalogue-quoted identifiers. No arbitrary user/AI SQL fragments in the harness.

Pin Node/pnpm/dependencies, model provenance and the PostgreSQL **multiarchitecture index digest**. Scripts are cross-platform Node, files LF. Native SQLite/M4 install is verified on actual hardware; never claim an unperformed check.

Use unit tests and real pinned PostgreSQL integration tests, adversarial cases and the flagship Playwright flow. Reproduce a bug, add a meaningful failing test, fix, run `pnpm run verify`, update current limitations in `security-and-safety.md`, then commit. `main` stays green; build on short-lived branches. Tag completed milestones only after checks pass. Never force-push main.

Keep the six surviving docs current in each milestone commit; `security-and-safety.md` owns current limitations, reproductions and stable error codes. The user-authorized consolidation supersedes historical obligations in unchanged `decisions-and-open-questions.md` to maintain deleted handoff/progress/release material. Every failing/skipped/flaky check is documented with reproduction and affected files. Stable error codes and allowlisted structured log context only. Report measured counts/latency with dataset/runtime/hardware labels; do not invent evaluation results or overclaim production coverage.
