# Test Cases — Rule Engine

> **Discipline:** Every test case below is keyed to a rule whose primary source has been fetched and quoted in [`RULES_VERIFICATION.md`](RULES_VERIFICATION.md). Test cases that depend on **UNVERIFIED** facts (specifically: MAS Notice 626 PEP scope and paragraph numbers) have been deliberately excluded — see "Excluded scenarios" at the bottom.
>
> Cases marked **(EXPOSES BUG)** demonstrate a known simplification in our code where a verified rule is implemented incorrectly. They fail today and represent corrections listed in `RULES_VERIFICATION.md`.

The cases use `customer.alias` references from `pipeline/generate_synthetic_data.py` so they can be wired into actual unit tests against the rule engine in isolation, or run against the live API after `replay-all`.

---

## Verified rules covered by these tests

| Rule ID | Source | Section in this doc |
|---|---|---|
| US.CTR.10K | 31 CFR §1010.311 | [Group 1](#group-1--us-ctr-31-cfr-1010311) |
| US.SAR.5K | 31 CFR §1020.320(a)(2) | [Group 2](#group-2--us-sar-31-cfr-1020320) |
| US.PEP.FOREIGN | 31 CFR §1010.605 | [Group 3](#group-3--us-pep-31-cfr-1010605) |
| US.SANCTIONS.OFAC_SDN | OFAC authorities (TWEA / IEEPA / AEDPA / Kingpin) | [Group 4](#group-4--ofac-sdn-sanctions) |
| SG.STR.SUSPICION | CDSA Section 45 (per SPF/STRO official) | [Group 5](#group-5--sg-str-cdsa-section-45) |
| SG.SANCTIONS.MAS_TFS | TSOFA + MAS regulations | [Group 7](#group-7--mas-tfs-sanctions) |
| Cross-rule | All of the above | [Group 8](#group-8--cross-rule-and-currency-edge-cases), [Group 9](#group-9--negative-tests) |
| Contradictions | Verified divergences only | [Group 10](#group-10--verified-contradiction-cases) |

---

## Group 1 — US CTR (31 CFR §1010.311)

**Verified:** "more than $10,000" in **currency** (cash). Wires, ACH, and other electronic transfers are NOT in scope of this regulation.

### CTR-1 — Cash deposit at exactly $10,000.00
- Channel: `CASH` (would need to be added to synthetic data)
- Amount: `10,000.00 USD`
- Expected: **allow** ("more than" excludes the floor itself)
- Status: **(EXPOSES BUG)** — our `>=` operator would fire; correct operator is `>`

### CTR-2 — Cash deposit at $10,000.01
- Channel: `CASH`
- Amount: `10,000.01 USD`
- Expected: **flag** (CTR fires)

### CTR-3 — Cash deposit at $9,999.99 (just under)
- Channel: `CASH`
- Amount: `9,999.99 USD`
- Expected: **allow**

### CTR-4 — Large SWIFT wire (the common false positive)
- Channel: `SWIFT`
- Amount: `25,000 USD`
- Expected: **allow** under correct rule (CTR is cash-only)
- Status: **(EXPOSES BUG)** — our rule fires regardless of channel

### CTR-5 — ACH transfer of $50,000
- Channel: `ACH`
- Amount: `50,000 USD`
- Expected: **allow** under correct rule (electronic transfer, not currency)
- Status: **(EXPOSES BUG)** — same channel-ignorance issue

---

## Group 2 — US SAR (31 CFR §1020.320)

**Verified:** Two-part test. Amount **≥ $5,000** AND at least one of three suspicion triggers: (i) funds derived from illegal activity / intended to hide funds, (ii) designed to evade BSA, (iii) no apparent business purpose. Filing within 30 days, extendable to 60.

### SAR-1 — Mundane $6,857 cross-border wire (no suspicion)
- Channel: `SWIFT`
- Amount: `6,857.60 USD`
- Originator: `us_sme_furniture` (Hudson Furniture)
- Beneficiary: `sg_sme_electronics` (Lim Electronics)
- All flags clean: no sanctions, no PEP, low ML score
- Expected under correct rule: **allow** (above floor but no suspicion trigger)
- Status: **(EXPOSES BUG)** — our code fires `flag` on amount alone. ~309 alerts of this shape today.

### SAR-2 — $5,001 wire with sanctions hit (above floor + suspicion via §1020.320(a)(2)(i))
- Channel: `SWIFT`
- Amount: `5,001 USD`
- Beneficiary on OFAC SDN
- Expected: **block** (sanctions); SAR also fires (above floor + suspicion present)

### SAR-3 — $4,999 wire with sanctions hit (below floor)
- Channel: `SWIFT`
- Amount: `4,999 USD`
- Beneficiary on OFAC SDN
- Expected: **block** (sanctions block fires regardless of amount); SAR rule itself does NOT fire (below $5K floor)

### SAR-4 — $50,000 wire to foreign PEP (above floor + suspicion via PEP)
- Channel: `SWIFT`
- Amount: `50,000 USD`
- Beneficiary: `id_pep_for` (Indonesian foreign PEP)
- Expected: **flag** (US.PEP.FOREIGN fires; SAR also fires above floor with suspicion present)

### SAR-5 — Structuring pattern (designed to evade — §1020.320(a)(2)(ii))
- Channel: `CASH`
- Same originator: 5 deposits of `9,500 USD` each within 7 days
- Expected under correct rule: **flag** with SAR fired on the pattern
- Status: **GAP** — current system models this only via ML velocity features; no hard structuring rule

### SAR-6 — $4,999 wire with no suspicion
- Channel: `SWIFT`
- Amount: `4,999 USD`
- All flags clean
- Expected: **allow** under correct rule (below floor; even if there were suspicion, below floor)
- Tests: floor is a hard gate

---

## Group 3 — US PEP (31 CFR §1010.605)

**Verified:** Senior Foreign Political Figure = senior official of foreign government / political party / state-owned enterprise. Includes immediate family (spouses, parents, siblings, children, spouse's parents and siblings) and close associates. **No coverage for domestic US political figures** in this section.

### PEP-1 — Foreign PEP as direct beneficiary
- Channel: `SWIFT`
- Amount: `200,000 USD`
- Beneficiary: `id_pep_for` (Bapak Sutrisno Wijaya — Indonesia)
- Expected US verdict: **flag** (US.PEP.FOREIGN fires)

### PEP-2 — Foreign PEP as direct originator
- Channel: `SWIFT`
- Amount: `100,000 USD`
- Originator: `ph_pep_for` (Sen. Maria Romualdez — Philippines)
- Expected US verdict: **flag**

### PEP-3 — Foreign PEP as UBO of shell company
- Channel: `SWIFT`
- Beneficiary: `sh_pep_for` (Jakarta Holdings, UBO is `id_pep_for`)
- Expected under correct rule: **flag** (close associate / shell formed for benefit; §1010.605 explicitly includes "a corporation, business, or other entity formed for the benefit of any such individual")
- Status: **GAP** — our PEP rule only checks direct `pep_status`, doesn't traverse UBO

### PEP-4 — Hypothetical US-domestic political figure
- Beneficiary: a US Senator or US state governor (not in current synthetic data)
- Expected: **allow** for PEP rule (US BSA framework explicitly covers foreign only per §1010.605)
- Tests: scope must remain `foreign_only`

### PEP-5 — Spouse of foreign PEP (immediate family extension)
- Beneficiary: spouse of `id_pep_for` (not currently in synthetic data)
- Expected under correct rule: **flag** (immediate family per §1010.605)
- Status: **GAP** — synthetic data does not currently include PEP family members

---

## Group 4 — OFAC SDN sanctions

**Verified:** OFAC SDN list managed by US Treasury. US persons generally prohibited from dealing with SDNs. **50% rule:** entities ≥50% owned by SDN(s) are blocked even if not directly listed. **Extraterritorial reach via USD clearing:** USD-denominated payments through US correspondent accounts trigger OFAC exposure even when both endpoints are offshore.

### OFAC-1 — Direct SDN match in USD wire
- Channel: `SWIFT`, Currency: `USD`
- Beneficiary: `sn_both_a` (Tehran Petroleum — on both OFAC SDN and MAS-TFS)
- Expected US verdict: **block**

### OFAC-2 — OFAC-only counterparty (the canonical contradiction case)
- Channel: `SWIFT`, Currency: `USD`
- Originator: `sg_sme_textiles` (SG party, so SG also in scope)
- Beneficiary: `sn_ofac_a` (Caracas Resource Holdings — on OFAC SDN only, NOT on MAS-TFS)
- Expected US verdict: **block** (USD via SWIFT clears NY → US extraterritorial)
- Expected SG verdict: **allow** under sanctions rule (no MAS-TFS match); could be flag if ML high
- Expected: **CONTRADICTION** recorded

### OFAC-3 — Low-amount sanctions hit
- Channel: `SWIFT`, Currency: `USD`
- Amount: `100 USD`
- Beneficiary on OFAC SDN
- Expected: **block** (sanctions block ignores amount)

### OFAC-4 — SDN counterparty in non-USD foreign-currency transaction
- Channel: `SWIFT`, Currency: `EUR` (not in current synthetic data)
- Originator: SG party, beneficiary: SDN-listed
- No US party, no USD clearing
- Expected US verdict: **NOT IN SCOPE** (no USD clearing → no US-jurisdictional reach via §1010 et al.)
- Tests: extraterritoriality is currency-specific to USD

### OFAC-5 — 50% rule (ownership aggregation)
- Beneficiary: a corporation 60% owned by an SDN-listed individual but not directly on the SDN list
- Expected under correct rule: **block** (50% rule)
- Status: **GAP** — our system reads the boolean `ofac_sdn_match` flag; ownership aggregation not modeled

### OFAC-6 — SDN match in pure SGD-domestic transaction
- Channel: `FAST`, Currency: `SGD`
- Both parties SG-domiciled, beneficiary on OFAC SDN only
- Expected scope: **SG only** (no US person, no USD clearing → US not in scope)
- Expected SG verdict: **allow** (no MAS-TFS match)
- No contradiction (only one regime applicable)

---

## Group 5 — SG STR (CDSA Section 45)

**Verified (via SPF/STRO official):** "Knows or has reasonable grounds to suspect that any property may be connected to a criminal activity." **No monetary threshold.** Filed with STRO. Penalties up to SGD 250,000 fine and/or 3 years imprisonment.

### STR-1 — Sub-S$1,000 transaction with sanctions hit
- Channel: `FAST`, Amount: `500 SGD`
- Beneficiary on MAS-TFS
- Expected SG verdict: **block** (sanctions)
- Tests: STR has no monetary floor — small-value transactions can be reportable

### STR-2 — Mundane low-value transaction (no suspicion)
- Channel: `FAST`, Amount: `200 SGD`
- All flags clean, low ML score
- Expected SG verdict: **allow**
- Tests: STR fires only on suspicion, not on amount

### STR-3 — Pure SG-domestic SGD transfer at S$50K with no other signals
- Channel: `FAST`, Amount: `50,000 SGD`
- All flags clean, low ML score
- Expected SG verdict: **allow** (no monetary threshold + no suspicion)
- Tests: amount alone never triggers STR in SG

### STR-4 — High-amount cross-border with PEP-related suspicion
- (Currently asserts only verified portion; SG PEP scope is UNVERIFIED — see Excluded scenarios)
- This case is intentionally not asserted on the SG side until MAS Notice 626 PEP scope is verified

---

## Group 7 — MAS-TFS sanctions

**Verified:** MAS Targeted Financial Sanctions implementing UN Security Council resolutions plus MAS-specific designations. **No OFAC-style extraterritorial USD-clearing reach.**

### TFS-1 — Direct MAS-TFS match
- Channel: `SWIFT`, Currency: `USD`
- Beneficiary: `sn_both_b` (Pyongyang Industrial — on MAS-TFS and OFAC SDN)
- Expected SG verdict: **block**
- Expected US verdict: **block** (also on OFAC)

### TFS-2 — UN Security Council match (also_apply rule)
- Beneficiary: hypothetical entity on UN-SC list but not on MAS-TFS proper
- Expected SG verdict: **block** (rule pack `also_apply: [UN_SC]` triggers block)
- Status: synthetic data does not currently include UN-SC-only entities; would need to extend

### TFS-3 — OFAC-only counterparty in SG-only transaction
- Channel: `FAST`, Currency: `SGD`, both parties SG
- Beneficiary on OFAC SDN only (not on MAS-TFS)
- Expected SG verdict: **allow** (MAS-TFS doesn't recognise OFAC-only)
- Tests: divergence in sanctions list scope

### TFS-4 — Low-amount MAS-TFS match
- Channel: `FAST`, Amount: `100 SGD`
- Beneficiary on MAS-TFS
- Expected: **block** (sanctions ignore amount)

---

## Group 8 — Cross-rule and currency edge cases

These exercise the interaction between US and SG thresholds when both regimes are in scope and currency conversion sits between the thresholds.

### XR-1 — $11,000 USD cash deposit at a bank (general bank cash, no PSPM)
- Channel: `CASH`, Currency: `USD`, Amount: `11,000 USD`
- Both jurisdictions in scope (US originator + SG beneficiary)
- Expected US verdict: **flag** (US.CTR fires, > $10K — verified §1010.311)
- Expected SG verdict: **allow** (no general bank CTR threshold in Singapore — verified)
- Expected: **CONTRADICTION** (US flag → SG allow). This is the **sharper-than-previously-thought** durable divergence: US has a $10K cash floor, SG has no floor for bank cash at all.
- Status: depends on US.CTR being cash-channel-gated (currently bug) AND SG.CTR rule being removed/restricted (currently incorrect)

### XR-2 — $50,000 USD cash deposit at a bank (well above US CTR threshold)
- Channel: `CASH`, Amount: `50,000 USD`
- Both in scope
- Expected US verdict: **flag** (CTR fires)
- Expected SG verdict: **allow** under correct rule (no general bank cash threshold in SG)
- Expected: **CONTRADICTION** (durable). The threshold gap between US and SG is wider than I had encoded.

### XR-3 — $9,000 USD cash deposit at a bank
- Channel: `CASH`, Amount: `9,000 USD`
- Both in scope
- Expected US verdict: **allow** (below US CTR floor)
- Expected SG verdict: **allow** (no general bank cash threshold)
- Expected: **NO CONTRADICTION**

### XR-4 — S$15,000 SGD cash deposit at a bank
- Channel: `CASH`, Currency: `SGD`, Amount: `15,000 SGD` (≈ $11,100 USD)
- Both in scope (US in scope only if USD-clearing involved; SGD-cash without USD leg likely SG-only)
- Expected US verdict: depends on scope; if US in scope, **flag** (USD-equivalent > $10K); if US not in scope, no US verdict
- Expected SG verdict: **allow** under correct rule (no general bank cash threshold)
- Note: tests scope determination AND the absence of a SG bank cash rule

### XR-5 — Pure US domestic high-value electronic wire
- Channel: `FEDWIRE`, Currency: `USD`, Amount: `100,000 USD`
- Both parties US-domiciled
- Expected US verdict: **allow** under correct rules (electronic, not cash; no suspicion)
- Expected SG: not in scope
- Status: **(EXPOSES BUG)** — current code fires SAR on amount

---

## Group 9 — Negative tests

These are mundane transactions that should NOT fire any rule under the verified regulations. They test our code does not over-flag.

### NEG-1 — Small retail remittance
- Channel: `SWIFT`, Amount: `200 USD`
- US individual to US individual, both clean
- Expected: **allow** in all in-scope regimes

### NEG-2 — SG payroll
- Channel: `GIRO`, Amount: `4,500 SGD`
- SG corporate to SG individual (employee)
- Expected SG verdict: **allow**

### NEG-3 — Mid-size US-US ACH
- Channel: `ACH`, Amount: `8,000 USD`
- Two clean US corporates
- Expected US verdict: **allow** under correct rules
- Tests: ACH is not currency; SAR has no suspicion

### NEG-4 — Cross-border SG-US trade wire ($30K)
- Channel: `SWIFT`, Currency: `USD`, Amount: `30,000 USD`
- Two clean SMEs, no sanctions, no PEP, no high ML score
- Expected US verdict: **allow** under correct rules (not cash, no suspicion)
- Expected SG verdict: **allow**
- Status: **(EXPOSES BUG)** — current code fires SAR on amount

### NEG-5 — SG-domestic high-value clean wire
- Channel: `FAST`, Currency: `SGD`, Amount: `40,000 SGD`
- Two clean SG corporates
- Expected SG verdict: **allow** (not cash; no suspicion)
- Status: **(EXPOSES BUG)** — current code fires CTR on amount

---

## Group 10 — Verified contradiction cases

These contradictions arise from rules whose primary sources are verified. They will remain as durable contradictions even after the SAR/CTR simplifications are corrected.

### CONTRA-A — OFAC-only sanctions divergence
- Same setup as `OFAC-2`
- Cause: OFAC SDN ⊃ MAS TFS in some country lists (e.g., Venezuela, Cuba — on OFAC, not on MAS-TFS)
- Expected: **US block, SG allow** → contradiction
- **Durable.** This is the canonical real-world divergence. Verified primary sources on both sides.

### CONTRA-B — US has a bank cash threshold; SG has none (the *sharper* divergence)
- Same setup as `XR-1` and `XR-2`
- Cause: US CTR threshold is $10K USD for any bank cash transaction (verified §1010.311). Singapore has **no general bank cash threshold** at all (verified 2026-04-26 via MHA / acd.mlaw.gov.sg). Bank cash reporting in SG is purely suspicion-based via STR (CDSA s.45).
- Expected: **US flag, SG allow** → contradiction, on **any** US cash deposit > $10K in dual scope.
- **Durable** when both regimes are in scope **AND** the channel is cash, regardless of amount. Once our `US.CTR` rule is correctly cash-channel-gated AND the incorrect `SG.CTR` rule is removed or restricted to PSPM, this contradiction will be the canonical demonstration of the regimes' different design philosophies — US chose a hard reporting floor for cash; SG chose a pure suspicion-based duty.

### CONTRA-C — US-floor SAR vs SG-no-floor STR (low-value suspicious transaction)
- Channel: `SWIFT`, Currency: `USD`, Amount: `4,999 USD`
- Beneficiary on MAS-TFS but **not** on OFAC SDN
- Both in scope
- Expected US verdict: **allow** (below SAR floor; no OFAC match) — under correct rule, even if there were OFAC suspicion, the floor blocks SAR firing
- Expected SG verdict: **block** (MAS-TFS sanctions); STR also fires (any suspicion regardless of amount)
- Expected: **CONTRADICTION** (allow→block)
- **Durable.** Tests the asymmetry: US has a $5K floor for SAR even when suspicion exists; SG STR fires at any amount.

---

## Excluded scenarios — UNVERIFIED dependencies

The following test cases were intentionally **excluded** from this document because they depend on facts not yet verified against primary sources:

| Excluded scenario | Reason |
|---|---|
| SG PEP — domestic PEP triggers SG flag | MAS Notice 626 PEP scope (foreign / domestic / international-org breakdown) UNVERIFIED — paragraph and exact text not retrieved during verification pass. Listed in `RULES_VERIFICATION.md` open verifications. |
| SG PEP — international-organisation PEP | Same as above — uncertain whether MAS Notice 626 enumerates this as a third category |
| Contradiction: SG-domestic PEP in dual-scope wire (US allow, SG flag) | Depends on SG.PEP scope above |
| MAS Notice 626 paragraph-number citations in test assertions | Paragraph numbers UNVERIFIED |
| **General bank CTR threshold in Singapore (`SG-CTR-1` through `SG-CTR-4`)** | **Removed 2026-04-26.** Singapore banks do not have a general cash transaction reporting threshold. The S$20,000 figure I previously used is from the PSPM Act 2019, not MAS Notice 626. Cases were testing a rule that should not exist. |

When these scenarios are needed, the action is: read the official MAS Notice 626 PDF directly (links in `RULES_VERIFICATION.md`), update the YAML and this document with the verified facts, and add the test cases here.

---

## Categorisation of the 27 contradictions in current data

After running `replay-all` against the synthetic dataset, the contradictions break down as follows. This table is the most important Task 4 honesty disclosure: it shows which contradictions are **real** (verified, durable) vs **artifacts** of our own simplifications.

| Contradiction shape in DB | Count | Source | Durable after fixing simplifications? |
|---|---|---|---|
| `flag→allow` (US fires CTR or SAR floor; SG fires nothing) | 25 | Mostly artifacts of (i) SAR firing on amount alone (Group 2 bug); (ii) US.CTR firing regardless of channel (Group 1 bug); (iii) SG.CTR rule existing at all when SG has no general bank cash threshold (Group 6 correction). | **Mixed.** Most of these will remain after fixes — but the *meaning* changes: today they're "two over-firing rules disagree." After corrections, they become "US has a hard $10K cash floor; SG has none for general bank cash." That's the real, durable architectural divergence. |
| `block→flag` or `block→allow` (OFAC-only sanctions) | 2 | OFAC-only counterparties (`OFAC-2` shape) | **Yes** — verified primary sources on both sides. This is the real-world divergence Task 1 documents. |

The remaining 0 cases of `allow→flag` (or other shapes) — none in current data because the SAR over-firing on the US side masks any potential SG-side-only signals.

---

## How to run these as automated tests (future)

For now this document is a *manual* test plan. The next step would be:

1. Build a TypeScript unit-test harness in `worker/test/rules.test.ts` using `vitest`
2. Each test constructs a `TransactionContext` literal and calls `scoreTransaction(ctx, ml)`
3. Assert against the `ScoringResult` shape
4. CI runs on every push, blocks merge if a verified rule is broken

Until then, treat this document as the canonical specification for what the engine *should* do, and run the cases against `/api/score` (the ad-hoc scoring endpoint) to verify behaviour manually.
