# Task 1 — Selection and Research

## 1. Regulated Group: Standard Chartered

**Why Standard Chartered, specifically:**

The reference institution for this project is the Standard Chartered group, with two named operating entities corresponding to the two jurisdictions in scope:

- **Standard Chartered PLC** — the FTSE-100, UK-headquartered listed parent company.
- **Standard Chartered Bank, New York Branch** — the federally licensed US branch.
- **Standard Chartered Bank (Singapore) Limited** — the locally incorporated Singapore subsidiary.

Wherever the analysis below refers to "the bank" or "SCB," the relevant operating entity is the NY branch on the US side and the locally incorporated Singapore subsidiary on the SG side. The group-level parent ("PLC") is the consolidated supervisory unit at the UK level but is not itself the AML-regulated entity in either of the two jurisdictions in scope.

The group has two characteristics that make it an unusually instructive subject for a jurisdiction-aware AML transaction-monitoring tool:

1. **It operates at systemic scale on both sides of the chosen jurisdictional pair.**
   - **United States:** Standard Chartered Bank, New York Branch is a federally licensed branch supervised by the Federal Reserve Bank of New York and the New York State Department of Financial Services (NY DFS). The branch is one of the larger non-US banks clearing US-dollar payments through CHIPS and Fedwire.
   - **Singapore:** Standard Chartered Bank (Singapore) Limited is a locally incorporated bank under Section 7 of the Banking Act, supervised by the Monetary Authority of Singapore (MAS). Singapore is one of SCB's two largest hubs (alongside Hong Kong) and houses the bank's ASEAN regional infrastructure.

2. **It has a documented, recent history of AML/sanctions failures across both regimes.** This is not a hypothetical compliance challenge:
   - **2012** — US$327M penalty (US DOJ, Federal Reserve, NY DFS, OFAC) for systematic stripping of identifying information from USD wires linked to Iran sanctions.
   - **2014** — US$300M NY DFS penalty for AML transaction-monitoring failures *that the bank had been ordered to fix in the 2012 consent order* — a remediation failure, not a primary failure.
   - **2019** — US$1.1B aggregate settlement (US DOJ, Federal Reserve, OFAC, NY DFS, UK FCA) for further sanctions violations affecting Iran, Burma, Sudan and Cuba.
   - **2023–2024** — MAS strengthened Notice 626 enforcement following the S$3B Singapore money-laundering case, in which several SCB accounts were among those used (along with accounts at multiple other banks).

   The repeated remediation failures matter for a RegTech argument: SCB has spent more than a decade investing in AML monitoring and *still* gets penalised. That is exactly the gap a jurisdiction-aware tool is supposed to close.

A clean alternative such as DBS or HSBC could have been chosen, but SCB's combination of (a) a real US branch with USD-clearing exposure, (b) a major locally-incorporated Singapore presence, and (c) public, citable enforcement history makes the divergence between the two regimes legible rather than abstract.

---

## 2. Domain: AML transaction monitoring (with related CDD / EDD implications)

**Why AML transaction monitoring specifically:**

This project is scoped to AML *transaction monitoring* and the customer-due-diligence (CDD/EDD) data points it consumes — counterparty PEP status, sanctions-list match, beneficial-ownership chain, customer risk rating. It is **not** a full KYC onboarding tool: biometric capture, identity-document verification, and KYB onboarding workflows are out of scope (those would integrate with specialist providers; see Task 2 §4).

The lecture material covers six possible domains. AML transaction monitoring was selected for four reasons:

1. **It is the largest extant RegTech segment.** Industry estimates put AML transaction-monitoring and KYC tooling at roughly 30–40% of the global RegTech spend. The buyer (the bank's MLRO and CCO function) is established and has a budget line.

2. **It is one of the few areas where the 2025–2026 US deregulatory wave has not gutted the mandate.** The lecture deck (Part 3, slides 10–12) shows that fair-lending and reputational-risk RegTech tools have lost their regulatory rationale in the US. AML, by contrast, sits on the Bank Secrecy Act (1970), the USA PATRIOT Act (2001) and the Anti-Money Laundering Act of 2020 — none of which have been weakened. If anything, the 2025 executive-order-driven removal of "reputational risk" concepts from federal supervisory materials (White House EO 14331, "Guaranteeing Fair Banking for All Americans," August 2025, with a 180-day implementation window for agencies) *complicates* AML by removing supervisory cover for de-risking lawful-but-disfavoured customer categories.

3. **The TD Bank precedent makes the cost of failure concrete.** The lecture's TD Bank case study (Oct 2024 — US$3B BSA guilty plea, the largest financial-crimes penalty in US banking history) is one year old as of submission. The remediation market that follows TD's plea is the immediate addressable market for any new AML RegTech tool.

4. **The two jurisdictions chose meaningfully different policy architectures.** This is the heart of Task 1 — there has to be real divergence. Section 3 below documents nine specific points where US and Singapore politicians and regulators have made different design choices.

---

## 3. Regulatory Divergence — United States vs Singapore

The two jurisdictions agree on the FATF baseline (both are FATF members in good standing). They diverge on almost every implementation detail. The table below maps the divergences a jurisdiction-aware tool must encode.

| # | Dimension | United States | Singapore |
|---|---|---|---|
| 1 | **Primary AML statute** | Bank Secrecy Act (1970, codified at 31 U.S.C. § 5311 et seq.); USA PATRIOT Act (2001); Anti-Money Laundering Act of 2020 (AMLA, in NDAA 2021). | Corruption, Drug Trafficking and Other Serious Crimes (Confiscation of Benefits) Act 1992 ("CDSA"); Terrorism (Suppression of Financing) Act 2002 ("TSOFA"). |
| 2 | **Lead administrator** | FinCEN (administration); OCC, Fed, FDIC, NCUA (prudential examination); OFAC (sanctions); IRS-CI (criminal). Plurality of regulators. | Monetary Authority of Singapore — single integrated regulator. Suspicious-transaction filings go to the Suspicious Transaction Reporting Office (STRO) within the Singapore Police Force's Commercial Affairs Department. |
| 3 | **Suspicious activity reporting threshold** | SAR mandatory if a transaction is suspicious *and* aggregates ≥ US$5,000 (banks), ≥ US$2,000 (MSBs). Filed with FinCEN within 30 days. | STR has **no monetary threshold** under CDSA s.45 (formerly s.39 pre-2024) — any reasonable suspicion triggers the duty, regardless of amount. Filed with STRO. |
| 4 | **Currency transaction reporting** | CTR mandatory for cash transactions > US$10,000 in a business day (FinCEN Form 112; 31 CFR §1010.311). | **No general bank cash transaction reporting threshold.** Singapore banks rely on suspicion-based STR for cash flows. The S$20,000 figure that appears in some compliance guides comes from the Precious Stones and Precious Metals (Prevention of Money Laundering and Terrorism Financing) Act 2019 — that threshold applies to PSPM dealers and to banks only when handling cash for that narrow category, not to ordinary bank cash flows. **This is one of the largest single divergences in the dataset.** |
| 5 | **PEP scope** | "Senior Foreign Political Figure" (31 CFR §1010.605) — primarily *foreign* PEPs; domestic PEPs not formally defined under federal AML rules. | MAS Notice 626 takes a broader-than-US approach to PEP coverage, generally including foreign and domestic PEPs as well as senior officials of international organisations. The exact paragraph reference and precise scope wording remain to be primary-source verified before final submission (see `worker/RULES_VERIFICATION.md`); secondary sources and FATF Recommendation 12 alignment support the broader-than-US direction. |
| 6 | **Sanctions regime** | OFAC primary sanctions are extraterritorial via USD clearing — any USD-denominated wire touching the US correspondent network is in scope. SDN list, sectoral sanctions, 50% rule. | MAS Targeted Financial Sanctions implement UN Security Council resolutions and MAS-specific designations. **No extraterritorial reach equivalent to OFAC.** This is the single biggest operational divergence. |
| 7 | **Beneficial ownership** | Corporate Transparency Act (CTA) BOI reporting at FinCEN — enacted 2021, came into force 2024, but largely paused/de-prioritised under the current US administration in 2025. Effective coverage uncertain at submission. | ACRA Register of Registrable Controllers (RORC) — established under the Companies Act since 2017, accessible to law-enforcement and regulators, in active enforcement. Enforced and stable. |
| 8 | **AI in compliance models** | OCC Bulletin 2026-13 (Apr 2026) — principles-based MRM, **explicitly excludes GenAI and agentic AI** "due to their novel and rapidly evolving nature." Replaces SR 11-7. Applies to banks > US$30B. | MAS FEAT Principles (2018) + MAS Veritas methodology (Phases 1–3, 2021–2024) + MAS consultation on agentic AI (2024–2025). Comprehensive AI-specific governance — characterised in the lecture as the second-most comprehensive AI/ML MRM regime globally after Canada's OSFI E-23. |
| 9 | **2026 direction of travel** | Mixed — AML core stable, but the Apr 2026 interagency rule prohibiting supervisory use of "reputational risk" cuts off one of the historical justifications for *de-risking* lawful-but-disfavoured industries (crypto, cannabis, payday). Net effect: ambiguity about how aggressively banks should off-board high-AML-risk lawful customers. | Tightening — post-2023 S$3B case drove enforcement intensification at MAS, source-of-wealth scrutiny strengthened in Notice 626 amendments, and the 2024–2025 agentic-AI consultation signals MAS is actively expanding its perimeter. |

**The political choices these encode:**

- **The US chose breadth and extraterritoriality through USD clearing.** Singapore did not — it chose principled domestic enforcement aligned to FATF, but without the dollar-clearing lever.
- **The US chose a fragmented regulator landscape** (FinCEN + OCC + Fed + FDIC + state regulators + OFAC). Singapore chose unified MAS oversight.
- **Singapore chose to build out an AI-specific governance regime** (FEAT, Veritas) before US federal regulators did. The US Apr 2026 OCC bulletin explicitly leaves GenAI ungoverned at the prudential level — a deliberate political choice to avoid constraining innovation, with the side-effect of leaving banks exposed.
- **Both jurisdictions chose principles-based suspicion reporting**, but the US bolted a $5,000 floor onto its SAR rule whilst Singapore did not — a small drafting difference with large operational consequences for low-value structuring detection.
- **The cash-reporting architecture is asymmetric.** The US has an absolute cash-deposit threshold (CTR at $10K under 31 CFR §1010.311); Singapore has nothing equivalent at the general bank level — every cash flow is judged on suspicion alone. This produces a structural class of contradictions in the prototype: a $10,001 cash deposit in dual scope is `US flag / SG allow` because there is no SG rule to fire on amount alone.
- **The 2025 US rollback of the Corporate Transparency Act**, contrasted with Singapore's stable Register of Registrable Controllers, means the same ultimate beneficial owner can be visible in Singapore and invisible in the US — directly relevant to a tool that screens corporate counterparties.

A jurisdiction-aware AML tool cannot simply "switch country" — every one of these nine dimensions changes the alert logic, the report format, the data fields collected at onboarding, and the regulator the output is ultimately addressed to.

---

## 4. References and URLs

### Standard Chartered (entity)

- Standard Chartered PLC investor relations landing page: <https://www.sc.com/en/investors/>
- Standard Chartered Bank, New York Branch — searchable on the Federal Reserve National Information Center: <https://www.ffiec.gov/npw/Institution/TopHolders/541101>  *(if the deep link is restructured, search "Standard Chartered Bank, New York Branch" from <https://www.ffiec.gov/npw/>)*
- Standard Chartered Bank (Singapore) Limited overview: <https://www.sc.com/sg/about-us/>

### Standard Chartered enforcement history

- US DOJ, "Standard Chartered Bank Agrees to Pay More Than $1 Billion to Resolve Sanctions Violations" (April 2019). Stable landing page: <https://www.justice.gov/opa/press-releases>  *(search "Standard Chartered" + 2019)*
- NY DFS 2014 consent order (transaction-monitoring failures). Stable landing page: <https://www.dfs.ny.gov/reports_and_publications/press_releases>  *(search 2014)*
- NY DFS 2012 consent order (sanctions stripping). Stable landing page: <https://www.dfs.ny.gov/reports_and_publications/press_releases>  *(search 2012)*

### United States — AML statutes and guidance

- Bank Secrecy Act, FinCEN landing page: <https://www.fincen.gov/resources/statutes-and-regulations/bank-secrecy-act>
- USA PATRIOT Act §312, §326 (correspondent accounts; CIP rule): <https://www.fincen.gov/resources/statutes-and-regulations/usa-patriot-act>
- Anti-Money Laundering Act of 2020 (AMLA): <https://www.fincen.gov/anti-money-laundering-act-2020>
- FFIEC BSA/AML Examination Manual: <https://bsaaml.ffiec.gov/manual>
- FinCEN SAR filing instructions (Form 111): <https://www.fincen.gov/resources/filing-information>
- FinCEN CTR (Form 112) and filing instructions — stable landing: <https://www.fincen.gov/resources/filing-information>  *(direct PDF paths change; search "FinCEN Form 112" from this page)*
- Underlying CTR rule: 31 CFR §1010.311 — eCFR: <https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-C/section-1010.311>
- OFAC sanctions programs and SDN list: <https://ofac.treasury.gov/sanctions-programs-and-country-information>
- OCC Bulletin 2026-13 (Model Risk Management): <https://www.occ.treas.gov/news-issuances/bulletins/2026/bulletin-2026-13.html>
- FinCEN Beneficial Ownership Information rule: <https://www.fincen.gov/boi>

### Singapore — AML statutes and guidance

- Corruption, Drug Trafficking and Other Serious Crimes (Confiscation of Benefits) Act 1992 — Singapore Statutes Online (search): <https://sso.agc.gov.sg/Search/Browse/Act>  *(filter for "Corruption, Drug Trafficking and Other Serious Crimes")*
- Terrorism (Suppression of Financing) Act 2002 — Singapore Statutes Online (search): <https://sso.agc.gov.sg/Search/Browse/Act>  *(filter for "Terrorism (Suppression of Financing)")*
- MAS Notice 626 — Prevention of Money Laundering and Countering the Financing of Terrorism — Banks: <https://www.mas.gov.sg/regulation/notices/notice-626>
- MAS Targeted Financial Sanctions landing page: <https://www.mas.gov.sg/regulation/anti-money-laundering>
- MAS FEAT Principles (2018) and Veritas updates — stable MAS landing for AI in finance: <https://www.mas.gov.sg/development/fintech/veritas>
- ACRA Register of Registrable Controllers — stable landing: <https://www.acra.gov.sg/>  *(search "Register of Registrable Controllers")*
- Singapore Police Force — Suspicious Transaction Reporting Office (STRO): <https://www.police.gov.sg/>  *(navigate via Commercial Affairs Department → STRO; deep links restructure)*
- MoneySENSE / MHA references confirming no general bank cash-reporting threshold in SG: <https://www.mha.gov.sg/>  *(search for the AML ministerial statement; the absence of a general bank CTR is corroborated in MAS supervisory FAQs)*

### 2023 Singapore S$3B money-laundering case (regulatory context)

- Straits Times case file: <https://www.straitstimes.com/multimedia/the-billion-dollar-money-laundering-case>
- MAS supervisory follow-up — penalties on nine financial institutions (June 2024). Stable landing: <https://www.mas.gov.sg/news>  *(search "composition penalties" + 2024)*

### Lecture cross-references

- US debanking / reputational-risk rule (effective 9 June 2026): White House EO 14331, "Guaranteeing Fair Banking for All Americans" (Aug 2025): <https://www.whitehouse.gov/presidential-actions/2025/08/guaranteeing-fair-banking-for-all-americans/>
- FATF mutual-evaluation reports (Singapore 2016 + follow-up; United States 2016 + follow-up): <https://www.fatf-gafi.org/en/countries.html>

*All URLs to be verified before final submission — regulatory sites restructure paths frequently. Where a deep-link target appears to have moved, fall back to the regulator's stable landing page noted above and search by document title.*

---

## 5. Verification status of regulatory claims in this document

To keep the analytical claims separable from the rule engine's behaviour, the table below records the verification status of the most material regulatory specifics. Items marked UNVERIFIED should be primary-source confirmed before final submission.

| Claim | Status | Source authority |
|---|---|---|
| US CTR threshold = $10,000 cash; rule cite 31 CFR §1010.311 | VERIFIED | eCFR (link in §4) |
| US SAR floor = $5,000 + suspicion (banks); 30-day filing | VERIFIED | 31 CFR §1020.320(a)(2); FinCEN |
| US PEP scope = "Senior Foreign Political Figure" only | VERIFIED | 31 CFR §1010.605 |
| OFAC extraterritoriality via USD clearing through NY | VERIFIED | OFAC sanctions programs guidance |
| Singapore STR — no monetary floor — CDSA s.45 (formerly s.39 pre-2024) | VERIFIED | Singapore Police Force / STRO official page |
| Singapore — **no** general bank CTR threshold; cash reporting is suspicion-based | VERIFIED | MAS supervisory FAQs; MHA AML ministerial statement |
| Singapore PEP scope (broader than US — domestic + foreign + IO) | UNVERIFIED — direction supported by FATF R.12 alignment, exact MAS Notice 626 paragraph reference still to confirm | MAS Notice 626 (primary text not yet quoted in `worker/RULES_VERIFICATION.md`) |
| OCC Bulletin 2026-13 excludes GenAI / agentic AI from MRM | VERIFIED | OCC bulletin landing page (link in §4) |
| EO 14331 (Aug 2025) directs removal of "reputational risk" supervisory concepts | VERIFIED | White House EO landing page (link in §4) |
| 2024–2025 MAS consultation on agentic AI | VERIFIED | MAS Veritas landing |

This table mirrors the discipline applied to the rule engine itself in `worker/RULES_VERIFICATION.md`: any claim that cannot be quoted from a primary regulator page is flagged as UNVERIFIED rather than asserted with confidence.
