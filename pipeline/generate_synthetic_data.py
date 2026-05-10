"""
Strait Compliance — Synthetic Transaction Generator (v2)
========================================================

Implements the scenario taxonomy in `SCENARIO_DESIGN.md`:
- 10 scenario categories
- 80-customer pool
- CASH_USD / CASH_SGD channels (so the verified-correct CTR rule can fire only on cash)
- Ground-truth expected_us_verdict / expected_sg_verdict on every row
- Reason summaries for the validator and for examiner audit

Discipline rules:
- No regulatory rule, threshold, or scope is encoded here without primary-source verification
  (see worker/RULES_VERIFICATION.md)
- No fictional sanctioned entities (per design decision Q2)
- SG PEP scope encoded as foreign+domestic in YAML but NOT asserted in expected verdicts
  for SG-domestic PEPs (per UNVERIFIED status in MAS Notice 626)

Run:
    python generate_synthetic_data.py --seed 42 --n 1000

Outputs in ./data/:
    customers.parquet
    transactions.parquet
    generation_summary.json
"""

from __future__ import annotations

import argparse
import json
import random
import uuid


# Seeded UUID generator — a hidden source of non-determinism the code
# review caught. uuid.uuid4() reads from os.urandom(), which is NOT
# affected by `np.random.default_rng(args.seed)`, so the same --seed used
# to produce different transaction IDs each run. main() seeds this from
# args.seed so generation is now actually reproducible.
_uuid_rng = random.Random()


def _det_uuid() -> str:
    """Generate a deterministic version-4 UUID from the seeded rng."""
    return str(uuid.UUID(int=_uuid_rng.getrandbits(128), version=4))
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

USD_PER_SGD = 0.74
SGD_PER_USD = 1 / USD_PER_SGD

# Verified thresholds (see worker/RULES_VERIFICATION.md)
US_CTR_THRESHOLD_USD = 10_000     # 31 CFR §1010.311 — "more than $10,000" cash
US_SAR_FLOOR_USD = 5_000          # 31 CFR §1020.320(a)(2) — "at least $5,000" + suspicion

# Reference ML threshold used for *expected_verdict* labelling only.
# The actual deployed threshold is auto-tuned each training run and lives in
# worker/data/model-metadata.json (consumed by the worker engine via
# getDecisionThreshold). The generator must NOT read that file — doing so
# would make generated output depend on local artifact state, breaking the
# README's reproducibility guarantee. Override at the CLI with
# `--ml-threshold` if a specific calibration is being modelled.
DEFAULT_ML_THRESHOLD = 0.187

# Module-level reference; reset by main() after parsing --ml-threshold.
ML_THRESHOLD = DEFAULT_ML_THRESHOLD

# Scenario category labels — match SCENARIO_DESIGN.md §1
SCENARIO_NORMAL = "1_normal"
SCENARIO_STRUCTURING = "2_structuring"
SCENARIO_LARGE_CASH = "3_large_cash"
SCENARIO_RAPID_MOVEMENT = "4_rapid_movement"
SCENARIO_SANCTIONS = "5_sanctions"
SCENARIO_PEP = "6_pep"
SCENARIO_CROSS_BORDER = "7_cross_border"
SCENARIO_BEHAVIORAL_DEVIATION = "8_behavioral_deviation"
SCENARIO_JUST_BELOW_LIMITS = "9_just_below_limits"
SCENARIO_BUSINESS_TRADE = "10_business_trade"
SCENARIO_SG_BLOCK_RISK_BASED = "11_sg_block_risk_based"

# Channels
CHANNEL_FAST = "FAST"
CHANNEL_GIRO = "GIRO"
CHANNEL_SWIFT = "SWIFT"
CHANNEL_CHIPS = "CHIPS"
CHANNEL_FEDWIRE = "FEDWIRE"
CHANNEL_ACH = "ACH"
CHANNEL_CASH_USD = "CASH_USD"     # Physical USD cash at a bank teller
CHANNEL_CASH_SGD = "CASH_SGD"     # Physical SGD cash at a bank teller


# ---------------------------------------------------------------------------
# Customer pool (80 customers per SCENARIO_DESIGN.md §5)
# ---------------------------------------------------------------------------

@dataclass
class Customer:
    id: str
    legal_name: str
    customer_type: str
    domicile_country: str
    pep_status: str
    risk_rating: int
    onboarded_at: datetime
    beneficial_owner: str | None = None
    ofac_sdn: bool = False
    mas_tfs: bool = False
    alias: str = ""


def build_customers(rng: np.random.Generator) -> list[Customer]:
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)

    def onboarded(days_offset: int) -> datetime:
        return base + timedelta(days=int(days_offset))

    rows: list[dict[str, Any]] = []

    # ---- 20 SG SME corporates (clean, varied risk 1-3) ---------------------
    sg_corp_names = [
        ("sg_sme_textiles_a", "Tan Brothers Textiles Pte Ltd", 2),
        ("sg_sme_textiles_b", "Lim & Sons Apparel Pte Ltd", 2),
        ("sg_sme_logistics_a", "Pacific Logistics Singapore Pte Ltd", 2),
        ("sg_sme_logistics_b", "Marina Freight Services Pte Ltd", 2),
        ("sg_sme_electronics_a", "Lim Electronics Trading Pte Ltd", 1),
        ("sg_sme_electronics_b", "Bishan Components Pte Ltd", 1),
        ("sg_sme_construction_a", "Marina Bay Construction Pte Ltd", 3),
        ("sg_sme_construction_b", "Bukit Engineering Works Pte Ltd", 3),
        ("sg_sme_consultancy_a", "Orchard Consultancy Pte Ltd", 2),
        ("sg_sme_consultancy_b", "Raffles Advisory Pte Ltd", 2),
        ("sg_sme_food", "Hawker Heritage F&B Pte Ltd", 1),
        ("sg_sme_retail", "Sentosa Retail Pte Ltd", 1),
        ("sg_sme_pharma", "Tiong Bahru Pharmaceutical Pte Ltd", 2),
        ("sg_sme_education", "Bishan Tutor Centre Pte Ltd", 1),
        ("sg_sme_property", "Holland Property Holdings Pte Ltd", 3),
        ("sg_sme_marine", "Jurong Marine Services Pte Ltd", 2),
        ("sg_sme_it_services", "Tampines IT Solutions Pte Ltd", 1),
        ("sg_sme_legal", "Shenton Legal Associates LLP", 1),
        ("sg_sme_design", "Tiong Bahru Design Studio Pte Ltd", 1),
        ("sg_sme_security", "Changi Security Pte Ltd", 2),
    ]
    for alias, name, risk in sg_corp_names:
        rows.append(dict(alias=alias, legal_name=name, customer_type="corporate",
                         domicile_country="SG", pep_status="none", risk_rating=risk))

    # ---- 15 US SME corporates (clean) --------------------------------------
    us_corp_names = [
        ("us_sme_furniture_a", "Hudson Furniture LLC", 2),
        ("us_sme_furniture_b", "Brooklyn Designs Inc", 2),
        ("us_sme_software_a", "Brooklyn Software Inc", 1),
        ("us_sme_software_b", "Cambridge Code Co", 1),
        ("us_sme_imports_a", "Chen Imports LLC", 3),
        ("us_sme_imports_b", "Atlantic Trade Group LLC", 3),
        ("us_sme_consulting_a", "Harbor Consulting Group", 2),
        ("us_sme_consulting_b", "Manhattan Strategy LLC", 2),
        ("us_sme_food", "Brooklyn Bakery Inc", 1),
        ("us_sme_retail", "Hudson Retail Co", 1),
        ("us_sme_legal", "Park Avenue Law LLP", 1),
        ("us_sme_property", "Sunbelt Property Investments LLC", 3),
        ("us_sme_marine", "Boston Harbor Shipping LLC", 2),
        ("us_sme_design", "SoHo Design Studio LLC", 1),
        ("us_sme_education", "Cambridge Tutor Group LLC", 1),
    ]
    for alias, name, risk in us_corp_names:
        rows.append(dict(alias=alias, legal_name=name, customer_type="corporate",
                         domicile_country="US", pep_status="none", risk_rating=risk))

    # ---- 12 SG individuals (clean, retail/payroll) -------------------------
    sg_ind = [
        ("sg_ind_a", "Ms. Sarah Lim"),
        ("sg_ind_b", "Mr. Raj Kumar"),
        ("sg_ind_c", "Mr. Wong Kah Meng"),
        ("sg_ind_d", "Ms. Priya Nair"),
        ("sg_ind_e", "Mr. Tan Boon Hock"),
        ("sg_ind_f", "Ms. Goh Mei Ling"),
        ("sg_ind_g", "Mr. David Chen"),
        ("sg_ind_h", "Ms. Lisa Ng"),
        ("sg_ind_i", "Mr. Krishna Subramanian"),
        ("sg_ind_j", "Ms. Yeo Hwee Ling"),
        ("sg_ind_k", "Mr. Ahmed bin Rashid"),
        ("sg_ind_l", "Ms. Lim Ai Ling"),
    ]
    for alias, name in sg_ind:
        rows.append(dict(alias=alias, legal_name=name, customer_type="individual",
                         domicile_country="SG", pep_status="none", risk_rating=1))

    # ---- 8 US individuals (clean) ------------------------------------------
    us_ind = [
        ("us_ind_a", "Ms. Jennifer O'Brien"),
        ("us_ind_b", "Mr. David Park"),
        ("us_ind_c", "Mr. Robert Martinez"),
        ("us_ind_d", "Ms. Emily Chen"),
        ("us_ind_e", "Mr. Daniel Walsh"),
        ("us_ind_f", "Ms. Maria Rodriguez"),
        ("us_ind_g", "Mr. Christopher Lee"),
        ("us_ind_h", "Ms. Ashley Johnson"),
    ]
    for alias, name in us_ind:
        rows.append(dict(alias=alias, legal_name=name, customer_type="individual",
                         domicile_country="US", pep_status="none", risk_rating=1))

    # ---- 5 Correspondent FIs ------------------------------------------------
    fis = [
        ("sg_fi_corr", "Asia Correspondent Bank Ltd", "SG", 3),
        ("us_fi_corr", "First Atlantic Correspondent Bank", "US", 2),
        ("id_fi_corr", "Bank Bumi Kepulauan", "ID", 4),
        ("my_fi_corr", "Malayan Trade Bank Berhad", "MY", 3),
        ("ph_fi_corr", "Manila Capital Bank Inc", "PH", 4),
    ]
    for alias, name, dom, risk in fis:
        rows.append(dict(alias=alias, legal_name=name, customer_type="financial_institution",
                         domicile_country=dom, pep_status="none", risk_rating=risk))

    # ---- 3 Foreign PEPs -----------------------------------------------------
    foreign_peps = [
        ("id_pep_for", "Bapak Sutrisno Wijaya", "ID", 5),
        ("ph_pep_for", "Sen. Maria Romualdez", "PH", 5),
        ("my_pep_for", "Datuk Razak bin Othman", "MY", 5),
    ]
    for alias, name, dom, risk in foreign_peps:
        rows.append(dict(alias=alias, legal_name=name, customer_type="individual",
                         domicile_country=dom, pep_status="foreign", risk_rating=risk))

    # ---- 2 Domestic SG PEPs -------------------------------------------------
    # Encoded but NOT asserted in expected_sg_verdict for SG-domestic-PEP
    # rule firing — see SCENARIO_DESIGN.md and worker/RULES_VERIFICATION.md
    rows.append(dict(alias="sg_pep_dom_a", legal_name="Hon. Tan Wei Ling",
                     customer_type="individual", domicile_country="SG",
                     pep_status="domestic", risk_rating=4))
    rows.append(dict(alias="sg_pep_dom_b", legal_name="Mr. Lim Chee Hoong",
                     customer_type="individual", domicile_country="SG",
                     pep_status="domestic", risk_rating=3))

    # ---- 4 PEP-related shells ----------------------------------------------
    rows.append(dict(alias="sh_pep_dom_a", legal_name="Marina Heights Holdings Pte Ltd",
                     customer_type="corporate", domicile_country="SG", pep_status="none",
                     risk_rating=4, beneficial_owner="Hon. Tan Wei Ling"))
    rows.append(dict(alias="sh_pep_dom_b", legal_name="Sentosa Investments Pte Ltd",
                     customer_type="corporate", domicile_country="SG", pep_status="none",
                     risk_rating=4, beneficial_owner="Mr. Lim Chee Hoong"))
    rows.append(dict(alias="sh_pep_for_a", legal_name="Jakarta Holdings Group",
                     customer_type="corporate", domicile_country="ID", pep_status="none",
                     risk_rating=4, beneficial_owner="Bapak Sutrisno Wijaya"))
    rows.append(dict(alias="sh_pep_for_b", legal_name="Manila Resource Holdings Inc",
                     customer_type="corporate", domicile_country="PH", pep_status="none",
                     risk_rating=4, beneficial_owner="Sen. Maria Romualdez"))

    # ---- 3 OFAC + MAS sanctioned (both lists) -------------------------------
    rows.append(dict(alias="sn_both_a", legal_name="Tehran Petroleum Trading Co",
                     customer_type="corporate", domicile_country="IR", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=True))
    rows.append(dict(alias="sn_both_b", legal_name="Pyongyang Industrial Trading",
                     customer_type="corporate", domicile_country="KP", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=True))
    rows.append(dict(alias="sn_both_c", legal_name="Moscow Strategic Holdings JSC",
                     customer_type="corporate", domicile_country="RU", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=True))

    # ---- 4 OFAC-only sanctioned (drives Type B contradictions) -------------
    rows.append(dict(alias="sn_ofac_a", legal_name="Caracas Resource Holdings",
                     customer_type="corporate", domicile_country="VE", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=False))
    rows.append(dict(alias="sn_ofac_b", legal_name="Habana Trade Group SA",
                     customer_type="corporate", domicile_country="CU", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=False))
    rows.append(dict(alias="sn_ofac_c", legal_name="Damascus Petroleum Services",
                     customer_type="corporate", domicile_country="SY", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=False))
    rows.append(dict(alias="sn_ofac_d", legal_name="Tegucigalpa Trading SA",
                     customer_type="corporate", domicile_country="VE", pep_status="none",
                     risk_rating=5, ofac_sdn=True, mas_tfs=False))

    # ---- 2 OFAC-only sanctioned with otherwise low risk profile ------------
    # Models OFAC-listed counterparties that don't carry other risk indicators
    # (no other flags). Used to drive `US block / SG allow` Type B contradictions
    # by giving the ML model a weak signal — see SCENARIO_DESIGN.md §3b.
    rows.append(dict(alias="sn_ofac_lo_a", legal_name="Atlas Maritime Services Ltda",
                     customer_type="corporate", domicile_country="VE", pep_status="none",
                     risk_rating=2, ofac_sdn=True, mas_tfs=False))
    rows.append(dict(alias="sn_ofac_lo_b", legal_name="Antillean Trade Holdings",
                     customer_type="corporate", domicile_country="CU", pep_status="none",
                     risk_rating=2, ofac_sdn=True, mas_tfs=False))

    # ---- 2 Sanctioned foreign PEPs (OFAC + PEP combo) ----------------------
    # Drives `US block / SG flag` Type B contradictions deterministically:
    # OFAC.SDN fires on US → block; SG.PEP.ALL fires on SG → flag (no MAS-TFS).
    rows.append(dict(alias="sn_pep_ofac_a", legal_name="Hon. Esteban Maduro Caldera",
                     customer_type="individual", domicile_country="VE",
                     pep_status="foreign", risk_rating=5, ofac_sdn=True, mas_tfs=False))
    rows.append(dict(alias="sn_pep_ofac_b", legal_name="Sr. Roberto Castillo Mendez",
                     customer_type="individual", domicile_country="CU",
                     pep_status="foreign", risk_rating=5, ofac_sdn=True, mas_tfs=False))

    # NOTE: NO MAS-TFS-only fictional entities (per design decision Q2).
    # Type C contradictions are handled via Type C scarcity acknowledgement —
    # see SCENARIO_DESIGN.md §3a.

    # ---- 4 Mules (used in structuring patterns) ----------------------------
    rows.append(dict(alias="sg_mule_a", legal_name="Mr. Goh Beng Seng",
                     customer_type="individual", domicile_country="SG",
                     pep_status="none", risk_rating=2))
    rows.append(dict(alias="sg_mule_b", legal_name="Ms. Wong Yi Lin",
                     customer_type="individual", domicile_country="SG",
                     pep_status="none", risk_rating=2))
    rows.append(dict(alias="us_mule_a", legal_name="Mr. Michael Sullivan",
                     customer_type="individual", domicile_country="US",
                     pep_status="none", risk_rating=2))
    rows.append(dict(alias="us_mule_b", legal_name="Ms. Christine Hayes",
                     customer_type="individual", domicile_country="US",
                     pep_status="none", risk_rating=2))

    customers: list[Customer] = []
    for r in rows:
        customers.append(Customer(
            id=_det_uuid(),
            legal_name=r["legal_name"],
            customer_type=r["customer_type"],
            domicile_country=r["domicile_country"],
            pep_status=r["pep_status"],
            risk_rating=r["risk_rating"],
            onboarded_at=onboarded(rng.integers(0, 365)),
            beneficial_owner=r.get("beneficial_owner"),
            ofac_sdn=r.get("ofac_sdn", False),
            mas_tfs=r.get("mas_tfs", False),
            alias=r["alias"],
        ))
    return customers


def by_alias(customers: list[Customer]) -> dict[str, Customer]:
    return {c.alias: c for c in customers}


# ---------------------------------------------------------------------------
# Routing & scope
# ---------------------------------------------------------------------------

def _in_scope_jurisdictions(orig: Customer, bene: Customer, currency: str, channel: str) -> list[str]:
    """Determine which AML regimes are in scope.

    Rules:
    - SG in scope if either party is SG-domiciled.
    - US in scope if either party is US-domiciled OR if a USD wire clears
      via NY (CHIPS / FEDWIRE / SWIFT-USD with cross-border counterparties).
    - CASH_USD: physical cash at a US-branch teller — US in scope, SG only
      if the other party is SG-domiciled.
    - CASH_SGD: physical cash at a SG-branch teller — SG in scope, US only
      if the other party is US-domiciled (rare but possible).
    """
    scope: set[str] = set()

    if orig.domicile_country == "SG" or bene.domicile_country == "SG":
        scope.add("SG")
    if orig.domicile_country == "US" or bene.domicile_country == "US":
        scope.add("US")

    # USD-clearing extraterritorial reach (verified via OFAC FAQ topic/1631)
    if currency == "USD" and channel in (CHANNEL_CHIPS, CHANNEL_FEDWIRE):
        scope.add("US")
    if currency == "USD" and channel == CHANNEL_SWIFT and (
        orig.domicile_country != bene.domicile_country
    ):
        scope.add("US")

    # Cash channels are tied to physical bank tellers in their respective
    # jurisdictions. CASH_USD presumes a US-branch teller; CASH_SGD presumes
    # a SG-branch teller.
    if channel == CHANNEL_CASH_USD:
        scope.add("US")
    if channel == CHANNEL_CASH_SGD:
        scope.add("SG")

    return sorted(scope)


def _corridor(orig: Customer, bene: Customer, currency: str) -> str:
    return f"{orig.domicile_country}-{bene.domicile_country}-{currency}"


def _amount_native_to_normalised(amount: float, currency: str) -> tuple[float | None, float | None]:
    if currency == "USD":
        return round(amount, 2), round(amount * SGD_PER_USD, 2)
    if currency == "SGD":
        return round(amount * USD_PER_SGD, 2), round(amount, 2)
    return None, None


# ---------------------------------------------------------------------------
# Verdict prediction — encode the verified rules as a Python function
# so the validator can compare actual vs expected.
# ---------------------------------------------------------------------------

def _is_cash_channel(channel: str) -> bool:
    return channel in (CHANNEL_CASH_USD, CHANNEL_CASH_SGD)


def predict_verdicts(
    *,
    in_scope: list[str],
    channel: str,
    amount_usd: float | None,
    amount_sgd: float | None,
    ofac_match: bool,
    mas_match: bool,
    orig_pep: str,
    bene_pep: str,
    expected_ml_score: float,
    sg_signals: dict[str, bool] | None = None,
) -> tuple[str, str, str, str]:
    """Return (us_verdict, sg_verdict, contradiction_type, reason_summary).

    Verdicts use one of: 'block', 'flag', 'allow', 'not_in_scope'.
    Contradiction types: 'A' (both fire), 'B' (US only), 'C' (SG only),
    'D' (neither — also covers single-jurisdiction-only cases).

    Mirrors the worker rule engine but expressed in Python for ground-truth
    labelling. Update this function in lock-step with the worker engine.
    """

    def _score_one_jurisdiction(jur: str) -> tuple[str, list[str]]:
        if jur not in in_scope:
            return "not_in_scope", []

        suspicion_hits: list[str] = []

        # Sanctions
        if jur == "US" and ofac_match:
            suspicion_hits.append("US.SANCTIONS.OFAC_SDN")
        if jur == "SG" and mas_match:
            suspicion_hits.append("SG.SANCTIONS.MAS_TFS")

        # PEP — verified scope only
        if jur == "US" and "foreign" in (orig_pep, bene_pep):
            suspicion_hits.append("US.PEP.FOREIGN")
        if jur == "SG":
            # SG.PEP.ALL fires on foreign + domestic per current YAML;
            # we only assert ground truth for the verified part (foreign).
            # Domestic-PEP firing is left up to the engine; the validator
            # treats it as informational, not a graded match.
            if "foreign" in (orig_pep, bene_pep):
                suspicion_hits.append("SG.PEP.FOREIGN")

        # ML
        if expected_ml_score >= ML_THRESHOLD:
            suspicion_hits.append(f"{jur}.ML.THRESHOLD")

        # SG-specific risk-based rules — only apply on the SG side
        if jur == "SG" and sg_signals:
            rbr_flag_to_rule = {
                "pep_high_risk_destination": "SG.RBR.PEP_HIGH_RISK_DEST",
                "tbml_inconsistent": "SG.RBR.TBML_INCONSISTENT",
                "complex_layering": "SG.RBR.COMPLEX_LAYERING",
                "behavioral_deviation_strong": "SG.RBR.BEHAVIORAL_DEVIATION_STRONG",
                "pep_intermediary_layering": "SG.RBR.PEP_INTERMEDIARY",
                "missing_documentation": "SG.RBR.MISSING_DOCS",
                "repeated_pattern_below_threshold": "SG.RBR.REPEATED_BELOW_THRESHOLD",
                "new_customer_large_transfer": "SG.RBR.NEW_CUSTOMER_LARGE",
            }
            for flag, rule_id in rbr_flag_to_rule.items():
                if sg_signals.get(flag):
                    suspicion_hits.append(rule_id)

        # CTR — only for cash channels (verified per §1010.311)
        ctr_hits: list[str] = []
        if jur == "US" and channel == CHANNEL_CASH_USD:
            if amount_usd is not None and amount_usd >= US_CTR_THRESHOLD_USD:
                ctr_hits.append("US.CTR.10K")
        # Singapore has no general bank CTR — verified

        # SAR/STR meta-rule
        sus_report_hits: list[str] = []
        if suspicion_hits:
            if jur == "US":
                if amount_usd is not None and amount_usd >= US_SAR_FLOOR_USD:
                    sus_report_hits.append("US.SAR.5K")
            elif jur == "SG":
                # CDSA s.45: no monetary floor
                sus_report_hits.append("SG.STR.SUSPICION")

        all_hits = suspicion_hits + ctr_hits + sus_report_hits
        if not all_hits:
            return "allow", []

        # Aggregate verdict — most restrictive.
        # Sanctions → block. Risk-based rules (SG.RBR.*) → block.
        # Everything else → flag.
        verdict = "flag"
        for h in all_hits:
            if "SANCTIONS" in h or ".RBR." in h:
                verdict = "block"
                break

        return verdict, all_hits

    us_verdict, us_hits = _score_one_jurisdiction("US")
    sg_verdict, sg_hits = _score_one_jurisdiction("SG")

    def _is_alert(v: str) -> bool:
        return v in ("flag", "block")

    us_alert = _is_alert(us_verdict)
    sg_alert = _is_alert(sg_verdict)

    # Contradictions only meaningful when BOTH regimes are in scope.
    # Categories per the user prompt:
    #   A = both trigger with the SAME verdict (genuine agreement)
    #   B = US triggers, SG does not — OR US is more restrictive than SG
    #   C = SG triggers, US does not — OR SG is more restrictive than US
    #   D = neither triggers, OR single-jurisdiction (no contradiction possible)
    #
    # The worker's contradiction detection treats any verdict mismatch as a
    # contradiction (e.g., flag-vs-block), so block-while-other-flags goes
    # to B or C depending on which side is more restrictive.
    verdict_rank = {"allow": 0, "flag": 1, "block": 2, "not_in_scope": 0}
    dual_scope = "US" in in_scope and "SG" in in_scope
    if not dual_scope:
        contradiction_type = "D"
    elif us_verdict == sg_verdict and us_alert and sg_alert:
        contradiction_type = "A"
    elif verdict_rank[us_verdict] > verdict_rank[sg_verdict]:
        contradiction_type = "B"
    elif verdict_rank[sg_verdict] > verdict_rank[us_verdict]:
        contradiction_type = "C"
    else:
        contradiction_type = "D"

    reason_parts: list[str] = []
    if us_hits:
        reason_parts.append(f"US: {us_verdict} ({', '.join(us_hits)})")
    elif "US" in in_scope:
        reason_parts.append("US: allow")
    else:
        reason_parts.append("US: not in scope")

    if sg_hits:
        reason_parts.append(f"SG: {sg_verdict} ({', '.join(sg_hits)})")
    elif "SG" in in_scope:
        reason_parts.append("SG: allow")
    else:
        reason_parts.append("SG: not in scope")

    return us_verdict, sg_verdict, contradiction_type, "; ".join(reason_parts)


# ---------------------------------------------------------------------------
# Transaction builder
# ---------------------------------------------------------------------------

def _make_txn(
    *,
    orig: Customer,
    bene: Customer,
    amount_native: float,
    currency: str,
    channel: str,
    occurred_at: datetime,
    scenario_category: str,
    scenario_sub_shape: str,
    expected_ml_score: float = 0.0,
    sg_signals: dict[str, bool] | None = None,
    note: str = "",
) -> dict[str, Any]:
    amount_usd, amount_sgd = _amount_native_to_normalised(amount_native, currency)
    in_scope = _in_scope_jurisdictions(orig, bene, currency, channel)
    signals = sg_signals or {}

    us_verdict, sg_verdict, contradiction_type, reason = predict_verdicts(
        in_scope=in_scope,
        channel=channel,
        amount_usd=amount_usd,
        amount_sgd=amount_sgd,
        ofac_match=orig.ofac_sdn or bene.ofac_sdn,
        mas_match=orig.mas_tfs or bene.mas_tfs,
        orig_pep=orig.pep_status,
        bene_pep=bene.pep_status,
        expected_ml_score=expected_ml_score,
        sg_signals=signals,
    )

    return {
        "id": _det_uuid(),
        "originator_id": orig.id,
        "beneficiary_id": bene.id,
        "amount_native": round(amount_native, 2),
        "currency": currency,
        "amount_usd": amount_usd,
        "amount_sgd": amount_sgd,
        "corridor": _corridor(orig, bene, currency),
        "channel": channel,
        "in_scope_jurisdictions": in_scope,
        "scenario_category": scenario_category,
        "scenario_sub_shape": scenario_sub_shape,
        "expected_us_verdict": us_verdict,
        "expected_sg_verdict": sg_verdict,
        "expected_contradiction_type": contradiction_type,
        "reason_summary": reason,
        "raw": {
            "originator_alias": orig.alias,
            "originator_domicile": orig.domicile_country,
            "originator_pep": orig.pep_status,
            "beneficiary_alias": bene.alias,
            "beneficiary_domicile": bene.domicile_country,
            "beneficiary_pep": bene.pep_status,
            "ofac_sdn_match": orig.ofac_sdn or bene.ofac_sdn,
            "mas_tfs_match": orig.mas_tfs or bene.mas_tfs,
            "scenario_category": scenario_category,
            "scenario_sub_shape": scenario_sub_shape,
            "expected_us_verdict": us_verdict,
            "expected_sg_verdict": sg_verdict,
            "expected_contradiction_type": contradiction_type,
            "reason_summary": reason,
            "sg_signals": signals,
            "note": note,
        },
        "occurred_at": occurred_at,
    }


# ---------------------------------------------------------------------------
# Scenario generators — one function per category
# ---------------------------------------------------------------------------

def _random_when(window_start: datetime, window_days: int, rng: np.random.Generator) -> datetime:
    return window_start + timedelta(
        days=int(rng.integers(0, window_days)),
        hours=int(rng.integers(7, 20)),
        minutes=int(rng.integers(0, 60)),
    )


def gen_normal(custs: dict[str, Customer], rng: np.random.Generator,
               window_start: datetime, window_days: int, n: int) -> list[dict[str, Any]]:
    """Category 1 — Normal customer activity (~720 transactions).

    Mix of: SG-domestic SGD, US-domestic USD, SG-US trade, retail remittance,
    SG-corporate-to-FI flows.
    """
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]
    sg_inds = [custs[a] for a in custs if a.startswith("sg_ind_")]
    us_inds = [custs[a] for a in custs if a.startswith("us_ind_")]
    fis = [custs[a] for a in custs if "_fi_" in a]

    txns = []
    for _ in range(n):
        flavour = rng.choice(
            ["sg_dom_b2b", "us_dom_b2b", "sg_payroll", "us_payroll",
             "sg_us_trade", "sg_corp_to_fi", "retail_remit"],
            p=[0.30, 0.20, 0.10, 0.08, 0.18, 0.07, 0.07],
        )
        when = _random_when(window_start, window_days, rng)

        if flavour == "sg_dom_b2b":
            orig = rng.choice(sg_corps)
            bene = rng.choice([c for c in sg_corps if c.id != orig.id])
            amount = float(rng.lognormal(mean=8.5, sigma=0.9))
            currency = "SGD"
            channel = str(rng.choice([CHANNEL_FAST, CHANNEL_GIRO]))
        elif flavour == "us_dom_b2b":
            orig = rng.choice(us_corps)
            bene = rng.choice([c for c in us_corps if c.id != orig.id])
            amount = float(rng.lognormal(mean=8.2, sigma=0.9))
            currency = "USD"
            channel = str(rng.choice([CHANNEL_ACH, CHANNEL_FEDWIRE]))
        elif flavour == "sg_payroll":
            orig = rng.choice(sg_corps)
            bene = rng.choice(sg_inds)
            amount = float(rng.uniform(2_500, 12_000))
            currency = "SGD"
            channel = CHANNEL_GIRO
        elif flavour == "us_payroll":
            orig = rng.choice(us_corps)
            bene = rng.choice(us_inds)
            amount = float(rng.uniform(2_000, 10_000))
            currency = "USD"
            channel = CHANNEL_ACH
        elif flavour == "sg_us_trade":
            if rng.random() < 0.5:
                orig = rng.choice(sg_corps)
                bene = rng.choice(us_corps)
            else:
                orig = rng.choice(us_corps)
                bene = rng.choice(sg_corps)
            amount = float(rng.lognormal(mean=10.5, sigma=0.7))
            currency = "USD"
            channel = CHANNEL_SWIFT
        elif flavour == "sg_corp_to_fi":
            orig = rng.choice(sg_corps)
            bene = rng.choice(fis)
            amount = float(rng.lognormal(mean=10, sigma=0.8))
            currency = str(rng.choice(["SGD", "USD"]))
            channel = CHANNEL_SWIFT if currency == "USD" else CHANNEL_FAST
        else:  # retail_remit
            pool = sg_inds + us_inds
            orig = rng.choice(pool)
            bene = rng.choice([c for c in pool if c.id != orig.id])
            amount = float(rng.uniform(150, 4_500))
            currency = str(rng.choice(["SGD", "USD"]))
            channel = (
                CHANNEL_SWIFT if orig.domicile_country != bene.domicile_country
                else (CHANNEL_FAST if orig.domicile_country == "SG" else CHANNEL_ACH)
            )

        txns.append(_make_txn(
            orig=orig, bene=bene, amount_native=amount, currency=str(currency),
            channel=str(channel), occurred_at=when,
            scenario_category=SCENARIO_NORMAL, scenario_sub_shape=flavour,
            note=f"Normal: {flavour}",
        ))
    return txns


def gen_structuring(custs: dict[str, Customer], rng: np.random.Generator,
                    window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 2 — Structuring patterns (~30 transactions).

    Multiple sub-CTR-threshold cash deposits over a week. Currently the
    rule engine catches these only via ML velocity (structuring
    aggregation is a known GAP).
    """
    txns = []

    # US structuring pattern A: 7 cash deposits just under $10K
    base_day_a = window_start + timedelta(days=int(rng.integers(2, 25)))
    for i in range(7):
        amount = float(rng.uniform(8_400, 9_900))
        when = base_day_a + timedelta(days=i, hours=int(rng.integers(9, 17)))
        # Higher expected ML score because pattern is suspicious
        ml_hint = float(rng.uniform(0.20, 0.45))
        txns.append(_make_txn(
            orig=custs["us_mule_a"], bene=custs["us_sme_imports_a"],
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_STRUCTURING,
            scenario_sub_shape="us_structuring_below_10k_cash",
            expected_ml_score=ml_hint,
            note=f"Structuring leg {i+1}/7 — sub-$10K USD cash",
        ))

    # US structuring pattern B: 6 cash deposits just under $10K, different parties
    base_day_b = window_start + timedelta(days=int(rng.integers(5, 20)))
    for i in range(6):
        amount = float(rng.uniform(9_000, 9_950))
        when = base_day_b + timedelta(days=i, hours=int(rng.integers(9, 17)))
        ml_hint = float(rng.uniform(0.18, 0.40))
        txns.append(_make_txn(
            orig=custs["us_mule_b"], bene=custs["us_sme_imports_b"],
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_STRUCTURING,
            scenario_sub_shape="us_structuring_below_10k_cash",
            expected_ml_score=ml_hint,
            note=f"Structuring round B leg {i+1}/6",
        ))

    # SG sub-floor pattern: small SGD cash deposits (no SG threshold to evade,
    # but the pattern is anomalous and should be ML-detected)
    base_day_c = window_start + timedelta(days=int(rng.integers(8, 25)))
    for i in range(8):
        amount = float(rng.uniform(2_500, 4_500))
        when = base_day_c + timedelta(days=i, hours=int(rng.integers(9, 17)))
        ml_hint = float(rng.uniform(0.15, 0.30))
        txns.append(_make_txn(
            orig=custs["sg_mule_a"], bene=custs["sg_sme_construction_a"],
            amount_native=amount, currency="SGD",
            channel=CHANNEL_CASH_SGD, occurred_at=when,
            scenario_category=SCENARIO_STRUCTURING,
            scenario_sub_shape="sg_repeat_low_value_cash",
            expected_ml_score=ml_hint,
            note=f"Repeat low-value SGD cash leg {i+1}/8",
        ))

    # 9 more single legs to reach ~30
    for _ in range(9):
        when = _random_when(window_start, window_days, rng)
        amount = float(rng.uniform(8_500, 9_950))
        ml_hint = float(rng.uniform(0.10, 0.30))
        txns.append(_make_txn(
            orig=custs["us_mule_a"] if rng.random() < 0.5 else custs["us_mule_b"],
            bene=custs[rng.choice(["us_sme_imports_a", "us_sme_imports_b"])],
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_STRUCTURING,
            scenario_sub_shape="us_structuring_solo_leg",
            expected_ml_score=ml_hint,
            note="Standalone sub-CTR cash deposit",
        ))

    return txns


def gen_large_cash(custs: dict[str, Customer], rng: np.random.Generator,
                   window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 3 — Large cash transactions (~25 transactions).

    Single cash deposits clearly above the US $10K CTR threshold.
    Should fire US.CTR.10K. SG side: allow (no general bank CTR).
    Pure Type B contradiction generator.
    """
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]

    for _ in range(15):  # mostly clean US-SG cash deposits
        when = _random_when(window_start, window_days, rng)
        # SG party deposits USD cash at US-branch teller
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(10_500, 50_000))
        ml_hint = float(rng.uniform(0.02, 0.08))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_LARGE_CASH,
            scenario_sub_shape="usd_cash_above_ctr_clean",
            expected_ml_score=ml_hint,
            note="Large USD cash deposit; mundane purpose",
        ))

    for _ in range(6):  # large SGD cash (no SG CTR, no contradiction unless US in scope)
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice([c for c in sg_corps if c.id != orig.id])
        amount = float(rng.uniform(25_000, 80_000))
        ml_hint = float(rng.uniform(0.02, 0.08))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="SGD",
            channel=CHANNEL_CASH_SGD, occurred_at=when,
            scenario_category=SCENARIO_LARGE_CASH,
            scenario_sub_shape="sgd_cash_no_sg_threshold",
            expected_ml_score=ml_hint,
            note="Large SGD cash; no SG CTR threshold for banks",
        ))

    for _ in range(4):  # large USD cash with co-firing PEP signal (Type A)
        when = _random_when(window_start, window_days, rng)
        # Foreign PEP as beneficiary
        orig = rng.choice(us_corps)
        bene = custs["id_pep_for"]
        amount = float(rng.uniform(15_000, 45_000))
        ml_hint = float(rng.uniform(0.10, 0.25))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_LARGE_CASH,
            scenario_sub_shape="usd_cash_above_ctr_with_pep",
            expected_ml_score=ml_hint,
            note="Large USD cash to foreign PEP",
        ))

    return txns


def gen_rapid_movement(custs: dict[str, Customer], rng: np.random.Generator,
                       window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 4 — Rapid movement of funds (~35 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]
    fis = [custs[a] for a in custs if "_fi_" in a]

    # 3 rapid-movement clusters of ~10 transactions each within a 24-72h window
    for cluster in range(3):
        base_day = window_start + timedelta(days=int(rng.integers(3, 26)))
        cluster_orig = rng.choice(sg_corps + us_corps)
        for i in range(10):
            when = base_day + timedelta(hours=int(rng.integers(0, 70)))
            bene = rng.choice(fis + sg_corps + us_corps)
            if bene.id == cluster_orig.id:
                bene = rng.choice([c for c in fis if c.id != cluster_orig.id])
            amount = float(rng.uniform(15_000, 80_000))
            currency = "USD"
            channel = CHANNEL_SWIFT
            ml_hint = float(rng.uniform(0.20, 0.55))  # high ML — velocity feature
            txns.append(_make_txn(
                orig=cluster_orig, bene=bene,
                amount_native=amount, currency=currency,
                channel=channel, occurred_at=when,
                scenario_category=SCENARIO_RAPID_MOVEMENT,
                scenario_sub_shape="velocity_burst",
                expected_ml_score=ml_hint,
                note=f"Velocity cluster {cluster+1} leg {i+1}",
            ))

    # 5 legitimate merchant payouts (high-velocity but mundane)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(us_corps)
        bene = rng.choice(us_corps + [c for c in custs.values() if c.alias.startswith("us_ind_")])
        if bene.id == orig.id:
            bene = rng.choice([c for c in us_corps if c.id != orig.id])
        amount = float(rng.uniform(500, 5_000))
        ml_hint = float(rng.uniform(0.04, 0.12))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_ACH, occurred_at=when,
            scenario_category=SCENARIO_RAPID_MOVEMENT,
            scenario_sub_shape="legitimate_merchant_payout",
            expected_ml_score=ml_hint,
            note="Legitimate merchant payout (high frequency, low risk)",
        ))

    return txns


def gen_sanctions(custs: dict[str, Customer], rng: np.random.Generator,
                  window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 5 — Sanctions / high-risk country (~30 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]

    # 6 OFAC + MAS-TFS dual matches (Type A — both block)
    for ofac_alias in ["sn_both_a", "sn_both_b", "sn_both_c"]:
        for _ in range(2):
            when = _random_when(window_start, window_days, rng)
            orig = rng.choice(sg_corps + us_corps)
            amount = float(rng.uniform(80_000, 250_000))
            ml_hint = float(rng.uniform(0.30, 0.70))
            txns.append(_make_txn(
                orig=orig, bene=custs[ofac_alias],
                amount_native=amount, currency="USD",
                channel=CHANNEL_SWIFT, occurred_at=when,
                scenario_category=SCENARIO_SANCTIONS,
                scenario_sub_shape="ofac_and_mas_tfs_match",
                expected_ml_score=ml_hint,
                note="Counterparty on both OFAC and MAS-TFS",
            ))

    # 8 OFAC-only matches (Type B — US block, SG allow)
    for ofac_alias in ["sn_ofac_a", "sn_ofac_b", "sn_ofac_c", "sn_ofac_d"]:
        for _ in range(2):
            when = _random_when(window_start, window_days, rng)
            orig = rng.choice(sg_corps)
            amount = float(rng.uniform(50_000, 200_000))
            ml_hint = float(rng.uniform(0.25, 0.60))
            txns.append(_make_txn(
                orig=orig, bene=custs[ofac_alias],
                amount_native=amount, currency="USD",
                channel=CHANNEL_SWIFT, occurred_at=when,
                scenario_category=SCENARIO_SANCTIONS,
                scenario_sub_shape="ofac_only_match",
                expected_ml_score=ml_hint,
                note="Counterparty on OFAC SDN only — drives Type B contradiction",
            ))

    # 8 high-risk country flows (no sanctions match, but country adds risk)
    high_risk_countries = ["id_fi_corr", "ph_fi_corr", "my_fi_corr"]
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = custs[rng.choice(high_risk_countries)]
        amount = float(rng.uniform(20_000, 100_000))
        ml_hint = float(rng.uniform(0.10, 0.25))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SANCTIONS,
            scenario_sub_shape="high_risk_country_flow",
            expected_ml_score=ml_hint,
            note="High-risk country FI counterparty (no sanctions match)",
        ))

    # 4 low-amount sanctions hits (under $5K SAR floor; OFAC still blocks)
    for ofac_alias in ["sn_ofac_a", "sn_both_a"]:
        for _ in range(2):
            when = _random_when(window_start, window_days, rng)
            orig = rng.choice(sg_corps)
            amount = float(rng.uniform(500, 4_500))
            ml_hint = float(rng.uniform(0.15, 0.40))
            txns.append(_make_txn(
                orig=orig, bene=custs[ofac_alias],
                amount_native=amount, currency="USD",
                channel=CHANNEL_SWIFT, occurred_at=when,
                scenario_category=SCENARIO_SANCTIONS,
                scenario_sub_shape="low_amount_sanctions_hit",
                expected_ml_score=ml_hint,
                note="Below SAR floor but sanctions still apply",
            ))

    # 12 OFAC-only with otherwise low signal — drives `US block / SG allow`
    # Type B contradiction. The OFAC SDN counterparty triggers the US sanctions
    # rule, but the SG side has no MAS-TFS hit, no PEP, and the transaction
    # features (low amount, low-risk-rated counterparty, common channel) keep
    # the ML score below the auto-tuned threshold so SG.ML doesn't fire.
    sg_corps_low_risk = [c for c in sg_corps if c.risk_rating <= 2]
    for ofac_alias in ["sn_ofac_lo_a", "sn_ofac_lo_b"]:
        for _ in range(6):
            when = _random_when(window_start, window_days, rng)
            orig = rng.choice(sg_corps_low_risk if sg_corps_low_risk else sg_corps)
            amount = float(rng.uniform(2_000, 4_500))   # below $5K SAR floor
            ml_hint = float(rng.uniform(0.05, 0.15))
            txns.append(_make_txn(
                orig=orig, bene=custs[ofac_alias],
                amount_native=amount, currency="USD",
                channel=CHANNEL_SWIFT, occurred_at=when,
                scenario_category=SCENARIO_SANCTIONS,
                scenario_sub_shape="ofac_only_low_signal",
                expected_ml_score=ml_hint,
                note="OFAC-only, weak SG-side signal — drives US block / SG allow",
            ))

    # 8 sanctioned foreign PEP — drives `US block / SG flag` Type B.
    # The beneficiary is BOTH on OFAC SDN AND a foreign PEP, so:
    #   US: OFAC.SDN fires (block) + US.PEP.FOREIGN fires (flag)  → block
    #   SG: SG.PEP.ALL fires (flag); no MAS-TFS hit                 → flag
    # This contradiction is deterministic — does not depend on the ML score.
    for ofac_pep_alias in ["sn_pep_ofac_a", "sn_pep_ofac_b"]:
        for _ in range(4):
            when = _random_when(window_start, window_days, rng)
            orig = rng.choice(sg_corps)
            amount = float(rng.uniform(8_000, 25_000))
            ml_hint = float(rng.uniform(0.20, 0.45))
            txns.append(_make_txn(
                orig=orig, bene=custs[ofac_pep_alias],
                amount_native=amount, currency="USD",
                channel=CHANNEL_SWIFT, occurred_at=when,
                scenario_category=SCENARIO_SANCTIONS,
                scenario_sub_shape="sanctioned_foreign_pep",
                expected_ml_score=ml_hint,
                note="OFAC SDN + foreign-PEP beneficiary — US block (OFAC) / SG flag (PEP)",
            ))

    return txns


def gen_pep(custs: dict[str, Customer], rng: np.random.Generator,
            window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 6 — PEP activity (~25 transactions).

    Only verified-side mechanics — foreign PEPs (covered by both regimes).
    SG-domestic PEPs are encoded as customers but NOT used in expected-
    verdict assertions for SG firing (per UNVERIFIED status).
    """
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]

    # 12 direct foreign PEP transactions (Type A — both regimes flag)
    for _ in range(12):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = custs[rng.choice(["id_pep_for", "ph_pep_for", "my_pep_for"])]
        amount = float(rng.uniform(35_000, 250_000))
        ml_hint = float(rng.uniform(0.10, 0.40))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_PEP,
            scenario_sub_shape="foreign_pep_direct",
            expected_ml_score=ml_hint,
            note="Direct payment to foreign PEP",
        ))

    # 8 foreign-PEP-via-shell transactions (US.PEP.FOREIGN should fire under
    # correct rule via §1010.605 'entity formed for benefit', but our engine
    # doesn't traverse UBO — this exercises a known GAP)
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = custs[rng.choice(["sh_pep_for_a", "sh_pep_for_b"])]
        amount = float(rng.uniform(80_000, 300_000))
        ml_hint = float(rng.uniform(0.15, 0.50))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_PEP,
            scenario_sub_shape="foreign_pep_via_shell",
            expected_ml_score=ml_hint,
            note="Payment to shell with foreign-PEP UBO (KNOWN GAP)",
        ))

    # 5 SG-domestic PEP shell transactions (encoded but expected-verdict
    # asserts only verified rule: US should NOT flag (foreign-only); SG
    # outcome depends on UNVERIFIED scope)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(["sh_pep_dom_a", "sh_pep_dom_b"])]
        amount = float(rng.uniform(40_000, 100_000))
        ml_hint = float(rng.uniform(0.05, 0.20))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="SGD",
            channel=CHANNEL_FAST, occurred_at=when,
            scenario_category=SCENARIO_PEP,
            scenario_sub_shape="sg_domestic_pep_via_shell",
            expected_ml_score=ml_hint,
            note="SG-domestic PEP shell (SG scope UNVERIFIED, not asserted)",
        ))

    return txns


def gen_cross_border(custs: dict[str, Customer], rng: np.random.Generator,
                     window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 7 — Cross-border / extra-territoriality (~50 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]
    fis = [custs[a] for a in custs if "_fi_" in a]

    # 30 USD via SWIFT cross-border (US in scope by clearing)
    for _ in range(30):
        when = _random_when(window_start, window_days, rng)
        if rng.random() < 0.5:
            orig, bene = rng.choice(sg_corps), rng.choice(fis)
        else:
            orig, bene = rng.choice(fis), rng.choice(us_corps)
        if orig.id == bene.id:
            continue
        amount = float(rng.uniform(8_000, 80_000))
        ml_hint = float(rng.uniform(0.05, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_CROSS_BORDER,
            scenario_sub_shape="usd_swift_cross_border",
            expected_ml_score=ml_hint,
            note="USD via SWIFT cross-border — clears NY",
        ))

    # 12 SGD-only domestic (SG scope only)
    for _ in range(12):
        when = _random_when(window_start, window_days, rng)
        orig, bene = rng.choice(sg_corps), rng.choice([c for c in sg_corps if c.alias != ""])
        if bene.id == orig.id:
            continue
        amount = float(rng.uniform(5_000, 30_000))
        ml_hint = float(rng.uniform(0.02, 0.08))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="SGD",
            channel=CHANNEL_FAST, occurred_at=when,
            scenario_category=SCENARIO_CROSS_BORDER,
            scenario_sub_shape="sgd_domestic",
            expected_ml_score=ml_hint,
            note="SGD-only domestic — no US scope",
        ))

    # 8 mixed-currency layering (multi-leg patterns)
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(fis)
        amount = float(rng.uniform(20_000, 100_000))
        ml_hint = float(rng.uniform(0.20, 0.55))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_CROSS_BORDER,
            scenario_sub_shape="mixed_currency_layering",
            expected_ml_score=ml_hint,
            note="Layering — first leg",
        ))

    return txns


def gen_behavioral_deviation(custs: dict[str, Customer], rng: np.random.Generator,
                             window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 8 — Behavioral deviation (~35 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]
    sg_inds = [custs[a] for a in custs if a.startswith("sg_ind_")]

    # 15 amount-anomaly (10x usual amount)
    for _ in range(15):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = rng.choice(sg_corps + us_corps)
        if bene.id == orig.id:
            continue
        amount = float(rng.uniform(150_000, 500_000))
        ml_hint = float(rng.uniform(0.18, 0.45))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BEHAVIORAL_DEVIATION,
            scenario_sub_shape="amount_10x_usual",
            expected_ml_score=ml_hint,
            note="Amount 10x customer's usual profile",
        ))

    # 12 first-touch new corridor
    for _ in range(12):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_inds)
        bene = rng.choice([c for c in custs.values() if c.alias.startswith("ph_") or c.alias.startswith("my_")])
        amount = float(rng.uniform(8_000, 40_000))
        ml_hint = float(rng.uniform(0.15, 0.35))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BEHAVIORAL_DEVIATION,
            scenario_sub_shape="first_touch_new_corridor",
            expected_ml_score=ml_hint,
            note="Customer's first transaction to this corridor",
        ))

    # 8 new counterparty
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(us_corps)
        bene = rng.choice(sg_corps)
        amount = float(rng.uniform(20_000, 80_000))
        ml_hint = float(rng.uniform(0.10, 0.25))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BEHAVIORAL_DEVIATION,
            scenario_sub_shape="new_counterparty",
            expected_ml_score=ml_hint,
            note="First-time counterparty for this customer",
        ))

    return txns


def gen_just_below_limits(custs: dict[str, Customer], rng: np.random.Generator,
                          window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 9 — Just-below-limits patterns (~30 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]

    # 12 just-below US CTR ($9,900 cash)
    for _ in range(12):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(us_corps)
        bene = rng.choice([c for c in us_corps if c.id != orig.id])
        amount = float(rng.uniform(9_700, 9_999))
        ml_hint = float(rng.uniform(0.10, 0.25))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_CASH_USD, occurred_at=when,
            scenario_category=SCENARIO_JUST_BELOW_LIMITS,
            scenario_sub_shape="just_below_us_ctr_cash",
            expected_ml_score=ml_hint,
            note="USD cash just below $10K CTR threshold",
        ))

    # 10 just-below US SAR ($4,950)
    for _ in range(10):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = rng.choice([c for c in sg_corps + us_corps if c.id != orig.id])
        amount = float(rng.uniform(4_700, 4_999))
        ml_hint = float(rng.uniform(0.05, 0.15))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_JUST_BELOW_LIMITS,
            scenario_sub_shape="just_below_us_sar_floor",
            expected_ml_score=ml_hint,
            note="USD wire just below $5K SAR floor",
        ))

    # 8 standard wires below US SAR floor
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps + us_corps)
        bene = rng.choice([c for c in sg_corps + us_corps if c.id != orig.id])
        amount = float(rng.uniform(3_500, 4_750))
        ml_hint = float(rng.uniform(0.04, 0.12))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_JUST_BELOW_LIMITS,
            scenario_sub_shape="below_sar_floor",
            expected_ml_score=ml_hint,
            note="Below SAR floor — should not fire",
        ))

    return txns


def gen_business_trade(custs: dict[str, Customer], rng: np.random.Generator,
                       window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 10 — Business / trade unusual (~20 transactions)."""
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]

    # 8 round-tripping (originator and ultimate beneficiary related)
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(["sh_pep_dom_a", "sh_pep_dom_b"])]
        amount = float(rng.uniform(50_000, 200_000))
        ml_hint = float(rng.uniform(0.20, 0.50))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BUSINESS_TRADE,
            scenario_sub_shape="round_tripping",
            expected_ml_score=ml_hint,
            note="Suspected round-tripping via PEP-related shell",
        ))

    # 6 unusually high-value trade (mundane but at the top of the distribution)
    for _ in range(6):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(200_000, 800_000))
        ml_hint = float(rng.uniform(0.10, 0.25))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BUSINESS_TRADE,
            scenario_sub_shape="high_value_trade",
            expected_ml_score=ml_hint,
            note="High-value trade — top of distribution",
        ))

    # 6 shell-on-trail (originator beneficially owned by PEP)
    for _ in range(6):
        when = _random_when(window_start, window_days, rng)
        orig = custs[rng.choice(["sh_pep_for_a", "sh_pep_for_b"])]
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(40_000, 150_000))
        ml_hint = float(rng.uniform(0.15, 0.40))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_BUSINESS_TRADE,
            scenario_sub_shape="shell_on_trail",
            expected_ml_score=ml_hint,
            note="Shell-company originator with foreign-PEP UBO",
        ))

    return txns


def gen_sg_block_risk_based(custs: dict[str, Customer], rng: np.random.Generator,
                            window_start: datetime, window_days: int) -> list[dict[str, Any]]:
    """Category 11 — SG-specific risk-based block scenarios (~40 transactions).

    These produce Type C contradictions (SG block / US flag). Each transaction
    has both regimes in scope, sets the appropriate `sg_signals` flag for a
    specific SG.RBR.* rule, and is sized so that US fires SAR (above $5K
    floor with PEP/ML suspicion present) while SG escalates to block.
    """
    txns = []
    sg_corps = [custs[a] for a in custs if a.startswith("sg_sme_")]
    us_corps = [custs[a] for a in custs if a.startswith("us_sme_")]
    foreign_pep_aliases = ["id_pep_for", "ph_pep_for", "my_pep_for"]
    medium_risk_fis = ["id_fi_corr", "ph_fi_corr", "my_fi_corr"]

    # 1. PEP-related unusual cross-border to medium-risk country (5 cases).
    # Originator is a SG-domiciled corporate; beneficiary is a foreign PEP
    # routing to a medium-risk-country FI. SG must be in scope for SG.RBR
    # to fire — using a SG-domiciled originator achieves that.
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(foreign_pep_aliases)]
        amount = float(rng.uniform(20_000, 80_000))
        ml_hint = float(rng.uniform(0.05, 0.15))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="pep_unusual_cross_border",
            expected_ml_score=ml_hint,
            sg_signals={"pep_high_risk_destination": True},
            note="SG corp paying foreign PEP in medium-risk corridor; unclear purpose",
        ))

    # 2. Trade-based ML with inconsistent invoice (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(50_000, 200_000))
        ml_hint = float(rng.uniform(0.05, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="tbml_inconsistent_invoice",
            expected_ml_score=ml_hint,
            sg_signals={"tbml_inconsistent": True},
            note="Trade payment: invoice value vs goods description mismatch",
        ))

    # 3. Complex layering across countries with small amounts (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(medium_risk_fis)]
        amount = float(rng.uniform(3_000, 4_900))
        ml_hint = float(rng.uniform(0.10, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="complex_layering_multi_country",
            expected_ml_score=ml_hint,
            sg_signals={"complex_layering": True},
            note="Funds routed across multiple countries in small amounts",
        ))

    # 4. High-risk customer sudden behavior change (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(15_000, 60_000))
        ml_hint = float(rng.uniform(0.08, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="sudden_behavior_change",
            expected_ml_score=ml_hint,
            sg_signals={"behavioral_deviation_strong": True},
            note="Low-activity account suddenly transacts at scale",
        ))

    # 5. PEP via intermediary accounts (5 cases).
    # The intermediary is a SG bank account belonging to the SG corp; SG in
    # scope as originator. Foreign PEP is the ultimate destination via a
    # medium-risk FI counterparty.
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(foreign_pep_aliases)]
        amount = float(rng.uniform(10_000, 50_000))
        ml_hint = float(rng.uniform(0.10, 0.20))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="pep_intermediary_routing",
            expected_ml_score=ml_hint,
            sg_signals={"pep_intermediary_layering": True},
            note="SG intermediary account routes funds to foreign PEP via multiple hops",
        ))

    # 6. Business payment with missing documentation (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(20_000, 70_000))
        ml_hint = float(rng.uniform(0.08, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="missing_documentation",
            expected_ml_score=ml_hint,
            sg_signals={"missing_documentation": True},
            note="Corporate transfer without supporting documentation",
        ))

    # 7. Frequent transfers just below thresholds to medium-risk country (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = custs[rng.choice(medium_risk_fis)]
        amount = float(rng.uniform(8_500, 9_900))
        ml_hint = float(rng.uniform(0.12, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="repeated_below_threshold",
            expected_ml_score=ml_hint,
            sg_signals={"repeated_pattern_below_threshold": True},
            note="Repeated transfers just below high-value thresholds, same destination",
        ))

    # 8. Newly-onboarded high-risk customer large transfer (5 cases)
    for _ in range(5):
        when = _random_when(window_start, window_days, rng)
        orig = rng.choice(sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(80_000, 250_000))
        ml_hint = float(rng.uniform(0.08, 0.18))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="new_customer_large_transfer",
            expected_ml_score=ml_hint,
            sg_signals={"new_customer_large_transfer": True},
            note="Newly-onboarded high-risk customer; large transfer pre-EDD complete",
        ))

    # 9. Low-signal TBML — engineered for `US allow / SG block` Type C contradiction.
    # Same SG.RBR.TBML mechanic as scenario 2, but sized so the ML model
    # gives a low score on both sides (small amount, clean profile, normal
    # corridor). The SG.RBR rule fires deterministically from the
    # tbml_inconsistent flag; US has nothing to fire (no OFAC, no PEP, no
    # cash channel, ML below threshold). Sub-shape excluded from ML training
    # positives (see train_model.py:make_label) so the model doesn't learn
    # to flag it on the US side.
    for _ in range(8):
        when = _random_when(window_start, window_days, rng)
        sg_low_risk = [c for c in sg_corps if c.risk_rating <= 2]
        orig = rng.choice(sg_low_risk if sg_low_risk else sg_corps)
        bene = rng.choice(us_corps)
        amount = float(rng.uniform(3_000, 4_900))   # below US SAR floor
        ml_hint = float(rng.uniform(0.04, 0.12))
        txns.append(_make_txn(
            orig=orig, bene=bene,
            amount_native=amount, currency="USD",
            channel=CHANNEL_SWIFT, occurred_at=when,
            scenario_category=SCENARIO_SG_BLOCK_RISK_BASED,
            scenario_sub_shape="tbml_low_signal",
            expected_ml_score=ml_hint,
            sg_signals={"tbml_inconsistent": True},
            note="Low-signal TBML — drives US allow / SG block (Type C, deterministic)",
        ))

    return txns


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--n", type=int, default=1000,
                   help="Total target transaction count (Normal pool fills the gap)")
    p.add_argument("--out", type=Path, default=Path("data"))
    p.add_argument("--window-days", type=int, default=30)
    p.add_argument("--csv", action="store_true",
                   help="Also write CSV copies of customers/transactions plus "
                        "a transactions_sample.csv with 5 rows per scenario "
                        "category. Useful for sharing the dataset with "
                        "non-Python reviewers (examiners, professors).")
    p.add_argument("--ml-threshold", type=float, default=DEFAULT_ML_THRESHOLD,
                   help=f"Reference ML threshold used for expected_verdict "
                        f"labelling only. Default {DEFAULT_ML_THRESHOLD}. "
                        f"The actual deployed threshold is auto-tuned by "
                        f"train_model.py per run; this value affects ground "
                        f"truth labels only and is NOT read from any prior "
                        f"artifact (so the same seed produces identical "
                        f"output regardless of local model state).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)
    # Seed the UUID generator from the same --seed so transaction IDs are
    # reproducible. Use a salted seed so the UUID stream is independent of
    # the numeric rng stream (changing one shouldn't shift the other).
    _uuid_rng.seed(args.seed * 2654435761 + 1)
    # Pin the labelling threshold for this run. predict_verdicts() reads
    # the module-level ML_THRESHOLD; setting it here keeps everything
    # explicit and CLI-controllable.
    global ML_THRESHOLD
    ML_THRESHOLD = float(args.ml_threshold)

    window_end = datetime(2026, 4, 24, tzinfo=timezone.utc)
    window_start = window_end - timedelta(days=args.window_days)

    customers = build_customers(rng)
    by = by_alias(customers)

    # Generate non-Normal scenarios first
    scenario_txns: list[dict[str, Any]] = []
    scenario_txns += gen_structuring(by, rng, window_start, args.window_days)
    scenario_txns += gen_large_cash(by, rng, window_start, args.window_days)
    scenario_txns += gen_rapid_movement(by, rng, window_start, args.window_days)
    scenario_txns += gen_sanctions(by, rng, window_start, args.window_days)
    scenario_txns += gen_pep(by, rng, window_start, args.window_days)
    scenario_txns += gen_cross_border(by, rng, window_start, args.window_days)
    scenario_txns += gen_behavioral_deviation(by, rng, window_start, args.window_days)
    scenario_txns += gen_just_below_limits(by, rng, window_start, args.window_days)
    scenario_txns += gen_business_trade(by, rng, window_start, args.window_days)
    scenario_txns += gen_sg_block_risk_based(by, rng, window_start, args.window_days)

    # Fill the rest with Normal traffic
    n_normal = max(0, args.n - len(scenario_txns))
    normal_txns = gen_normal(by, rng, window_start, args.window_days, n_normal)

    all_txns = scenario_txns + normal_txns
    all_txns.sort(key=lambda t: t["occurred_at"])

    args.out.mkdir(parents=True, exist_ok=True)

    # Customers
    cust_records = [
        {
            "id": c.id,
            "legal_name": c.legal_name,
            "customer_type": c.customer_type,
            "domicile_country": c.domicile_country,
            "pep_status": c.pep_status,
            "risk_rating": c.risk_rating,
            "onboarded_at": c.onboarded_at,
            "beneficial_owner": c.beneficial_owner,
            "ofac_sdn": c.ofac_sdn,
            "mas_tfs": c.mas_tfs,
            "alias": c.alias,
        }
        for c in customers
    ]
    cust_df = pd.DataFrame(cust_records)
    cust_df.to_parquet(args.out / "customers.parquet", index=False)

    # Transactions
    txn_records: list[dict[str, Any]] = []
    for t in all_txns:
        txn_records.append({
            **t,
            "in_scope_jurisdictions": list(t["in_scope_jurisdictions"]),
            "raw": json.dumps(t["raw"]),
        })
    txn_df = pd.DataFrame(txn_records)
    txn_df.to_parquet(args.out / "transactions.parquet", index=False)

    # Optional CSV export for human inspection (e.g. to share with examiners
    # or non-Python reviewers). Parquet remains the canonical pipeline format
    # because it preserves the dict-typed `raw` column natively; CSV stores
    # `raw` as a JSON string and `in_scope_jurisdictions` as a Python repr.
    if args.csv:
        cust_df.to_csv(args.out / "customers.csv", index=False)
        # Coerce list column to JSON for CSV portability
        txn_csv = txn_df.copy()
        txn_csv["in_scope_jurisdictions"] = txn_csv["in_scope_jurisdictions"].apply(json.dumps)
        txn_csv.to_csv(args.out / "transactions.csv", index=False)

        # A small representative sample for demos: 5 rows per scenario
        # category. Keeps the file under a few hundred rows so the whole
        # thing fits on a screen.
        sample = (
            txn_csv.groupby("scenario_category", group_keys=False, as_index=False)
            .head(5)
            .reset_index(drop=True)
        )
        sample.to_csv(args.out / "transactions_sample.csv", index=False)

    # Summary
    by_category = Counter(t["scenario_category"] for t in all_txns)
    by_contradiction = Counter(t["expected_contradiction_type"] for t in all_txns)
    by_us_verdict = Counter(t["expected_us_verdict"] for t in all_txns)
    by_sg_verdict = Counter(t["expected_sg_verdict"] for t in all_txns)

    summary = {
        "seed": args.seed,
        "n_transactions": len(all_txns),
        "n_customers": len(customers),
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "by_scenario_category": dict(by_category),
        "by_expected_contradiction_type": dict(by_contradiction),
        "by_expected_us_verdict": dict(by_us_verdict),
        "by_expected_sg_verdict": dict(by_sg_verdict),
        "by_currency": dict(Counter(t["currency"] for t in all_txns)),
        "by_channel": dict(Counter(t["channel"] for t in all_txns)),
    }
    with (args.out / "generation_summary.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("Generated dataset:")
    print(f"  customers:    {len(customers)}")
    print(f"  transactions: {len(all_txns)}")
    print(f"\nBy scenario category:")
    for k, v in sorted(by_category.items()):
        print(f"  {k:35s} {v:5d}")
    print(f"\nBy expected contradiction type:")
    for k, v in sorted(by_contradiction.items()):
        print(f"  Type {k}: {v:5d}")
    print(f"\nBy expected verdict (US):")
    for k, v in by_us_verdict.items():
        print(f"  {k:15s} {v:5d}")
    print(f"\nBy expected verdict (SG):")
    for k, v in by_sg_verdict.items():
        print(f"  {k:15s} {v:5d}")
    print(f"\nOutputs in: {args.out.resolve()}")


if __name__ == "__main__":
    main()
