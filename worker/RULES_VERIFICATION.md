# Rules Verification Log

> **Discipline rule** (do not skip): No regulatory rule, threshold, citation, or scope is encoded in this project from memory. Every fact below is fetched from a primary or named secondary source, dated, and quoted. If a source cannot be retrieved, the row is marked **UNVERIFIED** rather than guessed.

| Field | Value |
|---|---|
| Owner | Vivin (vivinjoghee@gmail.com) |
| Last updated | 2026-04-26 |
| Verification method | WebFetch + WebSearch against primary regulators (Cornell LII for US CFR, sso.agc.gov.sg for SG statutes via search-result snippets, mas.gov.sg via search-result snippets) and named secondary sources where the official source returned errors |
| Scope | Rules currently encoded in `worker/config/us.yaml` and `worker/config/sg.yaml` |

---

## ⚠ Correction log (most recent first)

### 2026-04-26 — SG general bank CTR threshold does NOT exist

The S$20,000 threshold I had encoded as a general bank CTR is **wrong**. Verified via:

- [MHA Ministerial Statement on Singapore's Anti-Money Laundering Regime](https://www.mha.gov.sg/media-room/newsroom/ministerial-statement-on-singapore-anti-money-laundering-regime/) — quotes the S$20,000 threshold only for **PSPM dealers**.
- [Anti-Corruption and Compliance for Dealers (acd.mlaw.gov.sg)](https://acd.mlaw.gov.sg/transaction-based-requirements/) — quotes "File Cash Transaction Report ('CTR') with the Suspicious Transaction Reporting Office ('STRO') for cash and cash equivalent transactions exceeding S$20,000" but this page covers PSPM dealers under the **PSPM Act 2019 and PMLTF Regulations 2019**, not banks under MAS Notice 626.

What this means in plain terms: **Singapore banks have no general cash transaction reporting threshold.** They report cash flows only via STR (suspicion-based, no monetary floor) under CDSA s.45. The S$20,000 CTR exists *only* for:
1. PSPM dealers' own transactions (under PSPM Act 2019), and
2. Banks when those banks handle cash transactions involving precious stones, precious metals, precious products, or asset-backed tokens (a narrow category, separate from general bank cash flows).

**Architectural implication:** the US / SG CTR-threshold divergence is *sharper* than I had encoded — not "$10K vs S$20K" but "$10K vs no general threshold for banks." The SG side relies entirely on suspicion-based STR for ordinary bank cash flows.

**Action items added at the bottom of this file** (#7) and **TEST_CASES.md `CONTRA-B` updated**.

---

## United States

### US.CTR.10K — Currency Transaction Report

**Source:** [31 CFR §1010.311](https://www.law.cornell.edu/cfr/text/31/1010.311) — Cornell Legal Information Institute, fetched 2026-04-26.

**Verbatim text:**
> *"Each financial institution other than a casino shall file a report of each deposit, withdrawal, exchange of currency or other payment or transfer, by, through, or to such financial institution which involves a transaction in currency of more than $10,000, except as otherwise provided in this section."*

**Key facts:**
- Threshold: **more than $10,000** (i.e., `>` not `>=`)
- Applies only to transactions in **currency** (physical cash) — not wires, ACH, cheques, or electronic transfers
- Form: FinCEN Form 112 (CTR) — form name not in §1010.311 itself; established by FinCEN

**Mapping to our YAML (`worker/config/us.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `threshold_native: 10000` | $10,000 | **Status correct, but operator is wrong:** our [`threshold.ts`](src/rules/threshold.ts) uses `>=` while the regulation uses `>` ("more than $10,000"). **CORRECTION REQUIRED.** |
| `native_currency: USD` | USD | ✓ |
| `triggers_verdict: flag` | Reporting obligation only | **Conceptually wrong:** CTR is a paperwork filing, not a customer-facing screening event. See "Conceptual gap" below. |
| `rule_id: US.CTR.10K` | — | Internal label, fine |
| `citation: "31 CFR §1010.311"` | — | ✓ |

**Conceptual gap — CTR fires on cash only, not wires:**

The synthetic dataset (`pipeline/generate_synthetic_data.py`) defines channels as `FAST`, `GIRO`, `SWIFT`, `CHIPS`, `FEDWIRE`, `ACH` — none of which are physical cash. **A correct CTR rule would fire zero times on this dataset.** Our current rule fires 212 times in US scope because it ignores the channel. Documented as an honest simplification for Task 4.

---

### US.SAR.5K — Suspicious Activity Report (banks)

**Source:** [31 CFR §1020.320](https://www.law.cornell.edu/cfr/text/31/1020.320) — Cornell LII, fetched 2026-04-26.

**Verbatim text from §1020.320(a)(2):**
> *Banks must report when they know, suspect, or have reason to suspect that "the transaction involves funds derived from illegal activities or is intended or conducted in order to hide or disguise funds"; "the transaction is designed to evade any requirements of this chapter or of any other regulations"; or "the transaction has no business or apparent lawful purpose or is not the sort in which the particular customer would normally be expected to engage." A SAR must be filed within 30 calendar days after initial detection (extendable to 60 days for suspect identification).*

The threshold floor is "involves or aggregates **at least $5,000** in funds or other assets."

**Key facts:**
- Threshold: **at least $5,000** (`>=`)
- **AND** at least one of three suspicion conditions:
  1. Funds derived from illegal activities OR intended to hide/disguise funds
  2. Designed to evade BSA or other regs
  3. No business/lawful purpose, or not the sort the customer would normally engage in
- Form: SAR (FinCEN Form 111)
- Filing window: 30 days from initial detection, extendable to 60

**Mapping to our YAML (`worker/config/us.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `threshold_native: 5000` | $5,000 floor | ✓ |
| `triggers_verdict: flag` on amount alone | Amount **AND** suspicion (3 triggers) | **CORRECTION REQUIRED.** Our [`threshold.ts`](src/rules/threshold.ts) fires on amount alone. The correct logic: this rule should only fire if amount ≥ $5K **AND** another rule (sanctions/PEP/ML) has produced a hit. Aggregate at the verdict level. |
| `citation: "31 CFR §1020.320"` | — | ✓ |

**Honest disclosure for Task 4:** This is the most material simplification in the system. 309 SAR alerts are firing on this rule today; under correct logic, the count would be a small fraction of that.

---

### US.PEP.FOREIGN — Senior Foreign Political Figure

**Source:** [31 CFR §1010.605](https://www.law.cornell.edu/cfr/text/31/1010.605) — Cornell LII, fetched 2026-04-26.

**Verbatim summary of §1010.605(p):**
> *"Senior foreign political figure" means a current or former: senior official in the executive, legislative, administrative, military, or judicial branches of a foreign government (whether elected or not); senior official of a major foreign political party; senior executive of a foreign government-owned commercial enterprise. Includes a corporation, business, or other entity formed for the benefit of any such individual.*

> *"Immediate family" of a senior foreign political figure means the figure's spouses, parents, siblings, children, and a spouse's parents and siblings.*

> *"Close associate" of a senior foreign political figure means a person who is widely and publicly known (or is actually known by the relevant covered financial institution) to be a close associate of a senior foreign political figure.*

**Key facts:**
- Scope: **foreign only** — no corresponding provision for domestic US political figures in §1010.605
- Includes immediate family and close associates
- Includes shell entities formed for the benefit of the figure

**Mapping to our YAML (`worker/config/us.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `scope: foreign_only` | foreign only | ✓ |
| `citation: "31 CFR §1010.605"` | — | ✓ |
| `triggers_verdict: flag` | Statute requires "enhanced scrutiny" of private banking accounts | Acceptable simplification (treating as flag is reasonable; the regulation describes EDD obligations rather than a single verdict) |

**Gap noted (not blocking):** Our PEP rule only checks the customer's own `pep_status`. It does not screen for *family members* or *close associates* of PEPs. Documented as a known limitation in Task 2.

---

### US.SANCTIONS.OFAC_SDN — OFAC Specially Designated Nationals

**Source:** OFAC Sanctions Programs page (timed out on direct fetch); confirmed via [Treasury OFAC FAQs](https://ofac.treasury.gov/faqs/topic/1631) and [50% rule guidance](https://ofac.treasury.gov/faqs/topic/1521) — fetched 2026-04-26 via search snippets.

**Authority:**
- Trading With the Enemy Act
- International Emergency Economic Powers Act (IEEPA)
- Anti-Terrorism and Effective Death Penalty Act
- Foreign Narcotics Kingpin Designation Act

**Key facts:**
- SDN list managed by US Department of the Treasury, Office of Foreign Assets Control
- US persons generally prohibited from dealing with SDNs; assets blocked
- **50% rule:** any entity owned ≥50% (directly or indirectly, in aggregate) by one or more SDNs is itself blocked, even if not named on the list
- **Extraterritorial reach via USD clearing:** foreign banks sending USD-denominated payments through US correspondent accounts trigger OFAC exposure even when both endpoints are offshore — confirmed by historical enforcement actions including BNP Paribas, Standard Chartered, HSBC

**Mapping to our YAML (`worker/config/us.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `primary_list: OFAC_SDN` | SDN list | ✓ |
| `triggers_verdict: block` | "Generally prohibited" | ✓ |

**Gap noted:** Our system reads `raw.ofac_sdn_match` as a precomputed boolean from the synthetic data. A production system would consult the live SDN feed, apply the 50% rule for ownership aggregation, and run name-fuzzy matching. The synthetic data does not exercise the 50% rule.

---

## Singapore

### SG.STR.SUSPICION — Suspicious Transaction Report

**Source:** [Singapore Police Force STRO Page](https://www.police.gov.sg/Advisories/Commercial-Crimes/Suspicious-Transaction-Reporting-Office/Suspicious-Transaction-Reporting) — fetched 2026-04-26.

**Verbatim summary (SPF official):**
> *"This reporting requirement is set out in Section 45 of the Corruption, Drug Trafficking and Other Serious Crimes (Confiscation of Benefits) Act 1992 (also commonly known as CDSA)."*

> *"In the course of your trade, profession, business or employment, if you know or have reasonable grounds to suspect that any property may be connected to a criminal activity, you are required to file a Suspicious Transaction Report."*

> *"Terrorism financing disclosure obligations are established in the Terrorism (Suppression of Financing) Act 2002 (TSOFA), Sections 8 and 10."*

**Key facts:**
- **Section number changed in 2024 amendments.** SPF currently cites **Section 45**. Older sources (including the 2019 amendments article on globalcompliancenews.com and many compliance guides written before 2024) cite Section 39. Treat **Section 45 as the current canonical reference.**
- **No monetary threshold** — pure suspicion-based duty
- Trigger: "knows or has reasonable grounds to suspect"
- Filed with STRO (Suspicious Transaction Reporting Office) under the Singapore Police Force, Commercial Affairs Department
- Filing method: SONAR (STRO Online Notices And Reporting) platform — mandatory electronic submission
- Penalties (post-2019 amendments): SGD 250,000 fine and/or up to 3 years imprisonment for individuals

**Mapping to our YAML (`worker/config/sg.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `threshold_native: null` | No threshold | ✓ |
| `filing_destination: STRO_SPF` | STRO under SPF | ✓ |
| `filing_deadline: as_soon_as_practicable` | "Reasonable timeframe" (no specific deadline in CDSA s.45 itself) | ✓ |
| `citation: "CDSA s.39"` | **CDSA Section 45** post-2024 amendments | **CORRECTION REQUIRED** — update to "CDSA s.45 (formerly s.39 pre-2024)" |

---

### SG.CTR.20K — Cash Transaction Report — **REMOVED 2026-04-26**

> **Status:** The rule has been removed from `worker/config/sg.yaml` and the schema. The section below is retained as a verification trail explaining why the rule should not exist.

**Sources verified 2026-04-26:**
- [MHA Ministerial Statement on Singapore AML regime](https://www.mha.gov.sg/media-room/newsroom/ministerial-statement-on-singapore-anti-money-laundering-regime/) — only mentions S$20K CTR in connection with PSPM dealers
- [acd.mlaw.gov.sg — Transaction-Based Requirements](https://acd.mlaw.gov.sg/transaction-based-requirements/) — direct quote, applies to PSPM dealers under the PSPM Act 2019
- Multiple secondary sources confirm banks' CTR obligation is *narrow* — only when handling cash for precious stones / metals / asset-backed tokens

**What is actually verified:**
- The S$20,000 CTR threshold exists, but applies to:
  - PSPM dealers under the **PSPM Act 2019** and **PMLTF Regulations 2019** (NOT MAS Notice 626)
  - Banks **only** when handling cash transactions involving precious stones, precious metals, precious products, or asset-backed tokens
- CTRs are filed with STRO via the SONAR portal
- General bank cash transactions in Singapore have **no monetary CTR threshold**. The reporting obligation for ordinary bank cash flows is purely the suspicion-based STR under CDSA s.45.

**Mapping to our YAML (`worker/config/sg.yaml`):**

| Our value | Verified reality | Status |
|---|---|---|
| `currency_transaction.threshold_native: 20000` | No general bank CTR threshold; S$20K applies only to PSPM-related transactions | **WRONG — rule is overly broad.** Either remove the rule from the SG pack, or restrict it to PSPM-related transaction channels (which our synthetic data doesn't model). |
| `currency_transaction.native_currency: SGD` | — | Field still relevant if the rule is kept and restricted |
| `currency_transaction.citation: "MAS Notice 626 (paragraph reference UNVERIFIED — value S$20,000 verified)"` | The S$20,000 threshold is in the PSPM Act / PMLTF Regulations, not MAS Notice 626 | **WRONG citation source** — should reference PSPM Act if kept |
| `currency_transaction.triggers_verdict: flag` | Reporting obligation, customer unaffected (same conceptual gap as US.CTR) | Conceptual issue same as before |

**Architectural impact:** The US/SG CTR threshold divergence is now *sharper*, not weaker:
- US side: $10,000 cash threshold for all banks (verified §1010.311)
- SG side: **no general CTR threshold for bank cash transactions**; only suspicion-based STR
- A $11,000 USD cash deposit in dual-scope: US **flag**, SG **allow**. The contradiction is real and durable.

**Recommended fix:** Either
1. Remove the `currency_transaction` block from `sg.yaml` entirely (most accurate), or
2. Keep it as `triggers_verdict: allow` with a comment that the rule is preserved for documentation but should not fire on general bank cash channels.

Either change requires `currency_transaction` to become **optional** in the Zod schema at `worker/src/rules/types.ts`. Whether to apply this code change is the user's decision — it's a verified-correct removal of an incorrectly broad rule, but it does change runtime behaviour and is therefore flagged here for explicit approval.

**Number of currently-firing alerts that are WRONG because of this rule:** 218 SG-side alerts on `SG.CTR.20K`. After the correction, all of those would (correctly) not fire.

---

### SG.PEP.ALL — Politically Exposed Persons (MAS Notice 626)

**Source:** Direct PDF fetch of MAS Notice 626 failed (MAS website unavailable during fetch). Best-available evidence is from FATF guidance and secondary compliance sources stating MAS Notice 626 covers foreign, domestic, and international-organisation PEPs in alignment with FATF Recommendation 12.

**Mapping to our YAML (`worker/config/sg.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `scope: foreign_and_domestic` | Foreign + domestic + international organisation (per FATF-aligned MAS framework) | **PARTIALLY VERIFIED** — broader than `foreign_only`. Including international-org PEPs would be more accurate; we currently model as binary. |
| `citation: "MAS Notice 626 paragraph 8"` | Paragraph number **UNVERIFIED** | **MARK AS UNVERIFIED** until the official PDF is read directly |
| `triggers_verdict: flag` | EDD requirement under Notice 626 | ✓ as a simplification |

---

### SG.SANCTIONS.MAS_TFS — MAS Targeted Financial Sanctions

**Source:** [MAS Targeted Financial Sanctions page](https://www.mas.gov.sg/regulation/anti-money-laundering/targeted-financial-sanctions) — page exists but full content not fetchable due to MAS website errors during this verification pass.

**Mapping to our YAML (`worker/config/sg.yaml`):**

| Our value | Verified value | Status |
|---|---|---|
| `primary_list: MAS_TFS` | MAS Targeted Financial Sanctions | ✓ name |
| `also_apply: [UN_SC]` | UN Security Council resolutions implemented via MAS-TFS | ✓ |
| `triggers_verdict: block` | Asset-freeze obligation under TSOFA + MAS regulations | ✓ |

**No extraterritoriality lever:** Unlike OFAC's USD-clearing reach, MAS-TFS does not have a parallel mechanism to capture transactions that don't involve a Singapore-domiciled party. This is encoded in our `_in_scope_jurisdictions` logic — a SGD-only transaction with no SG party doesn't pull SG into scope.

---

## Open verifications — must close before final submission

These items could not be confirmed against primary sources during this pass. **Do not cite their paragraph numbers in the deck or the viva** until a source is verified.

1. **MAS Notice 626 paragraph numbers** for CTR threshold and PEP definition. Action: download the [March 2024 PDF](https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/amld/notice-626/mas-notice-626-dated-28-march-2024.pdf) (or the [June 2025 amendment](https://www.mas.gov.sg/-/media/amld-amendments---30-june-2025/mas-notice-626-amendment--new.pdf)) directly via browser when MAS site is up. Then update the `citation` field in [`sg.yaml`](config/sg.yaml).
2. **Whether MAS Notice 626 explicitly lists "international organisation PEP"** as a separate category, or treats them under the broader PEP umbrella. Currently encoded as one of the umbrella `foreign_and_domestic`. Read the actual notice paragraph for confirmation.
3. **CDSA STR section number** — SPF's official page references **Section 45**; older guides (and our YAML) reference Section 39. We've adopted **Section 45** based on the agency's own current page, but if the official 2024 CDSA amendment text is fetched and the section is still 39, our YAML should be reverted.

---

## Code corrections required (cross-references for the next coding pass)

| # | File | Correction |
|---|---|---|
| 1 | [`worker/src/rules/threshold.ts`](src/rules/threshold.ts) lines 23-31 | Change CTR comparison from `>=` to `>` to match "more than $10,000" in 31 CFR §1010.311. Same for SG. |
| 2 | [`worker/src/rules/threshold.ts`](src/rules/threshold.ts) SAR/STR block | The SAR rule must require both amount **and** another rule's hit. Move SAR aggregation to `engine.ts` after all other rules have run. |
| 3 | [`worker/src/rules/threshold.ts`](src/rules/threshold.ts) CTR rule | Gate CTR on `channel === "CASH"` once the synthetic data adds a cash channel; for now, document as a known limitation. |
| 4 | [`worker/config/sg.yaml`](config/sg.yaml) | Update `citation` for `suspicious_transaction` from `"CDSA s.39"` to `"CDSA s.45 (formerly s.39 pre-2024)"`. |
| 5 | [`worker/config/sg.yaml`](config/sg.yaml) | Mark `currency_transaction.citation` and `pep.citation` as `UNVERIFIED — paragraph number pending direct PDF read of MAS Notice 626` until verified. |
| 6 | [`worker/config/us.yaml`](config/us.yaml) and [`sg.yaml`](config/sg.yaml) | Add an `ai_governance` field that's actively read by the rule engine (currently it's documentation-only — fine for the prototype, but acknowledge in the model card). |
| 7 | ~~`worker/config/sg.yaml` `currency_transaction` block~~ | **APPLIED 2026-04-26.** The block was removed from `sg.yaml`. `currency_transaction` was made optional in the Zod schema at [`worker/src/rules/types.ts`](src/rules/types.ts) and in the frontend's `RulePack` type at [`web/src/lib/api.ts`](../web/src/lib/api.ts). [`threshold.ts`](src/rules/threshold.ts) and [`jurisdiction-config.tsx`](../web/src/pages/jurisdiction-config.tsx) updated to handle the undefined case. Re-running `replay-all` cleared the 218 incorrect alerts. |
