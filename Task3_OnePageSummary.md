# Strait Compliance — One-Page Design Summary

*Vivin Joghee · G2505378K · NTU MH6822 · Assignment 1, Option A*

---

## The system at a glance

```
   ┌─────────────────────┐    ┌─────────────────────────┐    ┌────────────────────┐
   │  Synthetic data     │──▶│  Rule engine (TS)        │──▶│  Web UI (React)    │
   │  1,000 txns         │    │  US pack │ SG pack       │    │  alerts            │
   │  84 customers       │    │  + ML score (LightGBM)   │    │  contradictions    │
   └─────────────────────┘    │  + TreeSHAP attribution  │    │  audit trail       │
                              └─────────────────────────┘    └────────────────────┘
                                            │
                                            ▼
                                  Neon Postgres ── SHA-pinned alerts
```

| Metric | Value |
|---|---:|
| Transactions scored | 1,000 |
| Alerts produced | 1,250 |
| Contradictions surfaced | 78 |
| Model ROC-AUC / PR-AUC | 0.97 / 0.93 |
| Rules verified against primary sources | 11 |

---

## Six design choices and why

| # | Choice | Why |
|---|---|---|
| 1 | **Two rule packs side-by-side, not a unified one.** US (BSA/OFAC) and SG (CDSA/MAS) are kept separate YAML files with independent SHAs. | Regulators read their own rules. A unified pack hides which regime fired, which is the question they actually ask. |
| 2 | **Surface contradictions; do not auto-resolve.** When US verdict ≠ SG verdict, the system writes a row to `jurisdiction_contradictions` with status `pending`. | Silently picking the stricter rule debanks legitimate customers; silently picking the looser one exposes the bank. Both failure modes cost more than human review. |
| 3 | **Every alert SHA-pinned to rule pack + model.** Two columns on every alert: `rule_pack_sha`, `model_sha`. | Rule changes and model retrains happen weekly in production. Without pinning, "why did this alert fire on 12 March?" is unanswerable. |
| 4 | **Rule engine + ML, not ML alone.** Deterministic rules (sanctions, CTR, PEP, SAR-floor) catch what the law explicitly forbids. ML catches the long tail (velocity, behavioural deviation, TBML). | A bank cannot tell an examiner "the model decided" for a sanctions block. The rule must be cite-able to a CFR section. ML is for what the rule cannot encode. |
| 5 | **Threshold auto-tuned from the model card, not the YAML.** The deployed F1-optimal threshold ships with `model-metadata.json`. YAML can override per jurisdiction. | Re-training shifts the score distribution. Hard-coding 0.5 (or 0.187, or anything else) silently invalidates every alert after the next retrain. |
| 6 | **Reproducible synthetic data with seeded UUIDs.** `python generate_synthetic_data.py --seed 42` produces byte-identical output every run. | A regulator reading the audit trail in six months must be able to regenerate the exact training set. Unseeded `uuid.uuid4()` made this impossible until that hole was fixed. |

---

## What the divergences look like in practice

The 78 contradictions break down into four shapes, each representing a different regulatory mismatch:

```
US flag / SG block ████████████████████████████████████  36  ← MAS principles-based block where US only flags
US block / SG flag ██████████████████  18                    ← OFAC SDN + co-firing foreign PEP
US block / SG allow ████████████  12                          ← OFAC SDN with weak SG-side signal
US allow / SG block ████████████  12                          ← SG.RBR.TBML where US has no rule lever
```

The shapes are not pre-engineered — they emerge from running real verified rules against synthetic transactions. Their existence is the demonstration.

---

## What the tool intentionally does NOT do

- **KYC onboarding.** Out of scope — better-served by specialist vendors (Onfido / Sumsub / Jumio).
- **LLM-drafted SAR/STR narratives.** OCC Bulletin 2026-13 disclaims governance over GenAI; we will not move that liability onto our clients.
- **EU AMLD coverage.** We have not properly studied the regime; pretending otherwise would be the same intellectual dishonesty the audit trail is designed to prevent.
- **Fictional sanctions designations.** The synthetic dataset uses 7 invented OFAC/MAS entities, but with explicit `ofac_sdn` / `mas_tfs` flags — never claiming a real entity is sanctioned.

These are *boundary* choices, not gaps. Each one is defended because the audit trail must be honest about what is verified and what is not.
