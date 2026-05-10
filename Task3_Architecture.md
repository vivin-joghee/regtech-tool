# Task 3 — Architecture Sketch (Draft for Review)

> **Working title:** Strait Compliance — Jurisdiction-Aware AML Transaction Monitor
> **Format option:** A — Working Prototype, web app
> **Deployment target:** Cloudflare (Pages + Workers + KV + R2) + Neon Serverless Postgres

This document sketches the architecture before any code is written. It addresses the four mandatory inclusions for Option A:

1. **Jurisdiction configuration layer** — §4
2. **At least one live or simulated data input** — §5
3. **Output that means something different depending on which jurisdiction's rules are active** — §3, §6
4. **Model card / governance documentation stub** — §8

It also operationalises the design choices committed to in `Task2_ValuesAudit.md` — most importantly the cross-corridor alert stitching (included for substance) and the absence of LLM-drafted SAR/STR narratives (excluded for substance).

---

## 1. Architecture overview

```
                      ┌──────────────────────────────────────────┐
                      │             Cloudflare Edge              │
                      │                                          │
   ┌──────────────┐   │  ┌────────────────────────────────────┐  │
   │   Browser    │◄──┼──►        Pages (Frontend)            │  │
   │ (Reviewer or │   │  │   Vite + React + shadcn/ui         │  │
   │  Examiner)   │   │  │   recharts (SHAP plots)            │  │
   └──────────────┘   │  └─────────────────┬──────────────────┘  │
                      │                    │ fetch (JSON)        │
                      │  ┌─────────────────▼──────────────────┐  │
                      │  │    Pages Functions / Workers       │  │
                      │  │  Hono router  +  Zod validation    │  │
                      │  │                                    │  │
                      │  │  /api/transactions  /api/alerts    │  │
                      │  │  /api/score         /api/sar       │  │
                      │  │  /api/jurisdiction  /api/contradict│  │
                      │  │  /api/model-card    /api/audit     │  │
                      │  └──┬──────────┬───────────────┬──────┘  │
                      │     │          │               │         │
                      │  ┌──▼──┐    ┌──▼──┐       ┌────▼────┐    │
                      │  │ KV  │    │ R2  │       │Vectorize│    │
                      │  │     │    │     │       │(optional)│   │
                      │  │US   │    │model│       │typology │    │
                      │  │SG   │    │.onnx│       │ corpus  │    │
                      │  │sancl│    │shap.│       │         │    │
                      │  │feeds│    │.json│       │         │    │
                      │  └─────┘    └─────┘       └─────────┘    │
                      │                                          │
                      │  Replay is browser-driven (Play button)  │
                      │  — no background cron, no idle compute.  │
                      │                                          │
                      └────────────────┼─────────────────────────┘
                                       │
                                       │  HTTPS — @neondatabase/serverless
                                       │  (HTTP for one-shot, WS for tx)
                                       ▼
                      ┌──────────────────────────────────────────┐
                      │        Neon Serverless Postgres          │
                      │      (region: ap-southeast-1, SG)        │
                      │                                          │
                      │  customers · transactions · alerts       │
                      │  jurisdiction_contradictions             │
                      │  audit_log · model_versions              │
                      │                                          │
                      │  branches: main / dev / preview-*        │
                      └──────────────────────────────────────────┘

                      ▲
                      │  wrangler deploy
                      │
   ┌──────────────────┴────────────────────────────────────────┐
   │              Offline Training Pipeline (Python)           │
   │              runs on developer laptop / Colab             │
   │                                                           │
   │   1. generate_synthetic_data.py  →  transactions.parquet  │
   │   2. train_model.py              →  model.onnx + meta.json│
   │   3. compute_shap.py             →  shap_cache.json       │
   │   4. validate_typologies.py      →  validation_report.md  │
   │   5. build_jurisdiction_rules    →  us.yaml, sg.yaml      │
   │                                                           │
   │   Outputs uploaded to R2 + KV via wrangler                │
   └───────────────────────────────────────────────────────────┘
```

## 2. Components, in detail

### 2.1 Frontend (Cloudflare Pages)

- **Stack:** Vite + React 18 + TypeScript, Tailwind CSS, shadcn/ui component library, recharts for plots, react-router for navigation.
- **Why this and not Next.js:** the app is a single-tenant prototype with no server-rendered SEO need. Vite + Pages Functions keeps the bundle smaller and the deploy story simpler — no edge-runtime gotchas with Next's app router on Cloudflare.
- **Routes:**

| Route | Purpose |
|---|---|
| `/` | Landing — explains the tool's scope and limitations honestly (per Task 2 values commitment) |
| `/dashboard` | Live(ish) transaction stream + alert volume + jurisdiction activity heatmap |
| `/alerts` | Filterable alert list — by jurisdiction, severity, typology, status |
| `/alerts/:id` | Alert detail: transaction trail, ML score, **SHAP feature attribution plot**, jurisdiction-by-jurisdiction verdict, **contradiction flag** if US and SG verdicts diverge |
| `/sar-scaffold/:alertId` | Generates an SAR (US) or STR (SG) **scaffold** with structured fields pre-filled and free-text narrative deliberately blank |
| `/model-card` | Renders the model card markdown — what the tool does, what it assumes, where it can fail |
| `/jurisdiction-config` | Read-only view of the active US and SG rule packs — for examiner transparency |
| `/typologies` | Library of patterns the system detects (structuring, smurfing, layering across corridors, sanctions evasion via re-routing) |
| `/audit-log` | Append-only log of all reviewer actions |

### 2.2 API (Pages Functions or standalone Worker)

- **Framework:** [Hono](https://hono.dev/) — Cloudflare-native, ~14 KB, much lighter than Express.
- **Validation:** Zod schemas on every request body and response.
- **Auth:** Cloudflare Access (Zero Trust) gates the whole app to a specific email or Google identity. Inside the app, a single-page session cookie identifies the reviewer for audit-log purposes.
- **Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/transactions?limit&cursor` | Paginated transaction list |
| POST | `/api/transactions/ingest` | Ingest a (simulated) transaction; triggers scoring + alert generation synchronously |
| GET | `/api/alerts?jurisdiction&severity&status` | Filterable alert list |
| GET | `/api/alerts/:id` | Single alert with SHAP attributions and per-jurisdiction verdict |
| POST | `/api/score` | Score an arbitrary transaction payload — used by the replay controller and accessible for testing |
| GET | `/api/jurisdiction-config/:code` | Returns the active rule pack for `US` or `SG` |
| POST | `/api/sar-scaffold/:alertId` | Generates the structured-template SAR or STR scaffold |
| GET | `/api/contradictions` | Lists transactions where US and SG verdicts disagreed |
| GET | `/api/model-card` | Returns model card metadata + signed model SHA-256 |
| GET | `/api/audit-log?cursor` | Paginated audit log |

### 2.3 Storage layer

| Service | Role | Why this and not something else |
|---|---|---|
| **Neon Postgres** (serverless) | Transactional state — customers, transactions, alerts, contradictions, audit log, model versions | Postgres native types fit the domain: `JSONB` for SHAP attributions and raw payloads, `ENUM` for jurisdiction/verdict/status, `TIMESTAMPTZ` for time-travel queries, array columns for in-scope-jurisdictions, CTEs for cross-corridor stitching. Neon's serverless HTTP/WebSocket driver works natively in Cloudflare Workers; Neon branching gives us free dev/preview databases per pull request. Region pinned to **ap-southeast-1 (Singapore)** to keep round-trip latency from the SG Worker POP under ~10 ms. |
| **KV** (key-value) | Jurisdiction rule packs, sanctions-list snapshots, feature flags | Eventually-consistent, globally replicated, ~ms reads — perfect for config that changes daily, not per-request |
| **R2** (object storage) | `model.onnx`, SHAP cache JSON, synthetic dataset Parquet, model card PDF exports | S3-compatible, no egress fees, sized right for ML artifacts |
| **Vectorize** (optional) | Typology corpus for similarity search on alert narratives | Only if there's time — explicitly de-scoped if the calendar is tight |

**Why Neon and not Cloudflare D1:** D1 is fine for a prototype, but the AML domain leans heavily on JSON-shaped data (SHAP attributions, transaction payloads, audit details), array semantics (a transaction may be in scope of `{US, SG}`), and analytical queries (velocity, network features, cross-corridor stitching). Postgres handles all of these natively; SQLite via D1 forces them into TEXT columns and application-side parsing. Neon's serverless HTTP driver removes the operational reason to prefer D1 (proximity to the Worker), leaving only the substantive question — and on substance, Postgres wins.

### 2.4 Offline training pipeline (Python, off-Cloudflare)

Runs on the developer's laptop or Google Colab. Outputs are pushed to R2 and KV via `wrangler` CLI.

- `generate_synthetic_data.py` — produces **1,000 transactions** with embedded known typologies (structuring around US$10K threshold; cross-currency layering through SG hub; PEP-related corporate layering). Hand-rolled generator parameterised so we can scale to 10k or 100k later if Task 4 questioning probes statistical robustness — but 1,000 is the first milestone. **Coordinated with classmates per the data-portion bonus.** Target distribution: ~50 positives across ~10 typology families, ~950 mundane negatives, ~5% positive rate (realistic for AML).
- `train_model.py` — trains a gradient-boosted classifier (LightGBM) on the synthetic dataset. Exports to ONNX.
- `compute_shap.py` — TreeSHAP on the test set + on a "live shadow" set; persists per-transaction feature attributions as a JSON cache the API can read.
- `validate_typologies.py` — checks the model's recall on each known typology family; fails the build if recall on any typology drops below 70%.
- `build_jurisdiction_rules.py` — emits `us.yaml` and `sg.yaml` rule packs from a single source-of-truth schema.

This pipeline is itself a deliverable — it's evidence of the OCC 2026-13 model-development discipline (purpose, data, validation, monitoring) that the lecture deck names.

## 3. Data flow — a single transaction's life cycle

```
  ┌───────────────────────────────────────────────────────────────┐
  │  CRON-TRIGGERED SIMULATOR (every 30s)                         │
  │  picks a row from the synthetic Parquet, posts to /ingest     │
  └────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  POST /api/transactions/ingest                                │
  │  Worker handler:                                              │
  │  1. Validate payload (Zod)                                    │
  │  2. Insert into Postgres `transactions` (Neon, JSONB raw)     │
  │  3. Determine APPLICABLE JURISDICTIONS:                       │
  │     - if any leg is USD-cleared via NY → US in scope          │
  │     - if either party is SG-domiciled → SG in scope           │
  │     - both can be in scope simultaneously                     │
  │  4. For each in-scope jurisdiction:                           │
  │       a. Load rule pack from KV                               │
  │       b. Apply threshold, sanctions, PEP rules deterministicly│
  │       c. Run ML scorer (ONNX in WASM) for typology detection  │
  │       d. Look up SHAP attributions from R2 cache              │
  │       e. Produce a per-jurisdiction verdict {block,flag,allow}│
  │  5. If multiple jurisdictions in scope AND verdicts differ:   │
  │       → write to jurisdiction_contradictions table            │
  │  6. Persist alert(s) to Postgres with SHAP JSONB              │
  │  7. Emit SSE event to dashboard subscribers                   │
  └───────────────────────────────────────────────────────────────┘
                               │
                               ▼
                  Dashboard updates in real time
```

A given transaction can therefore produce **0, 1, or 2 alerts**, and possibly **a contradiction record**. The dashboard surfaces all three states with distinct visual treatment.

## 4. Jurisdiction configuration layer

This is the central architectural commitment of the tool. Rules live in YAML files, validated against a JSON Schema, deployed as KV values. They are **not** in code — they are configuration, so an examiner can read them without reading TypeScript.

**`config/us.yaml`** (excerpt — full file in repository):

```yaml
jurisdiction: US
schema_version: 1
statute:
  - "Bank Secrecy Act (31 U.S.C. § 5311 et seq.)"
  - "USA PATRIOT Act §312, §326"
  - "Anti-Money Laundering Act of 2020"
authority: FinCEN
prudential_examiners: [OCC, FRB, FDIC]
sanctions:
  primary_list: OFAC_SDN
  feed: kv://sanctions/ofac_sdn_snapshot
  extraterritorial_via_usd_clearing: true
suspicious_activity:
  filing_form: FinCEN_Form_111
  filing_destination: FinCEN
  monetary_threshold_usd: 5000
  filing_deadline_days: 30
  narrative_authoring: human_only   # see Task 2 §3
currency_transaction:
  filing_form: FinCEN_Form_112
  threshold_usd: 10000
pep:
  scope: foreign_only
  basis: "31 CFR §1010.605"
ai_governance:
  framework: "OCC Bulletin 2026-13"
  genai_excluded_from_mrm: true
  effective_date: 2026-04-17
data_residency:
  required: false
direction_of_travel_2026: mixed
```

**`config/sg.yaml`** (excerpt):

```yaml
jurisdiction: SG
schema_version: 1
statute:
  - "Corruption, Drug Trafficking and Other Serious Crimes Act (CDSA)"
  - "Terrorism (Suppression of Financing) Act (TSOFA)"
authority: MAS
prudential_examiners: [MAS]
sanctions:
  primary_list: MAS_TFS
  feed: kv://sanctions/mas_tfs_snapshot
  also_apply: [UN_SC]
  extraterritorial_via_usd_clearing: false
suspicious_transaction:
  filing_form: STR
  filing_destination: STRO_SPF
  monetary_threshold_sgd: null            # no threshold; suspicion alone triggers
  filing_deadline: as_soon_as_practicable
  narrative_authoring: human_only
  citation: "CDSA s.45 (formerly s.39 pre-2024)"
# NOTE: there is intentionally NO `currency_transaction` block for Singapore.
# Singapore banks have no general bank cash transaction reporting threshold
# — bank cash flows are reported on suspicion alone via STR (CDSA s.45).
# The S$20,000 figure circulating in some compliance guides comes from the
# PSPM Act 2019, which applies to precious-stones / precious-metals dealers
# (and to banks only for that narrow channel). See worker/RULES_VERIFICATION.md.
pep:
  scope: foreign_and_domestic            # broader-than-US; exact MAS Notice 626 paragraph reference UNVERIFIED — see worker/RULES_VERIFICATION.md
  basis: "MAS Notice 626 (paragraph reference UNVERIFIED)"
ai_governance:
  framework: "MAS FEAT Principles + Veritas methodology"
  genai_excluded_from_mrm: false
  effective_date: 2018-11-12
  agentic_ai_consultation: true
data_residency:
  required: true
  basis: "Singapore PDPA + MAS Outsourcing Guidelines"
direction_of_travel_2026: tightening
```

**Why YAML and not a database table:** the rule pack should be *git-versioned* — every regulatory change creates a pull request, every deploy carries a SHA, and every alert in D1 records the rule-pack SHA at scoring time. This is the "rule changes mid-period" failure mode the assignment brief calls out and the answer is git history + model_versions table.

## 4.5 Postgres schema (Neon)

**Provisioned environment** *(populated 25 Apr 2026)*:

| Item | Value |
|---|---|
| Organization | `org-rapid-shadow-48220047` (Vivin) |
| Project name | `strait-compliance` |
| Project ID | `blue-paper-89578015` |
| Region | AWS `ap-southeast-1` (Singapore) |
| Postgres version | 17 |
| Production branch | `production` (`br-delicate-fog-aoh6308r`) — primary, holds the canonical schema |
| Dev branch | `dev` (`br-young-snow-aoio3c7n`) — copy-on-write fork of `production`, used for local development and migration testing |
| Database | `neondb` |
| Role | `neondb_owner` |
| Connection host | `*.c-2.ap-southeast-1.aws.neon.tech` (pooled endpoint) |

Connection strings live in `.env.local` (local development) and Cloudflare Worker secrets (deployed). Never committed.

Schema is git-versioned via Drizzle migrations. Initial DDL (already applied to `production`):

```sql
-- Domain enums
CREATE TYPE jurisdiction_code AS ENUM ('US', 'SG');
CREATE TYPE verdict           AS ENUM ('block', 'flag', 'allow');
CREATE TYPE alert_status      AS ENUM ('new', 'in_review', 'escalated', 'dismissed', 'filed');

-- Customers (KYC is upstream; we only store enough for monitoring)
CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name        TEXT NOT NULL,
  customer_type     TEXT NOT NULL,           -- individual | corporate | financial_institution
  domicile_country  CHAR(2),                 -- ISO 3166-1 alpha-2
  beneficial_owner  TEXT,
  pep_status        TEXT,                    -- none | foreign | domestic | international_org
  risk_rating       SMALLINT CHECK (risk_rating BETWEEN 1 AND 5),
  onboarded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions (raw payload retained for re-scoring)
CREATE TABLE transactions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  originator_id            UUID REFERENCES customers(id),
  beneficiary_id           UUID REFERENCES customers(id),
  amount_native            NUMERIC(20, 2) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  amount_usd               NUMERIC(20, 2),
  amount_sgd               NUMERIC(20, 2),
  corridor                 TEXT,             -- e.g. SG_USD_NY
  channel                  TEXT,             -- swift | fast | ach | fedwire | chips
  in_scope_jurisdictions   jurisdiction_code[] NOT NULL,
  raw                      JSONB NOT NULL,   -- ISO 20022 or our normalised form
  occurred_at              TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_corridor ON transactions(corridor);
CREATE INDEX idx_tx_occurred ON transactions(occurred_at DESC);
CREATE INDEX idx_tx_orig     ON transactions(originator_id);
CREATE INDEX idx_tx_bene     ON transactions(beneficiary_id);

-- Alerts (one per jurisdiction per transaction; SHAP attributions in JSONB)
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  jurisdiction    jurisdiction_code NOT NULL,
  rule_id         TEXT NOT NULL,             -- e.g. US.SAR.STRUCTURING_BELOW_10K
  severity        SMALLINT CHECK (severity BETWEEN 1 AND 5),
  ml_score        NUMERIC(6, 4),             -- P(suspicious), 0..1
  shap_attribution JSONB,                    -- { feature: contribution, ... }
  rule_pack_sha   TEXT NOT NULL,             -- git SHA of rule pack at scoring time
  model_sha       TEXT NOT NULL,             -- SHA-256 of model.onnx
  status          alert_status NOT NULL DEFAULT 'new',
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  override_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alert_jur     ON alerts(jurisdiction);
CREATE INDEX idx_alert_status  ON alerts(status);
CREATE INDEX idx_alert_tx      ON alerts(transaction_id);

-- Jurisdictional contradictions (Task 2 §4(d) failure shape C)
CREATE TABLE jurisdiction_contradictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  us_verdict      verdict NOT NULL,
  sg_verdict      verdict NOT NULL,
  resolution      TEXT NOT NULL DEFAULT 'pending',
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  rationale       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit log (no UPDATE / DELETE policy enforced at app layer)
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,             -- alert.review | alert.override | config.read | ...
  entity_type   TEXT,
  entity_id     UUID,
  details       JSONB,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Model registry (every deploy writes a row)
CREATE TABLE model_versions (
  sha256                   TEXT PRIMARY KEY,
  model_type               TEXT NOT NULL,
  trained_at               TIMESTAMPTZ NOT NULL,
  features                 JSONB NOT NULL,
  metrics                  JSONB NOT NULL,   -- { auc, recall_by_typology, psi, ... }
  shap_baseline            JSONB,
  jurisdiction_validation  JSONB,            -- per-jurisdiction calibration check
  retired_at               TIMESTAMPTZ
);
```

**Postgres-specific affordances we lean on:**

- `JSONB` lets us query SHAP attributions: `WHERE shap_attribution -> 'corridor_risk' > '0.4'` — useful when an examiner asks "show me alerts where corridor risk drove the score."
- `jurisdiction_code[]` array on transactions lets us write the cross-corridor stitching query as a single SQL CTE rather than application-side joins.
- `gen_random_uuid()` (pgcrypto, default in Neon) means the API layer never has to generate IDs.
- Neon **branching** means the `dev` and `preview-*` databases are copy-on-write forks of `main` — destructive migrations or weird seed data are isolated.

## 5. The simulated data input

The architecture uses a **demand-driven replay** rather than a cron-driven stream. This is a deliberate choice driven by Neon's serverless compute pricing model: a cron firing every 30 seconds would keep the Postgres compute permanently awake (~720 compute-hours/month on production alone), whereas a replay invoked only during demos uses a few minutes of compute total.

**How replay works:**

- The 1,000 synthetic transactions are seeded into `transactions` once (via the offline Python pipeline) with `occurred_at` timestamps spanning a representative window (e.g., 30 days).
- The dashboard exposes a **Replay control panel** with: Play / Pause, speed (1×, 10×, 100×, instant), and a scrubber on the `occurred_at` timeline.
- When the user clicks Play, the frontend loops through queued transactions and posts each one to `/api/transactions/ingest`. The ingest handler runs the full scoring pipeline as if it had just arrived in real time, writing alerts to Postgres with a `replayed_at` timestamp distinct from the original `occurred_at`.
- Server-Sent Events stream new transactions and alerts to the dashboard so the visual experience matches a live stream — without any background process burning compute when no demo is running.
- An "instant mode" replays the entire batch in one server call — useful for the Task 4 viva when an examiner asks to see all alerts and contradictions at once.

**Why this is also a substantive design improvement, not just a quota workaround:**

- The assessor controls the pace during the viva. Stop, scrub backwards, replay a single transaction.
- Determinism: every replay produces the same alerts because the underlying transaction set is fixed, so demo behaviour is reproducible.
- Honesty: Task 2's value commitment was to truthfulness; pretending a stream is "live" when it's actually being driven by a hidden cron is, in a small way, theatre.

The synthetic dataset is structured to exercise every divergence in §4:

- Transactions just under US$10K cash (test US CTR threshold under 31 CFR §1010.311)
- Transactions in the $5K–$10K USD-equivalent range to test the asymmetric SG side: SG has **no** general bank CTR — bank cash reporting is suspicion-based via STR (CDSA s.45) — so this band exposes the structural `US flag / SG allow` Type B contradiction
- USD wires from SG-domiciled SMEs through NY clearing (test extraterritorial scope)
- Domestic SGD transfers with no US nexus (test SG-only application)
- Transactions involving foreign PEPs (both jurisdictions react)
- Transactions involving Singapore *domestic* PEPs (only SG reacts — US PEP scope is foreign-only)
- Transactions touching a counterparty on OFAC SDN but not MAS TFS (deliberate contradiction)
- Multi-leg cross-corridor patterns (test the cross-corridor stitching feature)

## 6. ML and explainability

**Offline (Python):**

- LightGBM binary classifier predicting `P(suspicious)` on engineered features:
  - Transaction features: amount (log), corridor, time-of-day, channel
  - Customer features: account age, prior alert count, declared business type, country of incorporation
  - Velocity features: rolling 1d / 7d / 30d transaction counts and amounts
  - Network features: degree centrality, beneficial-owner overlap with prior alerted accounts
- Trained on the synthetic dataset with embedded typologies + label noise.
- TreeSHAP run on the full test set; per-row attributions cached as JSON in R2.

**Edge inference (TypeScript):**

- `onnxruntime-web` loads `model.onnx` from R2 (cached in Worker memory after first call).
- For each transaction, runs inference in WASM — typically <10ms.
- For SHAP: the Worker reads pre-computed attributions from R2 for the synthetic dataset; for any **fresh** transaction not in the cache, it ships an honest "approximate explanation" using TreeSHAP-JS or a simpler feature-importance fallback, **clearly labelled as such in the UI** so an examiner is never misled about the explanation's provenance.

**SHAP visualisation:**

A horizontal bar chart per alert: features ranked by |SHAP|, with positive contributions (push toward suspicious) in one colour and negative (push toward benign) in another. Includes the model's prediction probability and the decision threshold applied for the active jurisdiction.

## 7. Failure modes — built into the architecture

The assignment brief asks (under Option B but applicable here too) what happens when:

| Failure mode | How the architecture handles it |
|---|---|
| **A rule changes mid-period** | Rule packs are git-versioned. Every alert in D1 records the rule-pack SHA at scoring time. Reprocessing is possible because raw transactions are retained. |
| **A model drifts** | PSI checks run inside the offline Python pipeline before each deploy (no edge cron, no idle compute); `model_versions.metrics` records the PSI per top-10 feature; if PSI > 0.2 the deploy is blocked and the dashboard surfaces a stale-model banner. |
| **Two jurisdictions' requirements contradict each other** | The `jurisdiction_contradictions` table captures every divergence. UI surfaces them separately and *requires human resolution* — the system does not silently pick a verdict. This is the operational embodiment of Task 2 §4 failure shape C. |
| **The model is wrong about a specific alert** | Reviewers can override via the alert detail page; override is logged in `audit_log` with reviewer identity and rationale; overrides feed back into the next training cycle. |
| **GenAI components are in scope** | The architecture has none. This is a deliberate choice consistent with Task 2 §3. The model card states it explicitly. |

## 8. Model card stub

Lives at `/model-card`. Renders this markdown:

```markdown
# Model Card — Strait Compliance AML Scorer v0.1

## Purpose
Detect transactions consistent with money-laundering typologies in cross-border
USD/SGD corridors at mid-tier APAC banks supervised by MAS, with parallel
applicability for the bank's US-branch BSA obligations.

## What the model does
Scores each transaction with P(suspicious) and surfaces top contributing
features. Does NOT make a filing decision — that remains with the human MLRO.

## What the model assumes
- Input transactions follow ISO 20022 message structure (or a documented mapping)
- Customer KYC has been performed upstream (this tool does not onboard)
- Sanctions list snapshots are no more than 24 hours stale

## Where the model can fail
- Novel typologies not in the training distribution (silent false negative)
- Customers whose business model legitimately resembles a layering pattern
  (silent false positive — debanking risk; see Task 2 §4(a))
- Jurisdictional misconfiguration (architectural mitigation in §7)
- GenAI features (out of scope by design; see OCC 2026-13 exclusion)

## Training
- Synthetic dataset (link to data card), N ≈ 100k transactions
- LightGBM, 200 trees, max_depth 6, validated 5-fold
- Recall by typology: structuring 0.84, layering 0.72, smurfing 0.79
  (placeholders — replaced with real numbers post-training)

## Validation and re-validation triggers
- Independent validation by a second team member before each deploy
- PSI > 0.2 on any top-10 feature triggers re-validation
- Recall on any typology < 70% on shadow data triggers re-training
- Quarterly cadence regardless of triggers

## Jurisdictional applicability
- US (BSA/PATRIOT/AMLA): in scope
- Singapore (CDSA/TSOFA): in scope
- EU 6AMLD, UK MLR 2017: NOT validated; do not deploy

## Last validated
{{ rendered at runtime from model_versions table }}
SHA-256: {{ model_versions.sha256 }}
```

## 9. What is in scope for the prototype, what is not

| In scope | Out of scope |
|---|---|
| Jurisdiction config layer with US + SG rule packs | EU, UK, HK, AU, UAE, CA jurisdictions |
| Synthetic transaction stream + browser-driven replay | Real bank-system integration; cron-driven live stream |
| LightGBM scorer + TreeSHAP explainability | Deep-learning models, GenAI components |
| Per-jurisdiction verdict + contradiction flag | Auto-resolution of contradictions |
| SAR/STR scaffold (structured fields only) | Auto-narrative generation by LLM |
| Model card page | Independent third-party validation report |
| Audit log of reviewer actions | Multi-tenancy / customer isolation |
| Cloudflare Access for auth | OAuth, SSO providers, MFA management |
| Read-only jurisdiction config view for "examiners" | Real examiner workflow tooling |

The "out of scope" column is the substance of the **Task 3 honesty grading criterion** — the deck should explain what the tool does NOT do and why, as clearly as what it does.

## 10. Tech stack summary

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui + recharts | Fast bundle, examiner-readable UI, no Next.js edge-runtime gotchas |
| API | Hono on Pages Functions | Cloudflare-native, lightweight, Zod-friendly |
| Database | Neon Serverless Postgres (`@neondatabase/serverless`) | JSONB / arrays / enums / CTEs fit the domain; Neon branching gives free per-PR preview DBs; HTTP driver works in Workers |
| ORM / migrations | Drizzle ORM + drizzle-kit | Type-safe SQL, Postgres-first, lightweight; SQL-first migrations stay examiner-readable |
| KV | Cloudflare KV | Sub-ms config reads at edge |
| Object store | R2 | Free egress for model artifacts |
| ML training | Python + LightGBM + SHAP + skl2onnx | Mature TreeSHAP, ONNX export |
| ML inference | onnxruntime-web (WASM) | Runs in Workers, ~10ms |
| Auth | Cloudflare Access (Zero Trust) | Free for prototype, no auth code to write |
| CI/CD | GitHub Actions + `wrangler deploy` | Standard Cloudflare flow |
| Observability | Cloudflare Workers Logs + Logpush to R2 | Built-in, sufficient |

## 11. Deployment flow

```
git push origin main
   │
   ▼
GitHub Actions
   │
   ├─► python pipeline   ──► wrangler r2 object put model.onnx
   │                    ──► wrangler r2 object put shap_cache.json
   │                    ──► wrangler kv:key put us.yaml / sg.yaml
   │
   └─► npm run build    ──► wrangler pages deploy
                        ──► drizzle-kit migrate (against Neon main branch)
```

A single push to `main` rebuilds the model, refreshes the rule packs, runs Postgres migrations on the Neon `main` branch, and redeploys the app. Each deploy is tagged with a SHA that flows into the `model_versions` table and into every alert.

**Neon branching for safe iteration:** `wrangler` previews and pull-request CI runs against a Neon **branch** (a copy-on-write fork of `main`), so destructive migrations or weird seed data never touch the demo database. The connection string for each branch is injected into Cloudflare via `wrangler secret put DATABASE_URL`.

---

## 12. Open questions for review before implementation

These are the choices I'd flag for your judgement before I start writing code:

1. **ML at the edge vs pre-scored:** real ONNX inference at the edge is more impressive but adds 1–2 days of WASM/onnxruntime debugging. Pre-scoring everything offline and serving from D1 is faster to demonstrate but less defensible under Task 4 questioning. Recommendation: edge inference, but with a pre-scored fallback path.
2. **Synthetic data scope:** **resolved — starting at 1,000 records.** ~50 positives across 10 typology families, ~950 negatives. Generator is parameterised so we can scale to 10k or 100k later if Task 4 questioning probes statistical robustness, but 1,000 is enough to demonstrate every typology, every threshold divergence, and the contradiction case. Worth still coordinating with classmates on the *generator design* per the data-portion bonus, even if each of us seeds a different transaction set.
3. **Sanctions feed:** OFAC SDN is publicly downloadable; MAS TFS is also published. We can ship real (24h-stale) snapshots in KV. Worth doing for realism — costs almost nothing.
4. **Vectorize for typology similarity:** nice to have, not needed. Skip unless there's time.
5. **SAR/STR scaffold format:** real FinCEN Form 111 is a 5-page PDF. We render a clean web form that mirrors its sections; we do *not* attempt PDF generation in the prototype.
6. **Authentication:** Cloudflare Access is free and zero-config but requires you have a Cloudflare account with a domain. If that's a hassle, we can fall back to a shared-secret cookie for the prototype.

If you're happy with this shape, the build order is: (1) data generation, (2) Python pipeline, (3) D1 schema + KV configs, (4) API skeleton, (5) frontend skeleton, (6) ML integration, (7) SHAP visualisation, (8) contradiction surface, (9) model card, (10) polish + readme + demo deck.
