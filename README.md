# Strait Compliance — Jurisdiction-Aware AML Monitoring Tool

NTU MH6822 Regulatory Technology — Assignment 1 (Option A: Working Prototype)

---

## Submitted by

| | |
|---|---|
| **Name** | Vivin Joghee |
| **Matriculation number** | G2505378K |
| **NTU email** | VIVIN001@e.ntu.edu.sg |
| **Personal email** | vivinjoghee@gmail.com |

---

## Where to find things

### Live demo

| | URL |
|---|---|
| Web application (Cloudflare Pages) | https://strait-compliance.pages.dev |
| Backend API (Cloudflare Worker) | https://strait-compliance-worker.vivinjoghee.workers.dev |
| Health endpoint (verifies the deployment) | https://strait-compliance-worker.vivinjoghee.workers.dev/api/health |
| Source repository (GitHub) | https://github.com/vivin-joghee/regtech-tool |

The web application is the simplest entry point — open it in any modern browser. No login required. All data is synthetic.

### Submitted documents (delivered separately to the professor)

| Document | Purpose |
|---|---|
| `Task1_SelectionAndResearch.docx` / `.md` | Entity selection (Standard Chartered) and US ↔ Singapore regulatory divergence analysis |
| `Task2_ValuesAudit.docx` / `.md` | Hypothetical company persona (Strait Compliance Pte. Ltd.) and four-question values audit |
| `Task3_Architecture.md` (in this repository) | Detailed architecture and design rationale for the prototype |
| `Strait_Compliance_Presentation.pptx` | Slide deck |

> Tasks 1 and 2 are submitted as separate `.docx` / `.md` files outside this repository. Task 3 is included here as `Task3_Architecture.md` because it documents the implemented system itself.

---

## What the tool does

The tool scores every cross-border transaction in parallel against **two independent regulatory rule packs** — one for the United States (BSA / OFAC / AMLA 2020) and one for Singapore (CDSA / TSOFA / MAS Notice 626). Each rule pack produces its own verdict (`block` / `flag` / `allow`) with cited reasons. When the two regimes reach **different verdicts**, the tool records a **contradiction** for human review rather than silently picking one side.

This addresses a real-world failure mode that has produced large enforcement actions against the chosen reference institution (Standard Chartered: 2012 USD$327M, 2014 USD$300M, 2019 USD$1.1B, 2024 follow-up): the same transaction may be lawful in one regime and a violation in another, and a single-jurisdiction monitoring system has no language for the disagreement.

### Key design primitives

- **Rule pack SHA-256** is stamped on every persisted alert. A YAML rule change creates a new SHA, so every historical alert is traceable to the exact rule version that produced it.
- **Model SHA-256** is stamped on every persisted alert with the auto-tuned decision threshold from the model card. Re-training produces a new SHA without overwriting prior history.
- **Plain-English narrative** is generated server-side per alert from rule citations, customer attributes, and the structured contradiction (when present).
- **TreeSHAP attributions** are pre-computed during training and rendered as horizontal bars in the alert drawer — every flag explains which features pushed the score up vs down.

See [`Task3_Architecture.md`](Task3_Architecture.md) for the full design.

---

## Repository structure

```
regtech-tool/
├── Task3_Architecture.md          # Architecture & design (Task 3 deliverable)
│
├── pipeline/                      # Offline Python pipeline (data + ML)
│   ├── generate_synthetic_data.py # Reproducible synthetic data generator
│   ├── seed_neon.py               # Loads parquet → Neon Postgres
│   ├── train_model.py             # LightGBM training + TreeSHAP + ONNX export
│   ├── validate_scenarios.py      # Compares engine output vs expected verdicts
│   ├── data/                      # Generated dataset (parquet + CSV) + dataset card
│   └── SCENARIO_DESIGN.md         # Scenario taxonomy + contradiction targets
│
├── worker/                        # Cloudflare Worker (TypeScript backend)
│   ├── config/us.yaml             # United States rule pack (BSA / OFAC / AMLA)
│   ├── config/sg.yaml             # Singapore rule pack (CDSA / MAS Notice 626)
│   ├── src/                       # Hono router + Drizzle ORM + rule engine
│   ├── data/                      # Bundled model artefacts (predictions + card)
│   ├── RULES_VERIFICATION.md      # Primary-source verification log per rule
│   └── TEST_CASES.md              # Verified-only test scenarios
│
└── web/                           # Cloudflare Pages (React + Vite frontend)
    └── src/                       # Tailwind UI, alert drawer, SHAP chart, model card
```

---

## How to inspect the system

The fastest way to evaluate the tool is the live demo URL above. The pages, in suggested order:

1. **Dashboard** — counts of transactions, alerts, contradictions; key audit SHAs.
2. **Jurisdiction config** — side-by-side US and SG rule packs with citations, current SHA-256 of each YAML.
3. **Transactions** — paginated list of the 1,000 synthetic transactions. Click any row to open the alert drawer with the plain-English narrative + per-jurisdiction verdicts + SHAP chart.
4. **Alerts** — the persisted alerts table with per-row rule pack SHA and model SHA visible.
5. **Contradictions** — the cases where US and SG verdicts diverged. Click into any row to see the contradiction shape (e.g. `US block / SG allow`) and the regulatory pattern that produced it.
6. **Model card** — automatically generated from the training pipeline; mirrors `model-metadata.json` verbatim. Performance, recall by typology, jurisdictional validation, hyperparameters, top-20 features by global SHAP.

---

## Synthetic data

All transactions, customers, and "sanctioned" entities in this project are **synthetic** and produced by a deterministic Python generator (`pipeline/generate_synthetic_data.py`). No real bank data, real OFAC list, real MAS feed, or real customer PII is used.

The generator is reproducible: same `--seed` produces byte-identical parquet output (UUIDs are seeded). 1,000 transactions are distributed across 11 scenario categories engineered to exercise specific regulatory divergences — see [`pipeline/SCENARIO_DESIGN.md`](pipeline/SCENARIO_DESIGN.md). A dataset card is provided at [`pipeline/data/README.md`](pipeline/data/README.md).

---

## Verification discipline

A guiding rule of this project: **no rule is encoded from memory**. Every regulatory specific in the YAML rule packs and the supporting documentation is traced to a primary-source quotation in [`worker/RULES_VERIFICATION.md`](worker/RULES_VERIFICATION.md). Items marked **UNVERIFIED** in that file are flagged identically in the source documents (notably, the exact MAS Notice 626 paragraph reference for Singapore PEP scope) — they are deliberately not asserted with confidence in either the engine or the writeup. This discipline applied at the document level is the same discipline applied to the rule engine itself.

---

## Stack

- **Frontend** — Vite 6, React 18, Tailwind CSS 4, TanStack Query 5, shadcn-style components, Recharts. Deployed to Cloudflare Pages.
- **Backend** — Cloudflare Worker (TypeScript), Hono router, Zod validators, Drizzle ORM. Deployed to Cloudflare Workers.
- **Database** — Neon Serverless Postgres (region: `ap-southeast-1`), Drizzle migrations.
- **Pipeline** — Python 3.14, LightGBM, SHAP, scikit-learn, ONNX export.
- **Source** — single GitHub repository at https://github.com/vivin-joghee/regtech-tool.

---

## Contact

For any questions about this submission, please contact me at **VIVIN001@e.ntu.edu.sg** or **vivinjoghee@gmail.com**.
