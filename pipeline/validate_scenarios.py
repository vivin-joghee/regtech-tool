"""
Strait Compliance — Scenario Validator
=======================================

Reads alerts and contradictions from Neon, joins on the expected_*
columns persisted in `transactions.raw`, and writes a JSON report
documenting how well the rule engine's actual output matches the
ground truth from the generator.

Run after generate_synthetic_data.py + seed_neon.py + replay-all:
    python validate_scenarios.py

Outputs:
    data/scenario_validation_report.json
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from dotenv import load_dotenv

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data"


VERDICT_RANK = {"allow": 0, "flag": 1, "block": 2}

# Mirrors worker/src/rules/types.ts and worker/src/rules/sg-specific.ts:
# any rule ID containing one of these substrings produces a `block` verdict
# in the worker engine. SANCTIONS rules block (OFAC SDN, MAS-TFS); the
# Singapore risk-based rules (`SG.RBR.*`) also block. CTR fires `flag`.
# SAR/STR meta-rules fire `flag`. PEP fires `flag`. ML.THRESHOLD fires `flag`.
BLOCK_RULE_MARKERS = ("SANCTIONS", ".RBR.")


def aggregate_verdict(rule_ids: list[str]) -> str:
    """Compute the most-restrictive verdict from a list of rule_ids.

    Mirrors `mostRestrictive(verdicts)` in worker/src/rules/types.ts. The
    earlier heuristic (only SANCTIONS → block) was incomplete: SG.RBR.*
    rules also produce block verdicts, and any rule whose ID matches
    BLOCK_RULE_MARKERS escalates to block. Everything else flags.
    """
    if not rule_ids:
        return "allow"
    if any(any(m in r for m in BLOCK_RULE_MARKERS) for r in rule_ids):
        return "block"
    return "flag"


def load_db_url() -> str:
    env_path = PROJECT_ROOT / ".env.local"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv(PROJECT_ROOT / ".env")
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit("DATABASE_URL not set. Configure .env.local at project root.")
    return db_url


def fetch_state(db_url: str) -> dict[str, Any]:
    with psycopg.connect(db_url) as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("""
                SELECT t.id,
                       t.in_scope_jurisdictions,
                       t.raw->>'scenario_category' AS scenario_category,
                       t.raw->>'scenario_sub_shape' AS scenario_sub_shape,
                       t.raw->>'expected_us_verdict' AS expected_us_verdict,
                       t.raw->>'expected_sg_verdict' AS expected_sg_verdict,
                       t.raw->>'expected_contradiction_type' AS expected_contradiction_type,
                       t.raw->>'reason_summary' AS reason_summary
                FROM transactions t
            """)
            txns = cur.fetchall()

            cur.execute("""
                SELECT transaction_id, jurisdiction, rule_id, status
                FROM alerts
            """)
            alerts = cur.fetchall()

            cur.execute("""
                SELECT transaction_id, us_verdict, sg_verdict, resolution
                FROM jurisdiction_contradictions
            """)
            contras = cur.fetchall()

    return {"transactions": txns, "alerts": alerts, "contradictions": contras}


def compute_actual_verdicts(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Index alerts and contradictions by transaction_id."""
    by_txn: dict[str, dict[str, Any]] = {}
    for t in state["transactions"]:
        by_txn[str(t["id"])] = {
            "txn": t,
            "us_alerts": [],
            "sg_alerts": [],
            "contradiction": None,
        }

    for a in state["alerts"]:
        txn_id = str(a["transaction_id"])
        if txn_id not in by_txn:
            continue
        if a["jurisdiction"] == "US":
            by_txn[txn_id]["us_alerts"].append(a["rule_id"])
        elif a["jurisdiction"] == "SG":
            by_txn[txn_id]["sg_alerts"].append(a["rule_id"])

    for c in state["contradictions"]:
        txn_id = str(c["transaction_id"])
        if txn_id in by_txn:
            by_txn[txn_id]["contradiction"] = {
                "us_verdict": c["us_verdict"],
                "sg_verdict": c["sg_verdict"],
                "resolution": c["resolution"],
            }

    return by_txn


def compute_actual_verdict(in_scope: list[str], jur: str, alerts: list[str]) -> str:
    if jur not in in_scope:
        return "not_in_scope"
    return aggregate_verdict(alerts)


def actual_contradiction_type(
    in_scope: list[str],
    us_alerts: list[str],
    sg_alerts: list[str],
    persisted_contradiction: dict[str, str] | None = None,
) -> str:
    """Classify the realised contradiction type from the worker's output.

    A — both regimes alert AND agree (same verdict)
    B — US verdict is more restrictive than SG (US block/flag while SG allows,
        or US block while SG flags)
    C — SG verdict is more restrictive than US (mirror of B)
    D — neither regime alerts, OR the transaction is single-jurisdiction
        (no contradiction is possible across only one regime)

    The earlier implementation flagged any dual-alert case as `A`, so a
    `US=block, SG=flag` divergence was misclassified as agreement. The
    worker writes a `jurisdiction_contradictions` row whenever the two
    verdicts differ at all — we use that as the primary source of truth
    when available, and fall back to recomputation from the alerts list
    using the same `mostRestrictive` ordering the worker uses.
    """
    dual = "US" in in_scope and "SG" in in_scope
    if not dual:
        return "D"

    if persisted_contradiction is not None:
        us_v = persisted_contradiction["us_verdict"]
        sg_v = persisted_contradiction["sg_verdict"]
    else:
        us_v = aggregate_verdict(us_alerts)
        sg_v = aggregate_verdict(sg_alerts)

    us_rank = VERDICT_RANK[us_v]
    sg_rank = VERDICT_RANK[sg_v]

    if us_v == sg_v and us_rank > 0:
        return "A"
    if us_rank > sg_rank:
        return "B"
    if sg_rank > us_rank:
        return "C"
    return "D"


def diagnose(expected_us: str, actual_us: str, expected_sg: str, actual_sg: str,
             scenario_sub: str) -> str:
    if expected_us == actual_us and expected_sg == actual_sg:
        return "match"
    # Known gaps
    if "via_shell" in (scenario_sub or "") and (
        actual_us == "allow" and "pep" in (scenario_sub or "").lower()
    ):
        return "known_gap_pep_ubo_traversal"
    if "structuring" in (scenario_sub or "") and actual_us in ("allow", "flag") and expected_us == "flag":
        return "known_gap_structuring_aggregation"
    if (expected_us == "flag" and actual_us == "allow") or (expected_sg == "flag" and actual_sg == "allow"):
        return "engine_under_fires"
    if (expected_us == "allow" and actual_us in ("flag", "block")) or (
        expected_sg == "allow" and actual_sg in ("flag", "block")
    ):
        return "engine_over_fires"
    if expected_us != actual_us or expected_sg != actual_sg:
        return "verdict_mismatch_other"
    return "match"


def build_report(state: dict[str, Any]) -> dict[str, Any]:
    by_txn = compute_actual_verdicts(state)

    by_category: dict[str, dict[str, int]] = defaultdict(
        lambda: {"expected_total": 0, "matches": 0, "mismatches": 0}
    )
    by_contradiction: dict[str, dict[str, int]] = defaultdict(
        lambda: {"expected": 0, "actual": 0, "matched": 0, "unintended": 0}
    )
    diagnosis_buckets: Counter[str] = Counter()
    mismatches: list[dict[str, Any]] = []

    for txn_id, entry in by_txn.items():
        t = entry["txn"]
        expected_us = t["expected_us_verdict"]
        expected_sg = t["expected_sg_verdict"]
        expected_contra = t["expected_contradiction_type"]
        scenario_cat = t["scenario_category"]
        scenario_sub = t["scenario_sub_shape"]
        in_scope = t["in_scope_jurisdictions"] or []

        actual_us = compute_actual_verdict(in_scope, "US", entry["us_alerts"])
        actual_sg = compute_actual_verdict(in_scope, "SG", entry["sg_alerts"])
        # Prefer the worker's persisted contradiction row over recomputation:
        # the row is the result of the same scoring pass that wrote the alerts,
        # so it's the authoritative answer to "what did the engine decide?"
        actual_contra = actual_contradiction_type(
            in_scope,
            entry["us_alerts"],
            entry["sg_alerts"],
            persisted_contradiction=entry["contradiction"],
        )

        diagnosis = diagnose(expected_us, actual_us, expected_sg, actual_sg, scenario_sub)
        diagnosis_buckets[diagnosis] += 1

        cat_stats = by_category[scenario_cat]
        cat_stats["expected_total"] += 1
        if expected_us == actual_us and expected_sg == actual_sg:
            cat_stats["matches"] += 1
        else:
            cat_stats["mismatches"] += 1
            mismatches.append({
                "transaction_id": txn_id,
                "scenario_category": scenario_cat,
                "scenario_sub_shape": scenario_sub,
                "in_scope": in_scope,
                "expected_us_verdict": expected_us,
                "actual_us_verdict": actual_us,
                "expected_sg_verdict": expected_sg,
                "actual_sg_verdict": actual_sg,
                "expected_contradiction": expected_contra,
                "actual_contradiction": actual_contra,
                "actual_us_hits": entry["us_alerts"],
                "actual_sg_hits": entry["sg_alerts"],
                "diagnosis": diagnosis,
                "reason_summary": t["reason_summary"],
            })

        by_contradiction[expected_contra]["expected"] += 1
        by_contradiction[actual_contra]["actual"] += 1
        if expected_contra == actual_contra:
            by_contradiction[expected_contra]["matched"] += 1
        else:
            by_contradiction[actual_contra]["unintended"] += 1

    # Acceptance criteria
    normal_match_rate = (
        by_category.get("1_normal", {"matches": 0, "expected_total": 1})["matches"]
        / by_category.get("1_normal", {"matches": 0, "expected_total": 1})["expected_total"]
    )
    type_a = by_contradiction.get("A", {"expected": 0, "matched": 0})
    type_b = by_contradiction.get("B", {"expected": 0, "matched": 0})

    acceptance = {
        "normal_category_match_rate_target": 0.99,
        "normal_category_match_rate_actual": round(normal_match_rate, 4),
        "normal_category_meets_target": normal_match_rate >= 0.99,

        "type_a_match_rate_target": 0.85,
        "type_a_match_rate_actual": (
            round(type_a["matched"] / type_a["expected"], 4) if type_a["expected"] else 1.0
        ),
        "type_a_meets_target": (
            (type_a["matched"] / type_a["expected"] >= 0.85) if type_a["expected"] else True
        ),

        "type_b_match_rate_target": 0.85,
        "type_b_match_rate_actual": (
            round(type_b["matched"] / type_b["expected"], 4) if type_b["expected"] else 1.0
        ),
        "type_b_meets_target": (
            (type_b["matched"] / type_b["expected"] >= 0.85) if type_b["expected"] else True
        ),
    }

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "transactions": len(state["transactions"]),
            "alerts": len(state["alerts"]),
            "contradictions": len(state["contradictions"]),
        },
        "by_scenario_category": dict(by_category),
        "by_contradiction_type": dict(by_contradiction),
        "diagnosis_buckets": dict(diagnosis_buckets),
        "acceptance_criteria": acceptance,
        "mismatches": mismatches[:200],
        "mismatch_count_total": len(mismatches),
    }


def main() -> None:
    db_url = load_db_url()
    state = fetch_state(db_url)
    report = build_report(state)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DATA_DIR / "scenario_validation_report.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    print("Validation report:")
    print(f"  transactions:    {report['summary']['transactions']}")
    print(f"  alerts:          {report['summary']['alerts']}")
    print(f"  contradictions:  {report['summary']['contradictions']}")
    print()
    print("By scenario category (expected vs actual match):")
    for cat, stats in sorted(report["by_scenario_category"].items()):
        total = stats["expected_total"]
        matches = stats["matches"]
        pct = (matches / total * 100) if total else 0
        print(f"  {cat:30s} {matches:4d}/{total:<4d}  ({pct:5.1f}%)")
    print()
    print("By contradiction type:")
    for ctype, stats in sorted(report["by_contradiction_type"].items()):
        print(f"  Type {ctype}: expected={stats['expected']:4d}  "
              f"actual={stats['actual']:4d}  matched={stats['matched']:4d}  "
              f"unintended={stats['unintended']:4d}")
    print()
    print("Diagnosis buckets:")
    for bucket, n in sorted(report["diagnosis_buckets"].items(), key=lambda x: -x[1]):
        print(f"  {bucket:35s} {n:5d}")
    print()
    print("Acceptance criteria:")
    for k, v in report["acceptance_criteria"].items():
        print(f"  {k}: {v}")
    print()
    print(f"Full report -> {out_path}")


if __name__ == "__main__":
    main()
