# Task 2 Validation Findings

Date: 2026-05-10
Target: `Task2_ValuesAudit.md`
Purpose: review handoff for Claude Code before patching the values-audit document.

## Validation scope

This review checked:

- Internal consistency between Task 2 and the rest of the repo.
- Whether the main legal/regulatory statements are supported by the repo's current verification notes.
- Whether the document overstates any positions beyond what the source trail currently supports.

## Overall assessment

This document is materially stronger than Task 1. Its main issues are narrower and mostly concern:

1. one repeated Singapore regulatory error,
2. a couple of legal overstatements around OCC Bulletin 2026-13 and reputational-risk policy, and
3. one scope inconsistency around `AML/KYC` versus the actual product boundary.

The document is not fundamentally unsound, but it should be tightened before submission.

## Findings

### 1. Material factual error repeated from Task 1: Singapore S$20,000 general bank threshold

Severity: High

Task 2 claim:

- In the jurisdictional misconfiguration section, `Failure shape B` says the system might apply only the Singapore `S$20,000 cash-reporting threshold` to a USD-denominated wire.

Why this is a problem:

- The repo's current verified position is that Singapore banks do **not** have a general bank cash transaction reporting threshold for ordinary bank cash flows.
- The S$20,000 figure belongs to PSPM-related reporting, not a general MAS Notice 626 bank CTR rule.
- The example is also incorrect on the US side because a CTR is a **cash** reporting requirement, not a wire-transfer threshold.

Repo evidence:

- `worker/RULES_VERIFICATION.md` says the Singapore general bank CTR threshold was wrong and has been removed.
- `worker/config/sg.yaml` explicitly states there is intentionally no `currency_transaction` block for Singapore.
- `worker/RULES_VERIFICATION.md` also confirms that US CTR applies only to transactions in currency, not wires.

Recommended correction:

- Rewrite `Failure shape B` so it does not rely on the false `S$20,000` threshold and does not treat a USD wire as a CTR-triggering event.
- A more accurate example would be:
	- misapplying Singapore's suspicion-based STR approach to a transaction that has a US nexus and therefore triggers US sanctions or SAR obligations, or
	- using a true cash transaction example if the goal is to discuss CTR-specific divergence.

### 2. OCC Bulletin 2026-13 argument is too strong in legal effect

Severity: Medium

Task 2 claim:

- The document argues that because OCC Bulletin 2026-13 excludes GenAI and agentic AI from its framework, a bank using an LLM-drafted SAR has no prudential MRM regime to rely on, and that using such an LLM is `prima facie unreasonable`.

Why this is a problem:

- The verified core point is supportable: the guidance puts GenAI and agentic AI outside its scope.
- The next step in the argument goes further than the source trail clearly supports.
- OCC Bulletin 2026-13 is guidance, not a direct legal prohibition on LLM-assisted SAR drafting.

Recommended correction:

- Keep the core claim that GenAI is outside the scope of the guidance.
- Soften the conclusion to something like:
	- `That creates governance ambiguity and raises the burden on a bank to justify the use of LLM-assisted SAR drafting.`
- Avoid phrasing like `prima facie unreasonable` unless a stronger primary source is added.

### 3. Reputational-risk policy phrasing is too definite

Severity: Medium

Task 2 claim:

- The document refers to the `post-2026 reputational-risk rule` as if the legal change is cleanly settled and directly operative in the form described.

Why this is a problem:

- The validated source trail elsewhere in the repo clearly supports an August 2025 White House executive order directing regulators to remove reputation-risk concepts from supervisory materials within a set period.
- That does not cleanly prove the stronger wording used here.

Recommended correction:

- Rephrase to track the verified source more closely, for example:
	- `the post-2025 executive-order-driven rollback of 'reputational risk' as a supervisory concept...`

### 4. `AML/KYC` framing does not match the actual product boundary

Severity: Medium

Task 2 claim:

- The document says the company chose `AML/KYC`.

Why this is a problem:

- Elsewhere in the same document, the product explicitly excludes KYC onboarding and instead integrates with third-party vendors for that capability.
- That means the label is broader than the actual product scope as described.

Recommended correction:

- Narrow the wording to something like:
	- `AML transaction monitoring, with related CDD/EDD and case-management implications`, or
	- explain that `KYC` is being used only in a broad programmatic sense rather than to mean full onboarding/KYB tooling.

### 5. Hypothetical business metrics are acceptable as invention, but they read as factual claims

Severity: Low

Task 2 claim:

- The document gives very specific invented commercial details: Series B amount, customer counts, ARR, TAM, and staffing mix.

Why this is worth noting:

- For the assignment, these are likely acceptable as part of the hypothetical company setup.
- The risk is not factual falsity in the repo sense; the risk is tone. The specificity can read like unsupported market-research claims rather than clearly framed assumptions.

Recommended correction:

- Optional only: add a small framing note that these are assumed planning figures for the hypothetical company rather than externally validated market data.

## What appears strong and supportable

These parts of the document work well and align with the repo's architecture and values choices:

- The primary-perspective framing around the MLRO / CCO as buyer.
- The honesty about consumer harm from false positives and de-risking.
- The inclusion of cross-corridor alert stitching as a substance-over-documentation feature.
- The refusal to automate SAR/STR narrative drafting as a values-driven product choice.
- The overall structure of the failure-mode analysis.
- The closing engagement with the four lecture tensions.

## Suggested patch plan for Claude Code

1. Rewrite `Failure shape B` to remove the false Singapore `S$20,000` general threshold and the incorrect wire-to-CTR logic.
2. Soften the legal conclusions drawn from OCC Bulletin 2026-13.
3. Rephrase the reputational-risk discussion so it matches the verified source trail.
4. Narrow or clarify the `AML/KYC` label so it matches the actual product scope.
5. Optionally add a note that the company-size and TAM figures are hypothetical planning assumptions.

## Bottom line

This document is mostly sound. The main patch is surgical: remove the repeated Singapore threshold error and tone down a couple of legal claims that currently go further than the available support. Once that is done, the values audit should be in much better shape than Task 1.
