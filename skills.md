# AI component: Gemma investigation skills

This file documents Sicura's AI component (FR-21 / `ai-layer-gemma.md`). It grants no authority to execute arbitrary code. The implemented workbench handles exactly `RLS_MISCONFIGURATION` and `CREDENTIAL_EXPOSURE`.

## Model and rationale

Gemma 4 E4B runs locally through Ollama, text-only. It supplies explanation and context interpretation while application code controls observations and executable actions. Local inference uses bounded redacted facts and avoids a dependency on a hosted model.

E4B is the user-required choice in [D-06](docs/decisions-and-open-questions.md). Its pinned quantization ran on the tested laptop's 8,188MiB RTX 4060 within the measured task deadline; the measurements below establish that hardware fit for this corpus. No comparative quality or speed benchmark against E2B or larger variants was performed. Keeping this model local also permits the prepared workbench to run without a hosted inference service.

Tested artifact: `gemma4:e4b`, Q4_K_M, digest `dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c`; Ollama 0.35.1. The active pin is [config/runtime-lock.json](config/runtime-lock.json); drift is rejected. The earlier optional `proofsec-gemma` alias is not the product runtime.

Google DeepMind authors the model. The [official Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) identifies Apache-2.0 licensing; [Ollama's selected tag](https://ollama.com/library/gemma4:e4b) is the distribution used here (checked 2026-10-06). Project code and model licensing are separate; weights are not committed.

## Position and tasks

Source/schema → deterministic redaction/analyzers → structured finding → Gemma → strict JSON and semantic validation → advisory explanation/proposals. Application code independently generates the complete eligible verification matrix. A human reviews an application-rendered migration before replica apply. Gemma receives no database credentials and has no tools, shell, browser or arbitrary request executor.

- Explain redacted catalogue/source facts and cite existing evidence IDs.
- Interpret context and propose an inactive Expected Access Model edit.
- Describe potential impact, advisory severity/confidence and uncertainties.
- Form a falsifiable hypothesis and recommend a fixed registry test ID.
- Suggest a typed remediation intent with known policy/owner bindings.

Gemma cannot establish intent, activate proposals, suppress findings, author SQL, invent test IDs, approve a patch or confirm vulnerability state. AI Analysis and Verified Evidence have distinct contracts, API fields and UI panels.

## Run and settings

Start Docker and Ollama; install the pinned Node/pnpm versions. From a prepared checkout:

```sh
ollama pull gemma4:e4b
ollama show gemma4:e4b
pnpm run check:env
pnpm run dev
```

If Ollama is not already running, use `ollama serve` in a separate terminal. The adapter uses `http://127.0.0.1:11434/api/chat`, JSON Schema as `format`, `stream=false`, `think=false`, temperature 0, context 4096 and output limit 768. One concurrent call, 30 seconds per attempt, at most one schema-correction retry and 65 seconds overall. No model switch/canned response occurs on failure. Keep-alive is five minutes. Temperature zero does not establish identical prose across devices/backends.

Implementation: [ollama.ts](packages/core/src/ai/ollama.ts), prompt version **4**, canonical [JSON Schemas](packages/contracts/contracts.schema.json). The input is a small allowlisted projection of facts, expectation provenance and supplied limits; comments/raw source/credential values are absent. Identifiers are untrusted data. Responses pass duplicate-key rejection, Ajv 2020-12 unknown-key rejection, registry/evidence/resource/owner checks, secret redaction and independent inferred-wording checks. The narrowed generation schema helps output shape but does not replace application validation.

## Measurement and known quality limits

Measured host: Ubuntu/Linux x64, Ryzen 7 7840HS, 14.4GiB RAM, RTX 4060 Laptop 8,188MiB, driver 595.91.07, Node 24.13.0, pnpm 10.29.1, Docker 29.6.2 and Ollama 0.35.1.

The frozen four-case corpus runs three live repetitions each and reports all attempts, schema/whitelist-valid accepted responses, observed latency and one-second GPU sampling. The [stabilized prompt-v4 measurement](https://github.com/sandipansingh/Sicura/blob/main/eval/reports/evaluation_2c4c4facd4974cd4930a87d24671daa7.json), measured on the Ryzen 7 7840HS / RTX 4060 laptop with Ollama 0.35.1 at baseline `f91e8c0`, accepted 12 schema/whitelist-valid responses in 12 attempts; median 4,290.37ms, nearest-rank p95 5,048.24ms, peak 4,671MiB device-used from 56 samples. Reference and inferred-wording validation also passed; human faithfulness scoring remains pending. Timings include fixture/harness overhead and uncontrolled warm/load state. Device sampling is not an allocator high-water mark. The [generated report](https://github.com/sandipansingh/Sicura/blob/main/eval/reports/REPORT.md) preserves run provenance and earlier measurements; these recorded figures are not re-labeled as a run of the later submission commit.

Earlier prompt v1 responses misunderstood a constant-true policy despite passing JSON/reference checks. Prompt versions 2/3 also produced rejected inferred wording. These failures are retained and documented. Prompt v4 distinguishes intended access from observed catalogue facts, requires inferred qualification and constrains uncertainties to supplied limitations. **Human faithfulness review is pending**; there is no human quality score. An accepted response can still misunderstand the schema. Invalid/unavailable output shows **AI analysis unavailable** while deterministic work persists.

Verification establishes only the recorded local scenario with synthetic rows and simulated claims. Real JWT issuance, production data, hooks, custom claims, storage and unsupported SQL can differ. Credential confirmation is static classification, never validity or account compromise. M4 results are not reported as tested-host measurements.

## Reproduce or modify

```sh
pnpm run test:ai
pnpm exec tsx scripts/ai-preflight.ts
pnpm exec tsx scripts/ai-preflight.ts --inferred
pnpm run eval:deterministic
pnpm run eval:ai
pnpm run eval:report
```

The frozen dataset hashes are checked before runs. Reports include source digest/commit baseline/dirty flag, model/image/dataset pins, prompt/registry/harness versions, settings and hardware. The human rubric stays pending even if all calls validate. Recorded test outputs never appear as live product AI.

1. Change prompts only in the adapter and increment provenance. Keep schema/reference/qualification checks and failure behavior. Rerun live calls on the labeled test host and preserve earlier failures.
2. Change model/license only through a reviewed decision, exact artifact pin and new hardware measurements.
3. Adding a test requires an application registry entry, canonical enum/schema, fixtures and documentation together. Gemma cannot add tests at runtime.
4. Adding remediation requires a typed intent, renderer, AST scope checks, approval bindings and regression counterexamples. No free-form SQL executor.
5. Publish only executed case counts with separate detector/context/verification denominators and explicit missing suites. Human reviewers must evaluate prose faithfulness separately from validators.

See [AI contract](docs/ai-layer-gemma.md), [verification](docs/security-and-safety.md#verification-engine), [remediation](docs/security-and-safety.md#remediation-and-retest), [evaluation](docs/security-and-safety.md#testing-and-evaluation) and [threat model](docs/security-and-safety.md).
