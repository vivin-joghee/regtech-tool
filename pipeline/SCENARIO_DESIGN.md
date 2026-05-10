# Scenario Design — 1,000-Transaction Synthetic Dataset

> **Purpose:** Specify exactly how the next iteration of `generate_synthetic_data.py` will produce 1,000 transactions that exercise the rule engine across the 10 core AML scenario categories, the four contradiction shapes, and a balanced mix of true/false positives.
>
> **Discipline rule:** Every scenario in this document refers only to verified rules in [`worker/RULES_VERIFICATION.md`](../worker/RULES_VERIFICATION.md). No scenario depends on UNVERIFIED facts (specifically the SG bank PEP scope and MAS Notice 626 paragraph numbers).

---

## 1. Scenario taxonomy

The 10 categories from the user prompt, mapped to specific transaction shapes the generator will produce. Each entry lists which rules it should exercise.

| # | Category | Sub-shape | Rules exercised |
|---|---|---|---|
| 1 | Normal customer activity | Domestic SG payroll, retail remittance, US ACH B2B, mundane cross-border trade | None — should produce `allow` in every applicable jurisdiction |
| 2 | Structuring | Multiple cash deposits just below US $10K (e.g., 5× $9,500 over 5 days) | US: should fire SAR via the structuring suspicion trigger §1020.320(a)(2)(ii) once detected — currently a GAP, modeled via ML velocity for now. CTR doesn't fire because each leg is below $10K. |
| 3 | Large cash transactions | Single cash deposit > $10,000 USD | US.CTR.10K fires (verified). SG: no rule fires (no general bank CTR — verified). **Type 2 contradiction.** |
| 4 | Rapid movement of funds | Same originator wires same magnitude through multiple corridors within 24-72h | ML velocity features should drive ML.THRESHOLD; structuring potential for SAR if amounts hit $5K+ floor |
| 5 | Sanctions / high-risk country involvement | OFAC SDN match, MAS-TFS match, OFAC-only counterparty | US.SANCTIONS.OFAC_SDN; SG.SANCTIONS.MAS_TFS. Mixed cases drive contradictions. |
| 6 | PEP activity | Foreign PEP as counterparty (handled per verified §1010.605 — foreign-only on US side); SG PEP scope rule remains UNVERIFIED so we exercise only the verified part | US.PEP.FOREIGN fires for foreign PEPs. SG side asserted only when SG.SANCTIONS or ML co-fire. |
| 7 | Cross-border transactions | USD wire from SG entity through NY clearing; SGD-only domestic for control; mixed-currency layering | Tests the `_in_scope_jurisdictions` logic: USD via SWIFT in cross-border = US in scope (extraterritorial). |
| 8 | Behavioral deviation | Customer with normal profile suddenly transacts at 10× usual amount; new corridor; new counterparty | ML velocity + amount-anomaly features should catch; rule engine likely silent unless ML threshold hit |
| 9 | Repeated transactions just below limits | $9,900 / $4,950 / S$19,500 deposits repeated by the same originator | Tests that thresholds aren't trivially fooled. Currently CTR/SAR don't aggregate; gap. |
| 10 | Business / trade-related unusual transactions | Trade-finance corridor with unusual goods (e.g., precious metals to a bank — if PSPM channel were modeled); shell company on payment trail; round-tripping | UBO traversal would catch (currently a GAP); mostly ML-driven for now |

---

## 2. Distribution plan — 1,000 transactions

The corpus must look realistic — **the vast majority of bank transactions are mundane**. Volume is allocated to make the tool's behavior on the long tail testable without drowning the demo in noise.

| Category | Count | % of total | Rationale |
|---|---:|---:|---|
| 1. Normal | **720** | 72% | The realistic baseline. Must not over-flag. |
| 2. Structuring | 30 | 3% | Patterns of 5–8 legs each, so 4–6 distinct customer-week clusters |
| 3. Large cash | 25 | 2.5% | Some clean (just over $10K), some with co-firing suspicion |
| 4. Rapid movement | 35 | 3.5% | Velocity bursts, includes some legitimate merchant payouts |
| 5. Sanctions / high-risk | 50 | 5% | OFAC-both, OFAC-only (high-risk + low-risk), low-amount sanctions hits, sanctioned foreign PEPs |
| 6. PEP activity | 25 | 2.5% | Foreign PEP direct + via shell; verified-side only |
| 7. Cross-border (extra-territorial test) | 50 | 5% | USD via SWIFT cross-border, SGD domestic, mixed-currency legs |
| 8. Behavioral deviation | 35 | 3.5% | Same-customer anomalies, new-corridor first-touch |
| 9. Just-below-limits | 30 | 3% | Sub-floor patterns; tests that thresholds aren't fooled |
| 10. Business/trade unusual | 20 | 2% | Round-tripping, shell-on-trail, unusual goods |
| **Total** | **1,000** | 100% | |

The "Normal" pool is itself a mix:
- 280 SG-domestic SGD payroll/retail (channel: GIRO/FAST)
- 200 US-domestic USD B2B (channel: ACH/FEDWIRE)
- 140 SG–US legitimate trade (channel: SWIFT, USD)
- 60 SG–correspondent FI (channel: SWIFT)
- 40 retail remittance (small amounts)

Every non-Normal scenario is *intentionally* placed; the generator does not produce "accidental" suspicious behavior.

---

## 3. Contradiction targets — the architecture's whole point

Per the user prompt, four cases must all be represented. Targets:

| Type | Count | Trigger condition |
|---|---:|---|
| **A — Both trigger (US flag/block AND SG flag/block)** | ≈40 | Sanctions on both lists; foreign PEP with co-firing ML; high-value OFAC + sanctions across regimes |
| **B — US triggers, SG does not** | ≈170 | US has cash thresholds (CTR + SAR floor); SG bank cash reporting is suspicion-only. Most cash > $10K in dual scope = US flag, SG allow. Also: OFAC-only counterparties. |
| **C — SG triggers, US does not** | **≈5–10 (DOWNGRADED)** | **Genuinely rare with verified rules only — see §3a "Architectural finding: Type C scarcity" below.** Achievable only via low-amount foreign-PEP cases that don't cross any US threshold AND aren't on OFAC, OR via differential ML calibration. |
| **D — Neither triggers** | ≈700 | Mundane bank traffic. The control. |

The total exceeds 1,000 because some transactions live in only one jurisdiction's scope (single-jurisdiction transactions can produce single-side alerts but no contradictions). The targets above are *contradiction events*, not transactions; one transaction can produce zero or one contradiction.

### How each contradiction type is engineered

**Type A — Both trigger:**
- Wire to a counterparty on **both** OFAC SDN and MAS-TFS (Iran, North Korea entities in our data)
- Wire to a foreign PEP for an amount that also hits the ML threshold

**Type B — US only / US more restrictive:**
- Cash deposit at exactly $10,001 USD with no other signals → US.CTR.10K fires (`US flag / SG allow`); SG has no general CTR
- $50K-200K USD wire to OFAC-only counterparty with high-risk profile (`ofac_only_match`) → US: OFAC.SDN block + SAR fires above floor + suspicion. SG ML typically fires here too on the amount/channel features → produces **`US block / SG flag`**.
- $2K-4.5K USD wire to **low-risk-rated** OFAC-only counterparty (`ofac_only_low_signal`) → US: OFAC.SDN block (SAR doesn't fire — below $5K floor); SG: nothing fires because amount is low, counterparty risk_rating=2, no MAS-TFS, no PEP → ML stays below threshold → produces **`US block / SG allow`**. *Engineered specifically to hit this contradiction shape — see §3b.*
- $8K-25K USD wire to a counterparty that is **both OFAC SDN and a foreign PEP** (`sanctioned_foreign_pep`) → US: OFAC.SDN block + US.PEP.FOREIGN flag; SG: SG.PEP.ALL flag (no MAS-TFS) → **`US block / SG flag`** *deterministically* (does not depend on the ML score).
- Multiple just-below-$10K USD cash deposits over a week → fires US.SAR.5K via structuring (when implemented) or via ML

**Type C — SG only (rare and asymmetric — see §3a):**
- ~~$4,500 USD wire to an entity on MAS-TFS but NOT on OFAC~~ — **DROPPED**. This would require fictional MAS-only sanctioned entities, which we are not creating (per design decision Q2).
- Foreign PEP at low amount in dual scope where the PEP is recognised by both regimes — but in this case both fire, not just SG. So this is actually Type A, not C.
- A SG-only-scope behavioural anomaly (ML hits) is not a contradiction at all because US is not in scope.
- The only remaining honest mechanism: **differential ML calibration**. Set SG `ml_score.threshold = 0.15` and US `ml_score.threshold = 0.187`, justified by the jurisdictional-validation analysis showing different score distributions per in-scope grouping. Transactions scoring 0.15–0.187 will fire SG ML but not US ML; if amount is also < $5K USD, no US.SAR floor → US allow, SG flag.

The 5–10 Type C cases will all come from this last mechanism, conditional on whether you adopt the differential-threshold configuration. If you don't, **Type C count drops to ~0**.

**Type D — Neither:**
- All 720 Normal transactions
- Many of the just-below-limits cases that don't reach SAR floor and don't co-fire suspicion

---

## 3b. Type B sub-shapes: covering both `block / allow` and `block / flag`

A subtle point worth flagging in the viva: not every "US-stricter" Type B shape is easy to engineer. Two independent contradiction patterns sit under Type B, and each needs a different lever:

| Shape | Lever | Why it's tricky |
|---|---|---|
| `US flag / SG allow` | Cash + $10K threshold (CTR has no SG analogue) | Easy — ~30 cases generated naturally from `large_cash` |
| `US block / SG allow` | OFAC-only counterparty + **low SG-side ML signal** | The challenge: the ML model learns to flag any OFAC-only case if it's labeled positive in training, so SG.ML fires too → degenerates into `block / flag`. **Solution:** model the OFAC-only counterparty as a low-risk-rated entity so the model's `beneficiary_risk_rating` and `amount_usd_log` features stay weak. Sub-shape `ofac_only_low_signal`. |
| `US block / SG flag` (deterministic) | OFAC-only beneficiary that is **also a foreign PEP** | SG.PEP.ALL fires deterministically regardless of ML outcome. Sub-shape `sanctioned_foreign_pep`. |
| `US block / SG flag` (ML-driven) | OFAC-only counterparty with high-risk profile, large amount | Already produced by existing `ofac_only_match` and `low_amount_sanctions_hit`. |

The `ofac_only_low_signal` shape exists because of a real architectural finding: **the ML rule and the rule-based sanctions rule sit at different layers of the system, and the model's score depends on training data — so a contradiction's *shape* is a function of both regulatory text AND model calibration**. If the model learns to flag the entire sanctioned-counterparty population, you lose the `block / allow` shape entirely. Documenting how to recover it (low-signal feature engineering) is a more honest demo than hand-tuning the YAML threshold.

---

## 3a. Architectural finding: Type C scarcity is itself the result

When I attempted to engineer all four contradiction shapes from verified rules only, **Type C (SG triggers, US does not) turned out to be structurally rare**. This is a finding worth surfacing in Task 4, not a gap to paper over.

### Why it's rare

In dual-scope transactions, US fires whenever any of {CTR cash floor, SAR floor + suspicion, PEP-foreign, OFAC SDN} hits. SG fires whenever any of {ML threshold, MAS-TFS, STR-via-suspicion-when-other-rule-hits} hits. The asymmetry that matters:

| Lever | US has it | SG has it | If only SG fires? |
|---|---|---|---|
| Cash CTR floor | Yes ($10K) | No | — (only US fires this side, → Type B) |
| SAR floor on suspicion | Yes ($5K) | Yes (no floor) | Suspicion below $5K USD: SG fires STR, US can't fire SAR — but suspicion needed first |
| Sanctions list | OFAC SDN | MAS-TFS | OFAC-only ⇒ Type B; MAS-TFS-only would ⇒ Type C, but those are vanishingly rare in real sanctions data |
| PEP scope | Foreign-only (verified) | UNVERIFIED | Even if SG covers domestic, we cannot test-assert it (Q2 boundary) |

The only verified mechanism that produces Type C without fictional entities or unverified rules is the **SAR-floor differential**: a small-amount transaction (< $5K USD) that has SG-side suspicion (ML, MAS-TFS, foreign PEP) but where the equivalent US-side suspicion either doesn't fire OR the SAR floor short-circuits the US verdict.

But each of those legs has issues:
- Foreign PEPs fire on both sides equally (US.PEP.FOREIGN and SG.PEP.ALL both fire) → Type A, not C
- ML thresholds are identical at 0.187 → both fire equally → Type A
- MAS-TFS-only entities would require fictional designations → forbidden by Q2

### What this means for the demo

This is a **real-world architectural finding**, not a flaw in our generator: the verified rule set is asymmetric. The US regime has more discrete trigger conditions; SG's regime relies on the breadth of the suspicion-based STR. So:

- Most contradictions are **Type B** (US-only triggers) because US has more rule paths
- Type A (both) happens at sanctions overlap and high-value PEP cases
- Type D (neither) is the bulk
- **Type C (SG-only) only emerges from a deliberate, justified configuration choice** — most naturally, a differential ML threshold based on calibration analysis

### Decision — for this iteration

Choose one of two paths:

| Path | Effect | Defensibility in Task 4 |
|---|---|---|
| **A. Adopt differential ML thresholds** (e.g. SG 0.15, US 0.187) with a documented justification ("jurisdictional-validation analysis showed SG-scope transactions have a thicker tail of borderline scores; lowering the threshold maintains uniform recall") | Generates ~5–10 Type C cases | Strong if the calibration argument is real; weaker if it's manufactured for the demo |
| **B. Keep ML thresholds identical and surface Type C scarcity as a finding** | Generates ~0 Type C cases | Strongest — leads with "the architecture revealed an asymmetry I hadn't anticipated" |

**Recommended: Path B.** The honest disclosure is more defensible than a synthetic differential. We update §3 contradiction targets to:

- Type A: ~40
- Type B: ~170
- **Type C: 0–5** (whatever naturally emerges; not a target)
- Type D: ~700

And we make Type C scarcity an explicit talking point: *"With verified rules only and no fictional sanctioned entities, Type C contradictions are structurally rare — the result of asymmetric rule populations between a threshold-driven and a suspicion-driven regime."*

---

## 4. Verdict-prediction logic — encoded as ground truth on each transaction

Every generated transaction will carry these new columns in the parquet output (and in `raw` JSONB after seed):

| Column | Type | Purpose |
|---|---|---|
| `scenario_category` | text (1–10) | One of the 10 categories above |
| `scenario_sub_shape` | text | The specific sub-shape (e.g., "structuring_below_us_ctr") |
| `expected_us_verdict` | enum (block / flag / allow / not_in_scope) | Ground truth verdict per the verified rules |
| `expected_sg_verdict` | enum (block / flag / allow / not_in_scope) | Ground truth verdict per the verified rules |
| `expected_contradiction_type` | enum (A, B, C, D) | Which contradiction shape this transaction creates |
| `reason_summary` | text | One-line explanation of why the expected verdicts are what they are |

After `replay-all`, a validation script will compare the rule engine's actual output against these expected values and report mismatches. Mismatches break down into:

- **Bugs** — engine should match expected, doesn't
- **Known gaps** — engine doesn't model what the regulation requires (e.g., structuring detection, PEP family/UBO traversal)
- **Engine over-fires** — flags when expected says allow

This becomes the test harness once the validation script is wired in (deferred to next iteration).

---

## 5. Customer pool changes

The current 30-customer pool is too small to produce 720 Normal transactions without each customer appearing 25× — that's unrealistic. Expanding to **80 customers**:

| Type | Count | Notes |
|---|---:|---|
| SG SME corporates (clean, varied risk 1–3) | 20 | Mix of services / trade / retail |
| US SME corporates (clean) | 15 | Same |
| SG individuals (clean, retail) | 12 | Higher count; payroll receivers |
| US individuals (clean, retail) | 8 | Same |
| Correspondent FIs | 5 | SG, US, ID, MY, PH |
| Foreign PEPs | 3 | Different countries |
| Domestic SG PEPs | 2 | **Used only for SG-side test cases — no contradiction assertions on US side until SG PEP scope is verified** |
| PEP-related shells | 4 | UBO chain |
| OFAC + MAS sanctioned | 3 | Iran, NK, Russia |
| OFAC-only sanctioned | 4 | Venezuela, Cuba; drives Type B contradictions |
| MAS-TFS-only sanctioned | 2 | Engineered case for Type C contradictions (a MAS designation that's not on OFAC) |
| Mules | 4 | Used in structuring patterns |

The MAS-TFS-only entities are a slight stretch — in reality MAS-TFS is mostly UN-implemented (so OFAC tends to also list), but for Type C contradictions to be testable we need a counterparty that fires SG sanctions without firing US sanctions. We'll model these as fictitious MAS-specific designations and document the artificiality.

---

## 6. Channel diversity — required for verified-correct rule firing

The current synthetic data has channels `FAST`, `GIRO`, `SWIFT`, `CHIPS`, `FEDWIRE`, `ACH` — all electronic. The verified US.CTR rule applies only to **cash** (currency). To exercise CTR correctly, we add:

| New channel | Description |
|---|---|
| `CASH_USD` | Physical USD cash deposit/withdrawal at a US-branch teller |
| `CASH_SGD` | Physical SGD cash deposit/withdrawal at a SG-branch teller |

This lets us:
- Fire US.CTR.10K **only** for `CASH_USD` over $10K (verified §1010.311)
- Have wires/ACH/etc. correctly **not** fire US.CTR (closing the channel-ignorance gap)
- Generate clean Type B contradictions: a $11,000 `CASH_USD` deposit in dual scope → US flag, SG allow

A small follow-up code change will gate `checkCurrencyTransactionRule` on `txn.channel === "CASH_USD"` (or whatever the cash-channel set is). This is a **verified** correction (CTR is for currency only per §1010.311) and so falls under the do-implement-verified-corrections rule.

---

## 7. Generator architecture

```
pipeline/
├── generate_synthetic_data.py         # entry, argparse, orchestration
├── scenarios/                         # NEW — one module per category
│   ├── __init__.py
│   ├── _shared.py                     # shared helpers, customer pool builders
│   ├── normal.py                      # category 1
│   ├── structuring.py                 # category 2
│   ├── large_cash.py                  # category 3
│   ├── rapid_movement.py              # category 4
│   ├── sanctions.py                   # category 5
│   ├── pep.py                         # category 6
│   ├── cross_border.py                # category 7
│   ├── behavioral_deviation.py        # category 8
│   ├── just_below_limits.py           # category 9
│   └── business_trade.py              # category 10
└── validate_scenarios.py              # NEW — runs after replay-all to check
                                       # actual engine output against the
                                       # expected_* columns; reports diffs.
```

Each scenario module exports a function `generate(rng, customers, target_count) → list[Transaction]` where each `Transaction` includes the `expected_us_verdict`, `expected_sg_verdict`, `expected_contradiction_type`, `reason_summary` fields.

Determinism: every module takes the same `rng` (numpy default_rng) seeded from `--seed`. Re-running with the same seed produces byte-identical output.

---

## 8. Validation criteria — JSON report

After regenerating + reseeding + replay-all, `pipeline/validate_scenarios.py` reads alerts and contradictions from Neon, joins on the transaction `expected_*` columns, and writes `pipeline/data/scenario_validation_report.json` shaped as:

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-26T...Z",
  "model_sha": "4287dbc7...",
  "rule_pack_shas": { "US": "4fa89148...", "SG": "dc495af2..." },
  "summary": {
    "transactions": 1000,
    "alerts": 280,
    "contradictions": 187
  },
  "by_scenario_category": {
    "1_normal":            { "expected": 720, "matched": 720, "pct": 1.0 },
    "2_structuring":       { "expected": 30,  "matched": 18,  "pct": 0.6,
                             "notes": "Structuring rule not implemented; ML velocity catches partial" },
    "3_large_cash":        { "expected": 25,  "matched": 25,  "pct": 1.0 }
  },
  "by_contradiction_type": {
    "A_both_trigger":  { "expected": 40,  "actual": 38,  "matched": 36, "unintended": 2 },
    "B_us_only":       { "expected": 170, "actual": 172, "matched": 168, "unintended": 4 },
    "C_sg_only":       { "expected": 0,   "actual": 0,   "matched": 0,  "unintended": 0,
                          "notes": "Type C is structurally rare with verified rules only — see SCENARIO_DESIGN.md §3a" },
    "D_neither":       { "expected": 700, "actual": 698, "matched": 696, "unintended": 2 }
  },
  "mismatches": [
    {
      "transaction_id": "cfe5d3d3-...",
      "scenario_category": "1_normal",
      "expected_us_verdict": "allow",
      "expected_sg_verdict": "allow",
      "actual_us_verdict": "flag",
      "actual_sg_verdict": "allow",
      "actual_us_hits": ["US.CTR.10K"],
      "diagnosis": "engine_over_fires"
    }
  ],
  "diagnosis_buckets": {
    "engine_over_fires": 2,
    "engine_under_fires": 0,
    "known_gap_structuring": 12,
    "known_gap_pep_ubo": 0
  }
}
```

Acceptance criteria for the iteration:
- Normal category: ≥99% match (the ones that drift are the hardest-to-tune borderline cases)
- Type A and Type B: ≥85% match
- Type C and D: noted but not gated on percentage (Type C is intentionally near-zero per §3a)
- No mundane Normal transaction produces a contradiction (zero unintended Type A/B/C among Normals)
- Diagnosis buckets must be coherent — every mismatch falls into one named bucket; no `unknown`

---

## 9. What this dataset enables that the current one does not

| Capability | Current (1,000 with 6 typologies) | Proposed (1,000 with full taxonomy) |
|---|---|---|
| Demonstrate every contradiction type (A/B/C/D) | Partial — Type C absent | All four explicitly populated |
| Validate engine against ground truth | Not possible — no expected_verdict column | First-class validation |
| Train ML scorer with diverse positives | 29 positives across 6 typologies | ~280 positives across 10 categories with sub-shapes |
| Test corrected SAR/CTR behaviour | No — no CASH channel | Yes — `CASH_USD`/`CASH_SGD` lets verified rules fire correctly |
| Test SG STR firing on suspicion alone | Partial | Full — Type C cases are designed to exercise this |
| Demo the full breadth of jurisdiction-aware logic | Compressed | Each category surfaces a different lever of divergence |

---

## 10. Implementation sequence (next coding pass)

1. **Customer pool expansion** — extend `build_customers()` to 80 customers per Section 5
2. **Scenario modules** — break `generate_synthetic_data.py` into `scenarios/` per Section 7
3. **Channel additions** — add `CASH_USD`, `CASH_SGD` to channel taxonomy; update `_in_scope_jurisdictions()` so cash channels stay in their domestic regime
4. **Expected-verdict columns** — extend `_make_txn()` to accept and persist the four new fields
5. **CTR cash-gating** — update `worker/src/rules/threshold.ts` to require `CASH_*` channel for CTR (verified correction)
6. **Validation script** — `pipeline/validate_scenarios.py` reads alerts from Neon, joins on transaction `expected_*` fields, prints the report shape from Section 8
7. **Re-seed and re-validate** — `seed_neon.py` → `replay-all` → `validate_scenarios.py`

Estimated effort: ~1 day of Python work for steps 1–4, ~30 min for step 5, ~1 day for step 6 including the result-rendering UI. After this iteration the dataset is no longer a placeholder — it's a validated test corpus.

---

## 11. Open questions — resolved

| # | Question | Resolution |
|---|---|---|
| 1 | Cash channel granularity | **Resolved.** Separate `CASH_USD` and `CASH_SGD` channels. Currency carried natively, scope logic stays simple. |
| 2 | Fictional MAS-TFS-only entities for Type C | **Resolved — DO NOT create fictional entities.** This forces the design decision in §3a and downgrades the Type C target accordingly. The honest disclosure replaces the synthetic divergence. |
| 3 | Structuring detection | **Resolved — keep as known GAP.** Currently modelled via ML velocity features. A future iteration adds an explicit aggregate-pattern rule in `engine.ts`; for now it's documented in `RULES_VERIFICATION.md`. |
| 4 | PEP UBO traversal | **Resolved — keep as known GAP.** §1010.605 explicitly covers shells formed for the benefit of a PEP, but our rule engine does not traverse `beneficial_owner` chains. Documented in `RULES_VERIFICATION.md`. |
| 5 | Validation report format | **Resolved — JSON.** `pipeline/validate_scenarios.py` writes `pipeline/data/scenario_validation_report.json` per the schema in §8. A trivial human-readable summary can be derived from it. |

**Status:** design is ready to implement. Next coding pass executes the seven steps in §10.
