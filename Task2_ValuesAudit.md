# Task 2 — Values Audit

> *"There are no correct answers. There are shallow answers."* — Assignment brief

This audit answers the four questions before any tool design begins, because the design choices the tool eventually makes will be downstream of the values stated here. Where there are tensions or honest weaknesses, they are named rather than smoothed.

---

## 1. Company mission, stage, scope

**Hypothetical company:** Strait Compliance Pte. Ltd.

**Headquarters:** Singapore (with a small US presence in New York, opened to support correspondent-banking clients of the New York USD-clearing market).

**Mission statement:**
> *Strait Compliance helps mid-sized banks running cross-border USD and SGD corridors detect financial crime that single-jurisdiction monitoring systems were never built to see — and to do so in a way the bank's regulator can verify, not merely accept.*

The mission is deliberately narrow. It does *not* claim to "fight financial crime" or "make banking safer" — those are claims a Tier-1 vendor can credibly make, and we are not one. We claim a specific competence: cross-border, multi-jurisdiction transaction monitoring with explainability that survives examination.

**Core values (in priority order, not all of them comfortable):**

1. **Catching crime is the only durable form of compliance.** A monitoring system that produces clean alerts but misses real layering will lose its client a banking licence. We optimise for genuine detection first, examiner-friendliness second.
2. **Explainability is not the same as documentation.** A SHAP plot that a bank examiner can interrogate is worth more than a 200-page policy manual nobody reads. We invest in the former and refuse to sell the latter.
3. **We accept that we cannot serve everyone.** Tier-1 banks build in-house; Tier-4 banks cannot afford us. We sit in the middle — and we will not pretend our tool fits jurisdictions we have not properly studied.
4. **Jurisdictional honesty.** Where US and Singapore rules contradict each other (and they sometimes do), the system must say so to a human operator, not silently pick the more permissive one.

**Stage and size** *(hypothetical planning figures for the assignment — not externally validated market research)***:**

- **Stage:** Series B, raised in late 2025 (US$22M lead from a regional VC, with strategic participation from a Singapore family office).
- **Headcount:** ~80 FTE. Engineering ~35; data science ~12; subject-matter experts (ex-MLROs from MAS-regulated banks, ex-FinCEN examiners) ~10; sales and CS ~15; G&A ~8.
- **Customers:** 12 banks under contract — eight ASEAN Tier-2/3 banks, two Hong Kong subsidiaries of regional banks, two US-branch operations of foreign banks. Annual recurring revenue ≈ US$8M.

**Aspirations** *(planning targets, not forecasts)***:**

- **Revenue:** US$25M ARR by end of FY2027; US$60M by end of FY2029. Path to break-even FY2028.
- **Cost discipline:** Gross margin target 70%+ by FY2027 — achievable only if onboarding effort per client falls below 90 days. The biggest cost is *people-time on jurisdiction configuration*, which is exactly what the tool's jurisdiction-configuration layer is supposed to industrialise.
- **Geographical coverage by 2029:** APAC-first (Singapore, Hong Kong, Malaysia, Indonesia, Thailand, Vietnam, Philippines, Australia), plus US-correspondent operations and a UK pilot. Explicitly *not* in scope: EU 6AMLD compliance, mainland-China onshore. We are weaker in those regimes and would mislead clients to claim otherwise.

**What we are good at:**

- Cross-currency transaction-flow stitching (USD/SGD/HKD/MYR).
- Explainable ML alerting — every alert ships with feature attributions.
- Fast core-banking integration via a thin event-bus connector.

**What we are not good at:**

- We do **not** do KYC onboarding (no biometric liveness, no document verification at origination). We integrate with Onfido/Sumsub/Jumio for that.
- We are **not** a sanctions screening engine. We consume OFAC/MAS-TFS/UN feeds but do not maintain them.
- Our **EU AMLD coverage is weak**; we plan to address it in 2027, not before.

This honesty is itself a values statement: the assignment asks us to engage with genuine tensions, and the tension here is that a startup pitch deck would not normally list its weaknesses on slide 2. We do, because Task 4 questions will catch us if we do not.

---

## 2. Whose perspective does the tool serve?

**Primary perspective: the paying client — specifically, the bank's MLRO and CCO.**

The bank's Money Laundering Reporting Officer signs the cheque. Without their endorsement, the product does not get bought. This is the structural reality of RegTech that the lecture deck (Part 1, Slide 13) names directly: "the paying customer is the regulated firm, not the regulator nor the consumer."

**Secondary perspective: the regulator — but only via the MLRO.**

We design the system so that an MAS examiner or an OCC examiner could pick up a typology, an alert, a SAR/STR, and trace it backwards to the input data and the model's reasoning. We do this because:

- (a) the MLRO benefits when the system survives examination, so this aligns with the primary perspective; and
- (b) it is the only operational way to make the "regulator's perspective" influence design — we cannot sell to MAS, but we can make sure the MLRO is not embarrassed by us in front of MAS.

**Tertiary perspective: the consumer — under-served and we should be honest about that.**

The consumer who is most affected by our tool is *the small business or remittance customer who gets debanked because of a false-positive alert.* The lecture deck (Part 1, Slide 9) is blunt: "AML regulation created more informality not less" because banks responded to compliance pressure by cutting off entire correspondent-banking corridors and remittance flows from developing countries. Our tool, used aggressively, reproduces this harm.

**The genuine tensions, with evidence:**

| Tension | Who pulls which way | Evidence |
|---|---|---|
| **Alert volume vs alert recall** | MLRO wants fewer alerts (operations cost). Regulator wants more alerts (no missed SARs). | TD Bank 2024: monitoring system flagged genuine activity; bank suppressed alerts to manage volume. SCB 2014: monitoring tuned to under-flag, by design. Both ended in nine-figure penalties. |
| **De-risking vs financial inclusion** | MLRO wants high-risk customers off the books. Consumer (legitimate SME exporter) wants to keep the account. | FATF de-risking trap, named explicitly in the lecture deck (Part 1, Slide 9): "Major banks cut off legitimate remittance flows from developing nations rather than bear compliance costs." |
| **Speed vs caution** | Bank wants real-time alerting (fewer transactions blocked in flight). Regulator wants thorough investigation (which is slower). | The 2023 Singapore S$3B case: legitimate-looking accounts moved funds for years across multiple banks; near-real-time review would have caught it earlier, but no bank was incentivised to slow its onboarding. |
| **Jurisdictional contradiction** | US OFAC says block. Singapore MAS may say the same wire is fine domestically. | OFAC's extraterritorial reach via USD clearing means a Singapore-domestic SGD transfer that touches a USD correspondent leg is suddenly a US-jurisdiction transaction — even though no Singapore rule was violated. |

**What drove the choice (commercial honesty):**

- We chose **AML transaction monitoring (with related CDD/EDD and case-management implications)** as our domain because (a) the team's competency is there — half the founding team are ex-MLROs at MAS-supervised banks and one is an ex-FinCEN examiner, (b) for assignment-planning purposes we assume an addressable market of ~150 ASEAN Tier-2/3 banks meeting our profile, with willingness to pay roughly US$200K–US$2M annually depending on transaction volume, yielding a notional TAM of ~US$300M annually in APAC (these figures are hypothetical, not externally validated), (c) Tier-1 banks build in-house and Tier-4 cannot afford us, leaving the middle. We are explicitly **not** a full KYC-onboarding tool — biometric liveness, document verification, and KYB onboarding workflows are out of scope and integrated via specialist providers (see §1).
- We chose US + Singapore as the first jurisdictional pair because (a) every USD-clearing wire from Singapore touches US jurisdiction whether the bank likes it or not, so the pair is operationally unavoidable for our customers, and (b) the Standard Chartered case file — the obvious public reference for the failure mode — sits exactly in this corridor.
- We did *not* choose to build for the consumer's perspective, and we should be honest that this is a commercial choice, not an ethical one. A consumer-protection tool would need to be paid for by a regulator or a foundation, not by a bank, and we have not raised that kind of capital.

---

## 3. Genuine risk vs documenting compliance

> *"Does your tool make the risk number more truthful — or more compliant-looking?"* — Lecture deck, Part 1, Slide 14, Tension 3

This question deserves two specific design choices — one we **included** because it improves detection though it is not required, one we **excluded** because we judged it would serve documentation over substance.

### Feature included for substance, not required: cross-corridor alert stitching

**What it is:** the system links alerts that look benign in any single payment corridor but, together, form a recognisable layering or structuring pattern. Concretely, a USD wire from a Singapore SME's USD account through New York correspondent clearing, followed within 72 hours by an SGD transfer of similar magnitude to an apparently unrelated counterparty that nonetheless shares a beneficial owner one or two corporate hops away — none of these legs alone trips a single-corridor rule. Stitched together, they fit a layering pattern.

**Why this is not required by either jurisdiction:**

- US BSA SARs are filed per institution, per identified suspicious transaction or pattern. There is no rule requiring cross-corridor or cross-currency stitching.
- MAS Notice 626 likewise frames suspicion at the institutional level; correspondent-banking review is required, but cross-corridor chaining is not specified.

**Why we built it anyway:** the lecture's Standard Chartered and 2023 Singapore S$3B cases share a structural feature — the laundering succeeded because each individual leg of each transaction looked normal in its corridor. Detection failed at the seam between corridors, not within any one corridor. A rule-of-thumb truth: regulators write rules for the failure mode they last saw; layering moves to the failure mode they have not yet seen. Stitching is our attempt to detect the next mode rather than the last one.

### Feature excluded for substance: LLM-generated SAR/STR narratives

**What competitors offer:** several AML vendors now sell "GenAI drafts your SAR/STR narrative" features. The pitch is that the LLM reads the transaction history, summarises the suspicion, and produces a narrative the MLRO can edit and file.

**Why we refuse:**

1. **OCC Bulletin 2026-13 explicitly excludes GenAI and agentic AI from its model-risk-management framework.** OCC 2026-13 is supervisory guidance, not a direct legal prohibition on LLM-assisted SAR drafting — but its silence on GenAI creates governance ambiguity. A bank using an LLM-drafted SAR has no prudential MRM regime that clearly applies, and therefore bears a heavier burden to *self-justify* the use under general safety-and-soundness expectations. We would be transferring that justification burden onto our customers; we choose not to.
2. **A SAR/STR narrative is the regulator's primary evidentiary entry point.** The narrative is what an FBI agent or STRO investigator reads first. Outsourcing that text to an LLM produces fluent, plausible-but-shallow stories — exactly the failure mode the lecture deck names: "compliant-looking" rather than "true."
3. **The TD Bank 2024 case is the cautionary precedent.** TD's failure was not in narrative drafting — it was internal suppression of known issues. But the structural lesson generalises: any tooling that reduces the friction of producing a narrative without increasing the friction of *truthfully* producing one moves in the wrong direction.
4. **The reasonable-care argument from OCC 2026-13.** The lecture deck (Part 3, Slide 19) makes explicit that even non-prescriptive guidance creates a standard of reasonable care that becomes Exhibit A in any enforcement action. Using an LLM that the prudential regulator has explicitly disclaimed governance over therefore raises — without by itself settling — questions about whether reasonable care was exercised. We treat that ambiguity as a reason to refuse the feature, not as a settled legal opinion.

**What we do offer instead:** a structured-template SAR/STR scaffold that pre-fills factual fields (account numbers, transaction IDs, counterparty data, alert reason codes from the model) but explicitly leaves the narrative free-text fields blank for the human investigator to author. The scaffold is examiner-friendly; it is not author-replacing.

---

## 4. Who bears the cost if the tool gets it wrong?

There are four canonical failure modes for an AML monitoring tool. Each lands on a different stakeholder, and each deserves a specific name rather than a generic "stakeholders may be affected" phrasing.

### (a) False positive — the tool flags a legitimate customer

- **Specific harm:** the customer's account is frozen pending review, or closed outright; downstream payments to suppliers and employees fail; the customer's relationship with their wider banking network is damaged because debanking from one bank often triggers exit from others.
- **Specific stakeholder most affected:** small and medium-sized exporters in correspondent corridors. An Indonesian textile manufacturer paid in USD via Singapore is statistically more likely to be flagged than a Singapore-domiciled multinational moving the same amount, because country-of-counterparty risk weights are baked into typologies. The lecture deck names this directly: AML rules drove banks to *exit entire corridors* rather than bear compliance costs, pushing legitimate flows into informality.
- **What it costs us:** customer churn, eventually. A bank whose own customers complain about debanking will pressure us to retune.

### (b) False negative — the tool misses genuine financial crime

- **Specific harm:** sanctioned-state actors, drug-trafficking proceeds, or human-trafficking funds pass through the bank and reach their downstream destinations.
- **Specific stakeholder most affected:** the *victims of the underlying crime* — civilians in sanctioned states whose elites are exfiltrating wealth, trafficking victims whose payments are being laundered, communities harmed by narcotics flows. Less visible than a debanked SME, far more harmful in absolute terms.
- **Why this stakeholder is invisible in normal product reviews:** they are not represented in our customer-satisfaction surveys. The lecture deck's recurring point — *failures land on those with no seat at the table* — describes them precisely.

### (c) Performance drift — the tool was right yesterday and is wrong today

- **Specific harm:** a typology that detected 2024-vintage structuring no longer detects a 2026-vintage variant. The tool reports good metrics on historical backtests; live performance has decayed silently.
- **Specific stakeholder most affected:** the bank's MLRO and the bank itself. Drift caught by an examiner becomes a consent-order finding; under SM&CR-equivalent personal-liability regimes (FCA in the UK, MAS guidelines on Senior Manager accountability, NY DFS Part 504 individual certification in the US), the cost is personal and professional.
- **Mitigation we owe them:** trigger-based revalidation per OCC 2026-13's framework, even though OCC 2026-13 does not strictly bind a non-bank vendor. We treat it as the standard of reasonable care.

### (d) Jurisdictional misconfiguration — the tool applies the wrong rule

This is the most catastrophic failure mode for a *jurisdiction-aware* tool, because it is the one our value proposition is supposed to prevent.

- **Failure shape A — overzealous US application to a Singapore-domestic transaction:** the system applies OFAC SDN screening to a Singapore-domestic SGD transaction with no US nexus. The customer is wrongly blocked. Specific harm: debanking acceleration in the SGD-domestic market. Specific stakeholder: Singapore SME or individual customer.
- **Failure shape B — under-application to a USD-clearing wire routed through Singapore:** the system treats a USD wire as if it were a Singapore-domestic flow under MAS suspicion-based STR alone, missing that the same wire's USD-clearing leg through New York puts it inside US OFAC and BSA scope. Concretely: the wire is suspicious enough to warrant SAR-floor analysis ($5,000 USD under 31 CFR §1020.320(a)(2)) and may also touch a sanctioned counterparty under OFAC SDN, but the engine fires nothing on the US side because it never recognised the US nexus. Specific harm: missed SAR filing and potentially missed sanctions block; the bank's NY correspondent relationship is at risk. Specific stakeholder: the bank's New York branch — and given recent NY DFS history with Standard Chartered, the consequences of repeat compliance failure are severe (the 2014 NY DFS action *was* about repeat failure under a 2012 consent order). *Note: this failure shape is specifically not about CTR — CTR is a US **cash** rule under 31 CFR §1010.311 and does not apply to wires; conflating the two is itself a failure mode the tool's `_in_scope_jurisdictions` logic and channel gating are designed to prevent.*
- **Failure shape C — silent contradiction between regimes:** OFAC sanctions a counterparty that MAS does not. The system must surface the contradiction to a human, not silently pick. If we silently apply the more restrictive rule (over-block), we debank a lawful Singapore customer. If we silently apply the more permissive rule (allow), we expose the bank's NY branch.

**Who bears the cost in this fourth failure mode:** the bank's New York branch most acutely, because the post-2025 executive-order-driven rollback of "reputational risk" as a supervisory concept (White House EO 14331, "Guaranteeing Fair Banking for All Americans," August 2025) has *removed* one historical supervisory rationale for over-blocking, leaving banks structurally less able to justify aggressive de-risking, while the underlying BSA/OFAC liability for under-reporting is unchanged. The branch is squeezed.

---

## Closing reflection — engaging with the four enduring tensions

The lecture deck's four enduring tensions (Part 1, Slide 14) frame the values audit. Briefly, where Strait Compliance lands on each:

- **Protection vs Rent.** Our tool helps Tier-2/3 banks afford genuine monitoring without an in-house Tier-1 build. This *lowers* the compliance cost floor and reduces the rent the largest banks extract from the AML compliance market — provided we resist becoming the next Tier-1 vendor ourselves.
- **Global Standards vs Local Fit.** We explicitly build for proportionate application — our APAC focus is itself a recognition that a tool calibrated for Goldman Sachs is the wrong tool for an Indonesian Tier-3 bank. We will refuse business in jurisdictions where we cannot calibrate properly.
- **Documentation vs True Risk.** Section 3 of this audit answers it directly: cross-corridor stitching included for substance; LLM SAR drafting excluded for substance. We will be tested on this when a customer asks for the LLM drafter and we say no.
- **Serving the Client vs the System.** When they diverge, we owe the system primacy *via* the client — meaning we will not silently misconfigure to make the client's examination easier. The Strait Compliance system contradiction-flag (Section 4(d), Failure Shape C) is the operational embodiment of this commitment.

> The Clearinghouse Test (Part 1, Slide 14): *Would the members of the New York Clearing House in 1853 recognise our product as creating genuine trust through genuine transparency, or as producing the ledger entry without the underlying reality?*

The honest answer is: the test is not passed once. It has to be passed in every quarterly model-revalidation cycle, every customer onboarding decision, every typology update, and every refusal to sell a feature that would make us money but would erode the substance. The values audit is the first commitment to that ongoing test.
