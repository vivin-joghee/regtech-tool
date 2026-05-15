# Strait Compliance — Senior Management Deck

*Pitched to the bank's MLRO, CCO, and CRO. ~10 minutes.*

> Slides are written one-per-section, separated by `---`. Each is sized for a single 16:9 slide. Paste into Google Slides / PowerPoint, or render with Marp / Slidev.

---

## Slide 1 — Title

# Strait Compliance
### Jurisdiction-aware AML monitoring
### built for banks that clear in two regulators at once

*Submitted to NTU MH6822 — Vivin Joghee, G2505378K*

---

## Slide 2 — The problem we exist for

```
Standard Chartered AML enforcement history

2012  ████████████████████████████████  USD 327M  Iran sanctions stripping
2014  ████████████████████████████      USD 300M  Failure to remediate 2012
2019  ████████████████████████████████████████████████████  USD 1.1B  Sanctions violations
2024  █████████  MAS follow-up after S$3B SG money-laundering case
```

**Total disclosed: ~USD 1.8B over 12 years.**

The 2014 penalty was for **failure to remediate** the 2012 issue. Same monitoring system, second offence.

---

## Slide 3 — Why this product is right for our company

|  |  |
|---|---|
| 🇺🇸 NY Branch | Federally licensed, supervised by Fed + NYDFS. Clears USD through CHIPS / Fedwire. |
| 🇸🇬 SG Subsidiary | Locally incorporated under Singapore Banking Act §7, supervised by MAS. |
| 💵 Every USD wire from SG | Touches US OFAC scope via NY correspondent clearing. *No exceptions.* |

> **Translation:** every cross-border SGD→USD flow is subject to two regulators with different rules. A monitoring system built for one regulator silently violates the other every day.

This is the exact failure mode of 2012 and 2019.

---

## Slide 4 — What a memo or spreadsheet cannot do

| Action | Spreadsheet (manual) | Strait Compliance |
|---|---:|---:|
| Transactions reviewed | ~50 / day per analyst | 1,000+ / second |
| Rules applied per transaction | 1 jurisdiction | 2 jurisdictions in parallel |
| Citation trail per alert | Free-text comment | `rule_id` + `rule_pack_sha` + `model_sha` |
| Reproducible after rule change? | No | Yes — SHA history |
| Alerts in our prototype run | — | **1,250 alerts on 1,000 txns** |
| Contradictions surfaced | Invisible | **78 explicit** |

The spreadsheet collapses under volume; the system pins every alert to a regulation citation that survives examination.

---

## Slide 5 — Regulatory divergence (what we handle, why it matters)

**9 dimensions where US and Singapore disagree** — encoded as separate YAML rule packs, each with its own SHA-256:

| # | Dimension | US | Singapore |
|---|---|---|---|
| 1 | Statute | BSA / PATRIOT / AMLA 2020 | CDSA / TSOFA / MAS Notice 626 |
| 2 | Administrator | FinCEN + 4 prudential + OFAC | MAS (single integrated regulator) |
| 3 | SAR/STR floor | ≥ USD 5,000 + suspicion | No floor; suspicion alone |
| 4 | Cash transaction report | > USD 10,000 (31 CFR §1010.311) | **No general bank threshold** |
| 5 | PEP scope | Foreign only | Broader (foreign + domestic + IO) |
| 6 | Sanctions list | OFAC SDN (extraterritorial via USD) | MAS-TFS (no extraterritorial reach) |
| 7 | Beneficial ownership | Corporate Transparency Act, paused 2025 | ACRA Register of Registrable Controllers |
| 8 | AI governance | OCC 2026-13 (excludes GenAI) | MAS FEAT + Veritas (covers AI fully) |
| 9 | 2026 direction | Mixed | Tightening |

→ Each row is the engineering basis for a different contradiction shape.

---

## Slide 6 — How divergence shows up in real data

```
1,000 synthetic transactions → 78 contradictions across all four shapes

US flag / SG block    ████████████████████████████████████  36   SG.RBR principles-based
US block / SG flag    ██████████████████  18                     OFAC SDN + foreign PEP
US block / SG allow   ████████████  12                            OFAC SDN, weak SG signal
US allow / SG block   ████████████  12                            SG TBML, no US lever
```

**The system never silently picks a side.** Every contradiction lands in a `pending` queue for a human MLRO to resolve. The alert drawer shows the regulatory pattern in plain English:

> *"Singapore's risk-based supervisory approach blocks (SG.RBR.TBML_INCONSISTENT fired) while the US's threshold-based regime did not escalate — MAS's principles-based stance vs the US's rule-based stance."*

---

## Slide 7 — The audit primitives a regulator expects

```
Every alert in our database carries:

  ├── transaction_id        ──→ joins to the underlying flow
  ├── rule_id               ──→ e.g. "US.SANCTIONS.OFAC_SDN" — cite-able to CFR
  ├── rule_pack_sha (256)   ──→ "7c1f8093964bfcb8…" — exact YAML version
  ├── model_sha (256)       ──→ "e8b7613118fde18a…" — exact model weights
  ├── ml_score              ──→ 0.0—1.0
  └── shap_attribution      ──→ top-12 features that drove the score
```

If a regulator asks *"why did this transaction block on 12 March?"* — every answer is reproducible from these five fields. No human memory required.

**Model performance** (on held-out test, with threshold tuned only on validation):

| | |
|---|---:|
| ROC-AUC | 0.97 |
| PR-AUC | 0.93 |
| Decision threshold (F1-optimal) | 0.5960 |
| Sanctions recall | 100% |
| Large-cash recall | 100% |
| Structuring recall | 88% |

---

## Slide 8 — What this tool does NOT do (boundary choices)

| We don't | Why |
|---|---|
| **KYC onboarding** (biometric, doc verification) | Specialist vendors (Onfido / Sumsub) do this better. We'd be a worse 5th in a crowded market. |
| **LLM-drafted SAR/STR narratives** | OCC Bulletin 2026-13 disclaims governance over GenAI. Putting that liability on the bank's MLRO is unacceptable. |
| **EU 6AMLD compliance** | We have not properly studied the regime. Pretending otherwise is the failure mode this tool is designed to prevent. |
| **Real-time blocking decisions** | Bank's payment switch makes the block call. We supply the signal + the SHA-pinned reason, not the action. |

> Each "no" is a defended choice, not a roadmap item. The discipline is the product.

---

## Slide 9 — Closing

The tool is **live on production Cloudflare**, sourced under our standard audit conditions, and behaves exactly as the YAML rule packs and primary sources say it should.

**Try it:** https://strait-compliance.pages.dev

**Source + Task 3 architecture:** https://github.com/vivin-joghee/regtech-tool

> Strait Compliance does not promise to fight financial crime. It promises that when our bank's two regulators disagree, the system says so to a human, and the audit trail is reproducible six months later.
>
> That is the substance that survives examination.
