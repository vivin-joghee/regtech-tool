# Claude Code Review Handoff

Repository: `regtech-tool`
Date: 2026-05-01
Author: GitHub Copilot review

## Purpose

This file captures concrete review findings in the Python pipeline so Claude Code can make focused fixes without re-doing the initial analysis.

## Scope

Primary review target:

- `pipeline/generate_synthetic_data.py`
- `pipeline/train_model.py`
- `pipeline/validate_scenarios.py`

Reference implementation for rule semantics:

- `worker/src/rules/engine.ts`
- `worker/src/rules/types.ts`
- `worker/src/db/schema.ts`

## Priority Order

1. Fix validator correctness.
2. Remove generator reproducibility drift.
3. Fix trainer categorical coverage.
4. Remove threshold-selection leakage.

## Findings

### 1. Validator does not match worker verdict semantics

Severity: High

Files:

- `pipeline/validate_scenarios.py:38`
- `pipeline/validate_scenarios.py:127`
- `pipeline/validate_scenarios.py:189`
- `worker/src/rules/engine.ts:76`
- `worker/src/rules/types.ts:171`

Problem:

- `aggregate_verdict()` only treats rule IDs containing `SANCTIONS` as `block`.
- The worker treats verdict aggregation generically via verdict ordering, not via a `SANCTIONS` substring heuristic.
- `actual_contradiction_type()` marks any dual-alert case as type `A`, but the worker records a contradiction whenever US and SG verdicts differ.
- The validator fetches rows from `jurisdiction_contradictions` but then recomputes contradiction type from alerts instead of using the persisted contradiction object as the ground-truth result of replay.

Impact:

- Scenario validation can report false mismatches even when the worker is correct.
- SG risk-based rules that block can be mis-scored as flag-only.
- `block` vs `flag` mismatches can be miscategorized as type `A` instead of contradiction.

Expected fix shape:

- Make validator verdict aggregation consistent with worker verdict ordering.
- Prefer persisted contradiction rows when determining whether an actual contradiction exists.
- If recomputation remains necessary, mirror worker logic exactly rather than approximate it.

Acceptance criteria:

- Validator output agrees with worker contradiction semantics for `allow`, `flag`, and `block` mismatches.
- A transaction with `US=block, SG=flag` is not treated as type `A` agreement.
- SG risk-based rule hits can produce `block` in the validator.

### 2. Generator is not reproducible for a fixed seed

Severity: High

Files:

- `pipeline/generate_synthetic_data.py:54`
- `pipeline/generate_synthetic_data.py:75`
- `pipeline/README.md:37`

Problem:

- `generate_synthetic_data.py` loads `decision_threshold` from prior artifacts in `pipeline/models/metadata.json` or `worker/data/model-metadata.json`.
- That threshold feeds expected verdict generation.
- As a result, the same `--seed` can produce different outputs depending on local artifact state.
- This contradicts the README claim that scripts are deterministic for a given seed.

Impact:

- Fresh clones and previously-trained worktrees can generate different ground truth.
- Review and debugging become stateful and harder to trust.
- The generation step implicitly depends on earlier training outputs.

Expected fix shape:

- Remove hidden dependence on previous model artifacts from the generator.
- Best options:
  - pass the ML threshold explicitly as a CLI argument with a documented default, or
  - store a pinned threshold in a committed config file used by generation, or
  - split “generate scenarios” from “annotate using trained model threshold” into separate steps.
- Update README to reflect the real workflow.

Acceptance criteria:

- Running generation twice with the same seed and no code changes produces identical outputs regardless of local model artifact state.

### 3. Trainer categorical levels are incomplete relative to generated data

Severity: Medium

Files:

- `pipeline/train_model.py:100`
- `pipeline/train_model.py:101`
- `pipeline/generate_synthetic_data.py:97`
- `pipeline/generate_synthetic_data.py:98`
- `pipeline/generate_synthetic_data.py:216`
- `pipeline/generate_synthetic_data.py:227`
- `pipeline/generate_synthetic_data.py:265`
- `pipeline/generate_synthetic_data.py:276`

Problem:

- Trainer hard-codes:
  - `CHANNEL_LEVELS = ["FAST", "GIRO", "SWIFT", "CHIPS", "FEDWIRE", "ACH"]`
  - `DOMICILE_LEVELS = ["SG", "US", "ID", "PH", "IR", "KP", "VE", "CU"]`
- Generator emits additional values:
  - channels: `CASH_USD`, `CASH_SGD`
  - domiciles: `MY`, `RU`, `SY`

Impact:

- Generated transactions with those values are silently collapsed into an implicit all-zero bucket.
- This throws away signal in scenarios that depend on cash handling or specific domiciles.
- The feature schema is fragile and can drift again later.

Expected fix shape:

- Add missing known levels now.
- Add a guardrail that compares observed categorical values to configured levels and fails loudly or maps unknowns into an explicit `OTHER` bucket.

Acceptance criteria:

- Trainer either encodes all observed levels explicitly or rejects unseen values with a clear error.
- Cash channel transactions are represented in the feature space.

### 4. Threshold tuning leaks test-set information into deployed policy

Severity: Medium

Files:

- `pipeline/train_model.py:337`
- `pipeline/train_model.py:347`
- `pipeline/train_model.py:597`
- `pipeline/train_model.py:617`

Problem:

- Decision threshold is selected by maximizing F1 on the test split.
- That threshold is then persisted and used by downstream components.

Impact:

- Reported performance is optimistic.
- Persisted threshold is partially fit to the evaluation set.

Expected fix shape:

- Split data into train, validation, and test.
- Tune threshold on validation only.
- Evaluate once on test using the frozen threshold.

Acceptance criteria:

- Saved threshold is derived from validation, not test.
- Metrics printed for test are based on a threshold chosen before test evaluation.

## Implementation Notes

- Keep fixes narrow and behavioral.
- Do not rewrite the whole training pipeline.
- Preserve current file formats unless a change is needed to fix one of the findings.
- If you need to change generated artifact schema, update any reader in `worker/data` consumers as part of the same change.

## Suggested Validation Steps

1. Run pipeline static validation after edits.
2. Run `python pipeline/generate_synthetic_data.py --seed 42` twice from a clean state and compare outputs.
3. Run `python pipeline/train_model.py --seed 42` and verify categorical coverage checks pass.
4. If DB access is configured, run `python pipeline/validate_scenarios.py` after replaying worker scoring and confirm contradiction handling matches worker behavior.

## Nice-to-Have Improvements

- Add a small unit-testable helper module for shared verdict aggregation rules instead of duplicating logic between scripts.
- Add a smoke test that asserts generated categorical values are a subset of the trainer’s configured categories.
- Add a reproducibility note to the README covering which steps depend only on seed and which depend on trained artifacts.