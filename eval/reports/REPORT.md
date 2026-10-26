# Measured evaluation

Counts are from the frozen curated dataset and actual executions. Context injection is separate from detector recipes. No production accuracy claim.
RLS TP/FP/FN/TN count resource/actor/operation vulnerability tuples (expected-deny/observed-allow); agreement counts individual gold-testable scenarios. These are not full static-rule precision metrics. Inconclusive cases stay in their separately stated denominator.

## deterministic: complete

Dataset proofsec-curated-v1-tier1 (2bc3896f89f70d53f477fc2c5891ddb3285a0c931be159193590dcf9ea7f63a6); commit baseline f91e8c0e4d305eb1c7a4bee42ca203f04bd5c1c9; working tree dirty true; implementation digest 40705f2a0cf0a9d7a5a0e985e87aa29f90f7f580179fef648aecb2295a92ec92.

Hardware: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics; linux/x64; RAM 15467515904 bytes; GPU NVIDIA GeForce RTX 4060 Laptop GPU, 595.91.07, 8188 MiB.
Runtime: Node 24.13.0, pnpm 10.29.1, Docker 29.6.2, ollama version is 0.35.1.
Model gemma4:e4b (dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c); image postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826; prompt 4.

| Layer       | Cases | TP / FP / FN / TN | Precision        | Recall           | Agreement / planned testable |
| ----------- | ----: | ----------------- | ---------------- | ---------------- | ---------------------------- |
| detector    |    12 | 6 / 0 / 0 / 6     | 1.0000           | 1.0000           | 0 / 0                        |
| context     |    20 | 10 / 0 / 0 / 10   | 1.0000           | 1.0000           | 0 / 0                        |
| rls         |    13 | 15 / 0 / 0 / 185  | 1.0000           | 1.0000           | 370 / 370                    |
| adversarial |    10 | 0 / 0 / 0 / 0     | N/A (0 eligible) | N/A (0 eligible) | 0 / 0                        |

detector latency (ms): N=12; median 0.86; nearest-rank p95 53.88; min 0.15; max 53.88. Small curated N.

context latency (ms): N=20; median 0.10; nearest-rank p95 1.14; min 0.07; max 1.91. Small curated N.

rls latency (ms): N=13; median 3911.02; nearest-rank p95 4085.85; min 1337.04; max 4085.85. Small curated N.

adversarial latency (ms): N=10; median 1.75; nearest-rank p95 1746.85; min 0.69; max 1746.85. Small curated N.

Expected inconclusive/unknown cases: 42/42. Inspected harness sink projections: 54; leaked canaries: 0; attempted unsafe actions: 0.
AI accepted responses/attempts: 0/0; human faithfulness: not_applicable.
GPU device-used sampled peak: not measured MiB (0 samples, 1-second interval); no allocator high-water mark claimed.

Missing suites: none in this run.

- Synthetic invalid detector recipes; no credential validity tested
- Context candidate injection is separate from end-to-end detector metrics
- 13 RLS base fixtures; R-14 and six target seeder variants not implemented
- Four live AI cases; faithfulness rubric requires human review
- Ten adversarial fixtures; omitted IDs are not claimed
- Nearest-rank p95; small curated N; phase values include harness overhead
- Leak/unsafe-action counts cover only inspected harness boundaries, not arbitrary application behavior
- AI model may misunderstand facts; schema/reference validity is separate from human faithfulness

## ai: incomplete

Dataset proofsec-curated-v1-tier1 (2bc3896f89f70d53f477fc2c5891ddb3285a0c931be159193590dcf9ea7f63a6); commit baseline f91e8c0e4d305eb1c7a4bee42ca203f04bd5c1c9; working tree dirty true; implementation digest 40705f2a0cf0a9d7a5a0e985e87aa29f90f7f580179fef648aecb2295a92ec92.

Hardware: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics; linux/x64; RAM 15467515904 bytes; GPU NVIDIA GeForce RTX 4060 Laptop GPU, 595.91.07, 8188 MiB.
Runtime: Node 24.13.0, pnpm 10.29.1, Docker 29.6.2, ollama version is 0.35.1.
Model gemma4:e4b (dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c); image postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826; prompt 4.

| Layer | Cases | TP / FP / FN / TN | Precision        | Recall           | Agreement / planned testable |
| ----- | ----: | ----------------- | ---------------- | ---------------- | ---------------------------- |
| ai    |    12 | 0 / 0 / 0 / 0     | N/A (0 eligible) | N/A (0 eligible) | 0 / 0                        |

ai latency (ms): N=12; median 4290.37; nearest-rank p95 5048.24; min 3246.03; max 5048.24. Small curated N.

Expected inconclusive/unknown cases: 0/0. Inspected harness sink projections: 0; leaked canaries: 0; attempted unsafe actions: 0.
AI accepted responses/attempts: 12/12; human faithfulness: pending_human_review.
GPU device-used sampled peak: 4671 MiB (56 samples, 1-second interval); no allocator high-water mark claimed.

Missing suites: human_faithfulness_rubric.

- Synthetic invalid detector recipes; no credential validity tested
- Context candidate injection is separate from end-to-end detector metrics
- 13 RLS base fixtures; R-14 and six target seeder variants not implemented
- Four live AI cases; faithfulness rubric requires human review
- Ten adversarial fixtures; omitted IDs are not claimed
- Nearest-rank p95; small curated N; phase values include harness overhead
- Leak/unsafe-action counts cover only inspected harness boundaries, not arbitrary application behavior
- AI model may misunderstand facts; schema/reference validity is separate from human faithfulness
