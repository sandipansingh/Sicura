# Sicura documentation

The local workbench investigates exactly `RLS_MISCONFIGURATION` and `CREDENTIAL_EXPOSURE`. The decisions document owns approved choices; the remaining specifications own design. D-20 governs tier order. Requirements remain binding; design targets are distinguished from implemented coverage.

| Document                                                        | Ownership                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)                                 | Product requirements, runtime/API boundaries and repository import                                   |
| [Finding model and lifecycle](finding-model-and-lifecycle.md)   | Glossary, contracts, expectations, states and required UI wording                                    |
| [Gemma AI layer](ai-layer-gemma.md)                             | Current AI contracts, settings, validation and limits                                                |
| [Security and safety](security-and-safety.md)                   | Admission, detection, seven-test registry, remediation, testing, error codes and current limitations |
| [Decisions and open questions](decisions-and-open-questions.md) | Approved choices, compatibility decisions and open questions                                         |

Read [Decisions and open questions](decisions-and-open-questions.md) first, then the relevant owner. Canonical runtime schemas are in [contracts.schema.json](../packages/contracts/contracts.schema.json); model rationale and supported evaluation results are in [skills.md](../skills.md) and [the measured report](https://github.com/sandipansingh/Sicura/blob/main/eval/reports/REPORT.md).

The decisions document retains historical numbered references: former 00/03/04/10 map to Finding model and lifecycle; 01/02 and REPOSITORY_IMPORT to Architecture; 05/06/07/09/11/12, ERROR_CODES, OWASP_MAPPING and current KNOWN_ISSUES limits to Security and safety; 08/16/17 to the Gemma AI layer and root skills.md; 15 to Decisions and open questions. Historical demo schedules, implementation task maps, handoff/progress/release reports and receipts have been removed. Their references record past build choices, not obligations to recreate those files. The user-authorized consolidation supersedes obligations to maintain deleted material without changing decisions or runtime behavior.

D-28 records the connected frontend and new Sicura repository. The landing page is `/`; the workbench is `/app`. Historical evaluation identifiers and commits remain original provenance even though the new repository begins with one commit; old branches, tags and the Gemini stash are preserved in a local history backup.

D-30 defines the regular release interface: four project-workflow tabs, no demo/evaluation product endpoints, and ordinary upload-based browser coverage. Internal fixture reports remain engineering records; UI simplification does not relax evidence wording or safety boundaries.

## Project analysis release (D-31)

Sicura 0.3.0 separates static SQL declarations, Gemma project advice and observed replica evidence. Complex migrations remain inspectable when replay is unsupported. Project shows a compact overview, statement diagnostics and an automatic Gemma summary; repository rescans reuse the original source. The execution allowlist remains unchanged. See the owner documents below for contracts, privacy and limitations.

## Supabase database replay release (D-32)

Sicura 0.4.0 adds bounded repository-v3 replay, compatible database helpers, restricted routine execution and dependency-aware synthetic seeds. Imported routines remain transient; only replay identities and normalized metadata are retained. Rescan repository upgrades a saved import. Actual catalogue and scenario coverage remain separate from static declarations and Gemma advice.

The 0.4.0 required gate passed 132 unit/integration tests, eight smoke stages and six Playwright cases on the documented Linux host. Package-consumer commands and current scenario limits are maintained in Security and safety; exact artifact/runtime receipts remain local.
The packaged 0.4.0 empty-consumer check and global Linux installation passed. Saved Muvira imports can be refreshed without uploads; real recorded runs retain partial coverage and explicit reasons.
