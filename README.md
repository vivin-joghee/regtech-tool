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

## Acknowledgements and AI-use disclosure

This is a collaborative effort. Domain expertise, source selection, regulatory verification, and final accountability for the submission are mine. The build, deployment, and document production were materially accelerated by AI tools, used under my direction and reviewed by me at every checkpoint. The split is recorded here so the assessor can weigh each contribution accurately.

### Domain expertise (mine, not the AI's)

- **Five years at Standard Chartered Bank.** The choice of entity was not arbitrary — I worked at SCB for five years, which shaped the selection of the bank, the corridor pair (US ↔ Singapore), and the failure-mode framing around cross-jurisdictional monitoring. The chosen reference case is the closest public mirror of a problem I have direct operational familiarity with.
- **Ground-work for the AML news trail.** I gathered the enforcement-history references myself — the 2012 USD$327M action, the 2014 USD$300M *failure-to-remediate* penalty, the 2019 USD$1.1B settlement, and the 2024 MAS follow-up after the S$3B Singapore money-laundering case — and chose which to include based on their relevance to the divergence argument.
- **Manual verification of links and citations.** Every URL in the writeups and the rule packs was checked manually for resolution. Where an AI tool drafted a citation that contradicted what I found on the regulator's actual page (most notably the Singapore "S$20,000 general bank CTR" claim, which is wrong — the S$20,000 figure belongs to the PSPM Act, not MAS Notice 626 for banks), I corrected the text by referring to the primary source directly. The discipline that the rule engine and the writeups now apply (`worker/RULES_VERIFICATION.md`) is the operational form of that correction process.
- **Python background.** The pipeline architecture (parquet for typed columns, seeded UUIDs for reproducibility, train/val/test split with threshold tuned on validation, ONNX export) is the kind of code I have written professionally. AI accelerated the writing; the decisions were ones I would have defended without AI in the room.

### AI tools used

| Tool | Used for |
|---|---|
| **Claude Code (Anthropic)** in VS Code | Primary coding agent for this project. Wrote, refactored, and verified code across `worker/` (TypeScript rule engine, Drizzle ORM, Hono routes), `web/` (Vite + React + Tailwind), and `pipeline/` (Python data generation, LightGBM training, TreeSHAP, ONNX export). Also produced the YAML rule packs (under my dictation of the regulations), the verification log, the test scenarios, the architecture documents, the one-page summary, the senior-management deck, and the speaker notes. Drove the `wrangler` CLI to deploy the Worker and Pages site to Cloudflare. |
| **Neon MCP server** | Database operations against the live Neon Postgres instance: schema inspection, alert and contradiction queries, verification that deployed model SHAs matched on-disk artefacts. Used throughout the development loop and again for the final audit checks before submission. |
| **`wrangler` CLI (driven via Claude Code over Bash)** | Cloudflare deployment — Workers, Pages, and secret management. Authentication (`wrangler login`) was done manually in my browser; the deploy commands and the `DATABASE_URL` secret push were automated under my direction. |
| **Claude (Anthropic, web app)** | Initial framing of the task choice and the entity-selection arguments for Task 1. |
| **ChatGPT (OpenAI)** | Independent review pass on Task 1 and Task 2. Produced the validation-findings documents (`Task1_…_Validation_Findings.md`, `Task2_…_Validation_Findings.md`) which I then triaged finding-by-finding. Where its review caught real errors against the verified source trail (the S$20K threshold, the CDSA s.39 → s.45 amendment, the OCC 2026-13 overstatement), the corrections were applied. Where its review flagged something that did not match what I found on the regulator's site, I overrode the suggestion and recorded the rationale. |
| **`python-docx` and `python-pptx`** (driven by Claude Code) | Generation of the `.docx` and `.pptx` deliverables programmatically, including embedded matplotlib charts and speaker notes — so the documents track the source data automatically rather than being hand-edited in Word/PowerPoint. |

### The ML side — what I deliberately did NOT hand-tune

For the LightGBM scorer in `pipeline/train_model.py`, I left the model to determine its own internals rather than imposing my priors on it:

- **Feature selection** — I supplied 44 candidate features (amount, channel one-hots, domicile one-hots, PEP / sanctions booleans, velocity windows, customer risk ratings). LightGBM's gain importance and TreeSHAP decide which ones actually move the score. The global feature-importance chart on the model-card page is the model's own answer, not mine.
- **F1-optimal decision threshold** — `tune_threshold_on_validation()` sweeps the precision-recall curve on the validation split and picks the threshold that maximises F1. The number that lands in `model-metadata.json` (currently 0.5960) was chosen by the model, not by me.
- **Per-feature SHAP attribution** — TreeSHAP attributes the gap between each row's score and the model's base value across the 44 features. This is what the alert drawer renders. I do not hand-label features as "important" — the algorithm does.

The only place I overrode the model was in the label function (`make_label()` in `train_model.py`): I excluded two sub-shapes (`ofac_only_low_signal`, `tbml_low_signal`) from the ML positive set because they are deterministically detected by the rule engine, and training ML to flag them too would have collapsed the `US block / SG allow` and `US allow / SG block` contradiction shapes back into less informative `block / flag` forms. That override is documented in the function's docstring and is itself a defensible engineering choice — but it is the only place I bent the model to fit the demo rather than the other way around.

### What I verified personally

- Every regulatory citation in the YAML rule packs against the primary source (CFR, MAS, SPF/STRO, ACRA, OCC).
- Every URL in Task 1, Task 2, and Task 3 — many had to be replaced because regulator sites restructure paths. Where the deep link no longer resolves, I left a search hint to the regulator's stable landing page.
- The Standard Chartered enforcement-history figures by reading the original DOJ, NYDFS, Fed, and MAS press releases / consent orders, not summaries.
- The `RULES_VERIFICATION.md` corrections log — every "WRONG / CORRECTION REQUIRED" entry in that file came out of me catching a difference between an AI-generated draft and a primary regulator page.
- The contradiction distribution (36 / 18 / 12 / 12) by querying the live database myself before reporting it.

### Net effect

The result is a working prototype that I could not have built alone in the time available, and that the AI alone would not have produced correctly without my domain context (most visibly: the S$20K Singapore CTR error that survived the AI's first draft because the AI did not know that figure traces to the PSPM Act and not to bank cash flows). My contribution is the regulatory accuracy, the architectural choices that bound what the tool will and will not claim, and the boundary discipline that distinguishes verified rules from unverified ones. The AI's contribution is the velocity of putting that discipline into running code and presentable documents.

The submission is mine; the help is acknowledged.

---

## Contact

For any questions about this submission, please contact me at **VIVIN001@e.ntu.edu.sg** or **vivinjoghee@gmail.com**.
