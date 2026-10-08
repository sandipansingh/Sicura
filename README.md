# Sicura

A local security workbench for credential exposure and PostgreSQL row-level security. Import a project, review its intended permissions, compare them with behavior in a disposable replica, and review a repair before exporting it. Local Gemma provides advisory analysis; recorded database observations determine verification results.

## Install and run

Install the packaged release artifact:

```sh
npm install --global /absolute/path/to/sicura-0.4.0.tgz
sicura doctor
sicura scan .
sicura scan https://github.com/owner/repository
sicura ui
```

Node **24.13.0**, Git, running Docker and local Ollama are required. Prepare the pinned PostgreSQL image and `gemma4:e4b` model using the [installation instructions](docs/architecture.md#repository-import-and-installed-cli). The CLI starts the dashboard, imports saved local files or a pinned GitHub commit, and opens the selected project. Keep its terminal running; stop with Ctrl-C. Use `--no-open` for headless use or `--port 3229` to select another loopback port.

The dashboard opens at **/app**. Its Project screen accepts a GitHub repository URL or ordered schema-only SQL and optional source/configuration files. No database connection string or production credentials are required. Unsupported migrations, excluded files, and partial coverage have explicit reasons.

## Analyze a project

1. Run `sicura scan <directory|GitHub URL>`, use **Import project**, or upload files and select **Analyze files**. For uploads, review SQL ordering and optionally supply an expectation manifest.
2. Review the automatic **Gemma Analysis — advisory** summary on Project and open its linked findings. Gemma explanations never establish verified access. Review **Findings** and the import coverage in **Project**. Source is analyzed statically and never executed; credential findings are redacted and validity is not tested.
3. Review **Expected Access** for each actor and operation. Save your intended permissions. Unknown intent skips dependent probes; inferred intent remains qualified. Mark intentionally public access explicitly.
4. Select **Run local verification** and review the scope dialog. Sicura uses synthetic rows and checked low-privilege identities in disposable local PostgreSQL replicas. Inspect recorded outcomes in **Verification Runs**.
5. Open a finding to review **AI Analysis — advisory** separately from **Verified Evidence — local replica**. Gemma proposals become active only after your review and Save.
6. For a supported repair, select **Review suggested patch** and inspect the migration and its baseline. **Approve and apply to replica** runs the reviewed patch against a fresh local replica, then repeats the recorded scenarios and regressions.
7. Export the migration and redacted reports for your project workflow. Export downloads a file; it does not deploy the migration.

A fresh verification rebuilds the submitted migrations. Replica-only apply does not edit your project: if the original inputs still reproduce the mismatch, the current finding returns to confirmed and the earlier approved retest remains in history.

For imported projects, select **Rescan repository** to read the current saved scope without hundreds of uploads. Ignored or excluded files do not establish credential removal. For uploaded credential findings, expand **Rescan complete source scope** and submit replacement files or explicit deletions under **Rescan complete source scope**. Removal applies only to the submitted scope; issuer rotation, Git history, and published artifacts remain unverified. **Delete local project** removes the local project records and private identities. Downloaded files have independent retention.

## Develop from a checkout

Prerequisites: Node **24.13.0**, pnpm **10.29.1**, running Docker and Ollama. In a separate terminal, start Ollama if needed:

```sh
ollama serve
```

From the repository root:

```sh
pnpm run setup
pnpm run dev
```

Open **http://127.0.0.1:3000** and select **Open workbench**. Setup installs frozen dependencies, pulls the pinned multiarchitecture PostgreSQL image and exact model artifact, installs Playwright Chromium, and checks the environment. Preparation requires Internet access; prepared verification uses local artifacts. Jobs create and destroy their own replicas.

No `.env` file is required. Runtime pins are in `config/runtime-lock.json`; `.env.example` is an archived preparation record. The scripts allowlist inherited environment settings before starting the worker and Next.js. Existing `PROOFSEC_*` settings, application-data locations, schema identifiers, and stored projects retain compatibility. CLI links select their exact project at `/app?project=<id>`; older root-project links redirect.

Stop the development server before running build or browser checks because Next.js holds a project-directory lock.

| Command                     | Purpose                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run check:env`        | Verify runtime versions, Docker readiness, and the model digest                                                              |
| `pnpm run verify`           | Contracts, lint, formatting, strict types, unit/integration tests, smoke, production build, and browser workflows            |
| `pnpm run package`          | Build the installable `sicura-0.4.0.tgz` artifact                                                                            |
| `pnpm run test:package`     | Install into an empty consumer and check the compiled CLI, dashboard, verification, approval, export, redaction, and cleanup |
| `pnpm run test:integration` | Check disposable replicas and adversarial cases                                                                              |
| `pnpm run test:e2e`         | Exercise project entry and the complete review workflow through the browser                                                  |
| `pnpm run eval`             | Run the internal fixture evaluation tooling                                                                                  |

## Architecture and limitations

The Next.js dashboard exposes a thin, validated loopback API. A single worker owns container and model jobs; SQLite stores redacted metadata, admitted secret-free SQL, and immutable evidence. Gemma receives redacted structured facts and returns schema-validated JSON. Application code renders fixed probes and remediation templates; the model has no SQL, tool, or request executor. See the [specifications](docs/README.md) and [AI component](skills.md).

- Repository imports support bounded SQL/PLpgSQL routines, triggers, procedural migrations and Supabase database helpers in the isolated replica. Routine bodies remain transient; verification rereads the original migration digests. Changed files require Rescan repository.
- Complex migration chains receive bounded static SQL analysis and file/line diagnostics even when replica replay is unsupported. AST declarations are distinct from observed catalogue and verified evidence.
- Exactly `RLS_MISCONFIGURATION` and `CREDENTIAL_EXPOSURE` are supported. The SQL admission profile covers a bounded set of base-table schemas, constraints, defaults, indexes, and ordered policy migrations. Unsupported semantics are rejected or marked not testable.
- Verification runs only in disposable local replicas with synthetic rows and controlled identities. It does not reproduce production routes, JWT issuance, hooks, storage, edge functions, live data, or every business predicate.
- Only the owner-SELECT remediation template is implemented. Other repairs require manual review in your project workflow. Unknown intent, invalid prerequisites, errors, and timeouts never establish denied access.
- Credential analysis and removal are static only. Credentials are never used; validity, revocation, production compromise, history, and published-bundle removal are not established.
- Gemma can misunderstand facts or fail validation. The interface shows AI unavailable and preserves independent deterministic work. Human AI quality review remains pending.
- Full SQL replacement in an existing project is unsupported; create a new project. Complete source rescans retain the upload limits even when a repository import covers more files.
- Local project records expire after 24 hours; the running worker sweeps expired idle records. Replicas are destroyed after jobs, with orphan reconciliation. These are cleanup policies, not forensic-erasure guarantees.
- Linux x64 execution has been checked on Ryzen 7 7840HS / RTX 4060 Laptop hardware. Apple M4/macOS and Windows execution, and a full accessibility audit, remain unperformed.

Current limits, reproduced failures, and stable error codes are maintained in [Security and safety](docs/security-and-safety.md). Internal evaluation records retain their original [report](https://github.com/sandipansingh/Sicura/blob/main/eval/reports/REPORT.md), [dataset manifest](https://github.com/sandipansingh/Sicura/blob/main/eval/datasets/v1.manifest.json), and provenance. They describe a small synthetic corpus and do not estimate production accuracy. Evaluation is developer tooling, separate from the product interface.

## License and provenance

Project code, fixtures, and evaluation tooling use [Apache-2.0](LICENSE). Gemma is downloaded separately; model weights are not redistributed. Bundled fonts include their SIL Open Font License notices. See [NOTICE](NOTICE) and [skills.md](skills.md) for artifact provenance.

Codex assisted with implementation, tests, and documentation. The user supplied and reviewed the architecture/security specifications and retains project ownership. Human review of critical implementation logic is still pending; automated checks do not establish that review. The [OWASP mapping](docs/security-and-safety.md#reference-framework-mapping) records scoped coverage, without certification or endorsement.

`sicura scan .` collects saved source and migrations automatically. Imported projects do not show file-upload controls; use **Rescan repository** after saving changes. Manual file admission is available only when adding a project without a repository import.
