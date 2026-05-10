"""
Strait Compliance — Model Training Pipeline
============================================

Trains the LightGBM AML scorer on the synthetic dataset, computes TreeSHAP
attributions for every transaction, exports an ONNX artifact for edge
inference (best effort), and emits a JSON predictions cache the Worker
reads. Optionally writes a row to the `model_versions` registry in Neon.

Run after `generate_synthetic_data.py`:

    python train_model.py --seed 42

Optional flags:
    --no-neon        Don't write a model_versions row to Neon
    --skip-onnx      Skip ONNX export (use only the predictions cache at edge)
    --test-frac F    Stratified holdout fraction (default 0.2)

Outputs (under ./models/, also mirrored into ../worker/data/ for the
Cloudflare Worker bundle — pass --no-worker-sync to skip the mirror):
    model.txt              — LightGBM Booster text format (always)
    model.onnx             — ONNX export (if onnxmltools succeeded)
    metadata.json          — feature names, metrics, hyperparameters, SHA-256
    predictions.json       — per-transaction score + SHAP attributions

The predictions cache is the canonical artifact the Worker consumes; ONNX
is the stretch goal for genuine edge inference. See architecture §6.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Mandatory ML deps
import lightgbm as lgb
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

# Optional: ONNX export
try:
    from onnxmltools.convert import convert_lightgbm
    from onnxmltools.convert.common.data_types import FloatTensorType
    ONNX_AVAILABLE = True
except Exception as exc:        # noqa: BLE001
    ONNX_AVAILABLE = False
    _ONNX_IMPORT_ERROR = repr(exc)

# Optional: SHAP explainability
try:
    import shap
    SHAP_AVAILABLE = True
except Exception as exc:        # noqa: BLE001
    SHAP_AVAILABLE = False
    _SHAP_IMPORT_ERROR = repr(exc)

# Optional: Neon write-back
try:
    import psycopg
    from psycopg.types.json import Jsonb
    from dotenv import load_dotenv
    NEON_AVAILABLE = True
except Exception as exc:        # noqa: BLE001
    NEON_AVAILABLE = False
    _NEON_IMPORT_ERROR = repr(exc)


# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data"
MODELS_DIR = PIPELINE_DIR / "models"
# Worker bundle path — predictions.json and model-metadata.json are
# imported as TS modules from worker/data/, so we mirror them there at
# the end of every training run. Pass --no-worker-sync to skip.
WORKER_DATA_DIR = PROJECT_ROOT / "worker" / "data"

# Categorical levels — fixed up-front so feature columns are stable across
# runs. If the synthetic generator introduces new values, the schema check
# in engineer_features() raises so this list is updated explicitly.
# Keeping them enumerated is intentional — examiner-readable.
CURRENCY_LEVELS = ["USD", "SGD"]
CHANNEL_LEVELS = [
    "FAST", "GIRO", "SWIFT", "CHIPS", "FEDWIRE", "ACH",
    "CASH_USD", "CASH_SGD",
]
DOMICILE_LEVELS = [
    "SG", "US", "ID", "PH", "IR", "KP", "VE", "CU",
    "MY", "RU", "SY",
]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    customers = pd.read_parquet(DATA_DIR / "customers.parquet")
    transactions = pd.read_parquet(DATA_DIR / "transactions.parquet")
    if "raw" in transactions.columns and isinstance(transactions["raw"].iloc[0], str):
        transactions["raw_dict"] = transactions["raw"].apply(json.loads)
    else:
        transactions["raw_dict"] = transactions["raw"]
    return customers, transactions


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def add_velocity_features(df: pd.DataFrame) -> pd.DataFrame:
    """For each transaction, count + sum of prior originator transactions in
    the trailing 24h and 7d windows. Implemented as a simple O(n²) loop —
    n = 1000, so this finishes in well under a second."""

    df = df.sort_values("occurred_at").reset_index(drop=True)
    counts_24h, sums_24h, counts_7d, sums_7d = [], [], [], []

    for i in range(len(df)):
        row = df.iloc[i]
        if i == 0:
            counts_24h.append(0); sums_24h.append(0.0)
            counts_7d.append(0); sums_7d.append(0.0)
            continue

        prior = df.iloc[:i]
        same_orig = prior[prior["originator_id"] == row["originator_id"]]
        cutoff_24h = row["occurred_at"] - pd.Timedelta(hours=24)
        cutoff_7d = row["occurred_at"] - pd.Timedelta(days=7)

        in_24h = same_orig[same_orig["occurred_at"] >= cutoff_24h]
        in_7d = same_orig[same_orig["occurred_at"] >= cutoff_7d]

        counts_24h.append(len(in_24h))
        sums_24h.append(float(in_24h["amount_usd"].fillna(0).sum()))
        counts_7d.append(len(in_7d))
        sums_7d.append(float(in_7d["amount_usd"].fillna(0).sum()))

    df["velocity_24h_count"] = counts_24h
    df["velocity_24h_amount"] = sums_24h
    df["velocity_7d_count"] = counts_7d
    df["velocity_7d_amount"] = sums_7d
    return df


def _check_categorical_coverage(df: pd.DataFrame, customers: pd.DataFrame) -> None:
    """Fail loudly if the data contains categorical values the trainer's
    one-hot levels don't cover. Without this guardrail, unseen channels or
    domiciles silently collapse into an all-zero one-hot bucket and the
    model loses signal in those scenarios — the bug the code review caught.
    """
    obs_currency = set(df["currency"].dropna().astype(str).unique())
    obs_channel = set(df["channel"].dropna().astype(str).unique())
    obs_domicile = set(customers["domicile_country"].dropna().astype(str).unique())

    missing_currency = obs_currency - set(CURRENCY_LEVELS)
    missing_channel = obs_channel - set(CHANNEL_LEVELS)
    missing_domicile = obs_domicile - set(DOMICILE_LEVELS)

    issues: list[str] = []
    if missing_currency:
        issues.append(f"unknown currencies: {sorted(missing_currency)} "
                      f"(add to CURRENCY_LEVELS in train_model.py)")
    if missing_channel:
        issues.append(f"unknown channels: {sorted(missing_channel)} "
                      f"(add to CHANNEL_LEVELS in train_model.py)")
    if missing_domicile:
        issues.append(f"unknown domiciles: {sorted(missing_domicile)} "
                      f"(add to DOMICILE_LEVELS in train_model.py)")
    if issues:
        raise ValueError(
            "Categorical coverage check failed — observed values not in the "
            "trainer's one-hot levels. These would silently become all-zero "
            "buckets and lose signal:\n  - " + "\n  - ".join(issues)
        )


def engineer_features(transactions: pd.DataFrame, customers: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Produce a numeric feature matrix X and return the ordered list of
    feature column names. All categoricals are one-hot encoded so the
    feature vector is stable for ONNX export.
    """

    _check_categorical_coverage(transactions, customers)

    cust_lookup = customers.set_index("id")

    df = transactions.copy()

    # Customer joins — originator and beneficiary
    df["originator_risk_rating"] = df["originator_id"].map(cust_lookup["risk_rating"]).astype(float)
    df["beneficiary_risk_rating"] = df["beneficiary_id"].map(cust_lookup["risk_rating"]).astype(float)

    df["originator_pep"] = df["originator_id"].map(cust_lookup["pep_status"]).fillna("none")
    df["beneficiary_pep"] = df["beneficiary_id"].map(cust_lookup["pep_status"]).fillna("none")

    bo = cust_lookup["beneficial_owner"]
    df["originator_is_shell"] = df["originator_id"].map(bo).notna().astype(int)
    df["beneficiary_is_shell"] = df["beneficiary_id"].map(bo).notna().astype(int)

    df["originator_domicile"] = df["originator_id"].map(cust_lookup["domicile_country"]).fillna("XX")
    df["beneficiary_domicile"] = df["beneficiary_id"].map(cust_lookup["domicile_country"]).fillna("XX")

    # Boolean / threshold features
    df["amount_just_under_us_ctr"] = (
        (df["amount_usd"].fillna(0) >= 8000) & (df["amount_usd"].fillna(0) < 10000)
    ).astype(int)
    df["amount_just_under_sg_ctr"] = (
        (df["amount_sgd"].fillna(0) >= 16000) & (df["amount_sgd"].fillna(0) < 20000)
    ).astype(int)

    df["is_cross_border"] = (df["originator_domicile"] != df["beneficiary_domicile"]).astype(int)
    df["is_usd_swift_xb"] = (
        (df["currency"] == "USD")
        & (df["channel"] == "SWIFT")
        & (df["is_cross_border"] == 1)
    ).astype(int)

    df["ofac_sdn_match"] = df["raw_dict"].apply(
        lambda r: int(bool(r.get("ofac_sdn_match", False)))
    )
    df["mas_tfs_match"] = df["raw_dict"].apply(
        lambda r: int(bool(r.get("mas_tfs_match", False)))
    )

    df["pep_originator_foreign"] = (df["originator_pep"] == "foreign").astype(int)
    df["pep_originator_domestic"] = (df["originator_pep"] == "domestic").astype(int)
    df["pep_beneficiary_foreign"] = (df["beneficiary_pep"] == "foreign").astype(int)
    df["pep_beneficiary_domestic"] = (df["beneficiary_pep"] == "domestic").astype(int)

    df["n_jurisdictions_in_scope"] = df["in_scope_jurisdictions"].apply(len).astype(int)

    # Transformed amount — log1p(USD-equivalent) so the distribution is
    # closer to symmetric and very large amounts don't dominate splits
    df["amount_usd_log"] = np.log1p(df["amount_usd"].fillna(0).astype(float))

    # Velocity features (originator activity in trailing windows)
    df = add_velocity_features(df)

    # One-hot encode the small fixed set of categoricals
    for col, levels in [
        ("currency", CURRENCY_LEVELS),
        ("channel", CHANNEL_LEVELS),
        ("originator_domicile", DOMICILE_LEVELS),
        ("beneficiary_domicile", DOMICILE_LEVELS),
    ]:
        for lv in levels:
            df[f"{col}_{lv}"] = (df[col] == lv).astype(int)

    feature_cols: list[str] = [
        # numeric
        "amount_usd_log",
        "originator_risk_rating",
        "beneficiary_risk_rating",
        "velocity_24h_count",
        "velocity_24h_amount",
        "velocity_7d_count",
        "velocity_7d_amount",
        "n_jurisdictions_in_scope",
        # boolean
        "amount_just_under_us_ctr",
        "amount_just_under_sg_ctr",
        "is_cross_border",
        "is_usd_swift_xb",
        "ofac_sdn_match",
        "mas_tfs_match",
        "originator_is_shell",
        "beneficiary_is_shell",
        "pep_originator_foreign",
        "pep_originator_domestic",
        "pep_beneficiary_foreign",
        "pep_beneficiary_domestic",
        # one-hot
        *[f"currency_{lv}" for lv in CURRENCY_LEVELS],
        *[f"channel_{lv}" for lv in CHANNEL_LEVELS],
        *[f"originator_domicile_{lv}" for lv in DOMICILE_LEVELS],
        *[f"beneficiary_domicile_{lv}" for lv in DOMICILE_LEVELS],
    ]

    return df, feature_cols


# ---------------------------------------------------------------------------
# Training and evaluation
# ---------------------------------------------------------------------------

def make_label(transactions: pd.DataFrame) -> pd.Series:
    """y = 1 if the transaction is a pattern the ML model is responsible for.

    The ML model and the rule engine share the alert-detection job. The rules
    catch the *deterministic* patterns (OFAC SDN match, MAS-TFS match, US CTR
    cash floor). The ML model is responsible for the *long tail* — velocity,
    behavioural deviation, structuring, business-trade anomalies — the cases
    rules can't pin down with a hard threshold.

    Training the ML on cases the rules already catch would teach it redundant
    signal AND make it over-fire on the OTHER jurisdiction's ML rule when the
    deterministic rule fires asymmetrically. Concretely: training on
    `ofac_only_low_signal` (US-only sanctions) teaches the model to flag any
    OFAC SDN match — which then makes SG.ML.THRESHOLD fire on the SG side
    too, collapsing the `US block / SG allow` Type B contradiction back into
    `US block / SG flag`. Excluding rule-deterministic sub-shapes from the
    positive set keeps the contradiction shape intact.

    Sub-shapes excluded from the positive set:
      - ofac_only_low_signal — US block via OFAC; SG has no MAS-TFS, so we
        deliberately keep the ML signal weak so SG verdict is `allow`.
      - tbml_low_signal — SG block via SG.RBR.TBML; US has no rule to fire,
        so we keep the ML signal weak so US verdict is `allow`.

    Falls back to `typology` for legacy data files without scenario_category.
    """
    if "scenario_category" in transactions.columns:
        is_non_normal = transactions["scenario_category"] != "1_normal"
        # Sub-shapes whose detection is the rule engine's job, not ML's.
        rule_owned_subshapes = {"ofac_only_low_signal", "tbml_low_signal"}
        sub = transactions.get("scenario_sub_shape", pd.Series([""] * len(transactions)))
        is_rule_owned = sub.isin(rule_owned_subshapes)
        return (is_non_normal & ~is_rule_owned).astype(int)
    return (transactions["typology"] != "NORMAL").astype(int)


def train_lightgbm(X_train: pd.DataFrame, y_train: pd.Series,
                   X_val: pd.DataFrame, y_val: pd.Series,
                   seed: int) -> lgb.Booster:
    n_pos = int(y_train.sum())
    n_neg = int(len(y_train) - n_pos)
    scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0

    params = {
        "objective": "binary",
        "metric": ["auc", "binary_logloss"],
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": 6,
        "min_child_samples": 5,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 5,
        "scale_pos_weight": scale_pos_weight,
        "verbosity": -1,
        "seed": seed,
        "deterministic": True,
    }

    train_set = lgb.Dataset(X_train, label=y_train)
    val_set = lgb.Dataset(X_val, label=y_val, reference=train_set)

    booster = lgb.train(
        params,
        train_set,
        num_boost_round=300,
        valid_sets=[train_set, val_set],
        valid_names=["train", "val"],
        callbacks=[lgb.early_stopping(25), lgb.log_evaluation(0)],
    )
    return booster


def tune_threshold_on_validation(
    booster: lgb.Booster,
    X_val: pd.DataFrame,
    y_val: pd.Series,
) -> float:
    """Pick the F1-maximising threshold on the validation set.

    Run BEFORE the final test-set evaluation so the persisted threshold
    isn't fit to the same data we report metrics on. Without this split,
    the test metrics are optimistic and the deployed threshold is partially
    leaked from the evaluation set.
    """
    if y_val.sum() == 0:
        return 0.5
    y_pred_val = booster.predict(X_val, num_iteration=booster.best_iteration)
    precisions, recalls, thresholds = precision_recall_curve(y_val, y_pred_val)
    # precision_recall_curve returns thresholds of length (n - 1)
    f1s = 2 * precisions[:-1] * recalls[:-1] / (precisions[:-1] + recalls[:-1] + 1e-9)
    if len(f1s) == 0:
        return 0.5
    best_idx = int(np.argmax(f1s))
    return float(thresholds[best_idx])


def evaluate(booster: lgb.Booster, X_test: pd.DataFrame, y_test: pd.Series,
             typology_test: pd.Series, decision_threshold: float) -> dict:
    """Evaluate on the held-out test set using a threshold frozen earlier
    on the validation split. The threshold is an INPUT here — never tuned
    on test data — so the reported metrics are honest."""
    y_pred = booster.predict(X_test, num_iteration=booster.best_iteration)

    y_pred_label = (y_pred > decision_threshold).astype(int)
    metrics: dict = {"decision_threshold": decision_threshold}
    if y_test.sum() > 0:
        metrics["roc_auc"] = float(roc_auc_score(y_test, y_pred))
        metrics["pr_auc"] = float(average_precision_score(y_test, y_pred))
    metrics["n_test_total"] = int(len(y_test))
    metrics["n_test_positive"] = int(y_test.sum())
    metrics["n_predicted_positive"] = int(y_pred_label.sum())
    metrics["n_true_positive"] = int(((y_pred_label == 1) & (y_test == 1)).sum())
    metrics["n_false_positive"] = int(((y_pred_label == 1) & (y_test == 0)).sum())
    metrics["n_false_negative"] = int(((y_pred_label == 0) & (y_test == 1)).sum())

    # Recall by typology — the model card commitment from architecture §8
    recall_by_typology: dict[str, dict] = {}
    for typ in sorted(set(typology_test)):
        if typ in ("NORMAL", "1_normal"):
            continue
        mask = (typology_test == typ).to_numpy() if hasattr(typology_test, "to_numpy") else np.asarray(typology_test == typ)
        n_total = int(mask.sum())
        if n_total == 0:
            continue
        n_caught = int(((y_pred_label == 1) & mask).sum())
        recall_by_typology[typ] = {
            "n_total": n_total,
            "n_caught": n_caught,
            "recall": round(n_caught / n_total, 4),
        }
    metrics["recall_by_typology"] = recall_by_typology
    return metrics


# ---------------------------------------------------------------------------
# SHAP attributions
# ---------------------------------------------------------------------------

def compute_shap(booster: lgb.Booster, X_full: pd.DataFrame, feature_names: list[str]) -> dict:
    if not SHAP_AVAILABLE:
        warnings.warn(f"SHAP unavailable: {_SHAP_IMPORT_ERROR}. "
                      f"Falling back to LightGBM gain importance.")
        gain = booster.feature_importance(importance_type="gain")
        gain_norm = gain / gain.sum() if gain.sum() > 0 else gain
        return {
            "method": "lightgbm_gain_fallback",
            "base_value": 0.0,
            "shap_values": [list(map(float, gain_norm)) for _ in range(len(X_full))],
            "feature_names": feature_names,
        }

    explainer = shap.TreeExplainer(booster)
    sv = explainer.shap_values(X_full)
    # Some LightGBM/SHAP combos return a list (one entry per class) for binary;
    # we want the suspicious-class attributions. Pick the last entry if list.
    if isinstance(sv, list):
        sv = sv[-1]
    base = explainer.expected_value
    if isinstance(base, (list, np.ndarray)):
        base = float(np.array(base).flatten()[-1])
    else:
        base = float(base)
    return {
        "method": "tree_shap",
        "base_value": base,
        "shap_values": sv.tolist(),
        "feature_names": feature_names,
    }


# ---------------------------------------------------------------------------
# ONNX export
# ---------------------------------------------------------------------------

def export_onnx(booster: lgb.Booster, n_features: int, output_path: Path) -> bool:
    if not ONNX_AVAILABLE:
        warnings.warn(f"ONNX export skipped: {_ONNX_IMPORT_ERROR}")
        return False
    try:
        initial_types = [("input", FloatTensorType([None, n_features]))]
        onnx_model = convert_lightgbm(
            booster, initial_types=initial_types, target_opset=15
        )
        with output_path.open("wb") as f:
            f.write(onnx_model.SerializeToString())
        return True
    except Exception as exc:    # noqa: BLE001
        warnings.warn(f"ONNX export failed: {exc!r}")
        return False


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

def write_predictions_cache(
    *,
    transaction_ids: list[str],
    scores: np.ndarray,
    shap_payload: dict,
    feature_names: list[str],
    model_sha256: str,
    output_path: Path,
) -> None:
    cache = {
        "schema_version": 1,
        "model_sha256": model_sha256,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "feature_names": feature_names,
        "base_value": shap_payload["base_value"],
        "shap_method": shap_payload["method"],
        "predictions": {},
    }
    sv = shap_payload["shap_values"]
    for i, txn_id in enumerate(transaction_ids):
        cache["predictions"][txn_id] = {
            "score": float(scores[i]),
            "shap": {feature_names[j]: float(sv[i][j]) for j in range(len(feature_names))},
        }
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))


def jurisdiction_validation(scores: np.ndarray, transactions: pd.DataFrame) -> dict:
    """Per-jurisdiction calibration sanity check committed in the model card.
    Reports score distribution stratified by which AML regime is in scope.
    Used in Task 4 when the examiner asks 'is the model uniform across
    jurisdictions or is one regime systematically over-flagged?'"""
    out = {}
    df = transactions.copy()
    df["score"] = scores
    for label in ["{US}", "{SG}", "{SG,US}"]:
        mask = df["in_scope_jurisdictions"].apply(
            lambda j: "{" + ",".join(sorted(j)) + "}" == label
        )
        if mask.sum() == 0:
            continue
        out[label] = {
            "n": int(mask.sum()),
            "mean_score": float(df.loc[mask, "score"].mean()),
            "p95_score": float(df.loc[mask, "score"].quantile(0.95)),
            "n_above_threshold_0_5": int((df.loc[mask, "score"] > 0.5).sum()),
        }
    return out


# ---------------------------------------------------------------------------
# Neon write-back
# ---------------------------------------------------------------------------

def write_model_version_to_neon(*, sha256: str, metadata: dict) -> bool:
    if not NEON_AVAILABLE:
        warnings.warn(f"Neon write-back skipped: psycopg/dotenv unavailable.")
        return False

    env_path = PROJECT_ROOT / ".env.local"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv(PROJECT_ROOT / ".env")

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        warnings.warn("DATABASE_URL not set; skipping model_versions insert.")
        return False

    try:
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO model_versions
                        (sha256, model_type, trained_at, features, metrics,
                         shap_baseline, jurisdiction_validation)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sha256) DO UPDATE SET
                        trained_at = EXCLUDED.trained_at,
                        metrics = EXCLUDED.metrics,
                        shap_baseline = EXCLUDED.shap_baseline,
                        jurisdiction_validation = EXCLUDED.jurisdiction_validation
                    """,
                    (
                        sha256,
                        "lightgbm_binary",
                        datetime.now(timezone.utc),
                        Jsonb(metadata["features"]),
                        Jsonb(metadata["metrics"]),
                        Jsonb(metadata["shap_baseline"]),
                        Jsonb(metadata["jurisdiction_validation"]),
                    ),
                )
            conn.commit()
        return True
    except Exception as exc:    # noqa: BLE001
        warnings.warn(f"Neon write failed: {exc!r}")
        return False


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--test-frac", type=float, default=0.2)
    p.add_argument("--no-neon", action="store_true",
                   help="Don't insert a model_versions row into Neon")
    p.add_argument("--skip-onnx", action="store_true",
                   help="Don't attempt ONNX export")
    p.add_argument("--no-worker-sync", action="store_true",
                   help="Don't copy predictions.json + metadata.json into "
                        "worker/data/ at the end of training")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    np.random.seed(args.seed)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Strait Compliance — Model Training")
    print("=" * 60)
    print(f"Seed: {args.seed}    Test fraction: {args.test_frac:.0%}")
    print(f"SHAP available: {SHAP_AVAILABLE}    "
          f"ONNX available: {ONNX_AVAILABLE and not args.skip_onnx}    "
          f"Neon: {NEON_AVAILABLE and not args.no_neon}")

    print("\nLoading data...")
    customers, transactions = load_data()
    print(f"  customers: {len(customers)}    transactions: {len(transactions)}")

    print("\nEngineering features...")
    df, feature_cols = engineer_features(transactions, customers)
    X = df[feature_cols].astype(float).to_numpy()
    y = make_label(df).to_numpy()
    label_col = "scenario_category" if "scenario_category" in df.columns else "typology"
    typology = df[label_col].to_numpy(dtype=object)
    txn_ids = df["id"].astype(str).tolist()
    print(f"  feature dim: {len(feature_cols)}")
    print(f"  positive rate: {y.mean():.2%} ({int(y.sum())}/{len(y)})")

    # Train / validation / test split. Threshold tuning happens on the
    # validation split, NOT on test, so the persisted threshold isn't fit
    # to the same data the reported metrics are computed on.
    print("\nStratified train / val / test split...")
    val_frac_of_remainder = args.test_frac / max(1.0 - args.test_frac, 1e-9)
    X_trval, X_te, y_trval, y_te, typ_trval, typ_te, idx_trval, idx_te = train_test_split(
        X, y, typology, np.arange(len(y)),
        test_size=args.test_frac, random_state=args.seed, stratify=y,
    )
    X_tr, X_val, y_tr, y_val, typ_tr, typ_val, idx_tr, idx_val = train_test_split(
        X_trval, y_trval, typ_trval, idx_trval,
        test_size=val_frac_of_remainder, random_state=args.seed,
        stratify=y_trval if y_trval.sum() > 0 else None,
    )
    print(f"  train: {len(y_tr)} ({int(y_tr.sum())} positive)")
    print(f"  val:   {len(y_val)} ({int(y_val.sum())} positive)")
    print(f"  test:  {len(y_te)} ({int(y_te.sum())} positive)")

    print("\nTraining LightGBM...")
    X_tr_df = pd.DataFrame(X_tr, columns=feature_cols)
    X_val_df = pd.DataFrame(X_val, columns=feature_cols)
    X_te_df = pd.DataFrame(X_te, columns=feature_cols)
    booster = train_lightgbm(X_tr_df, pd.Series(y_tr),
                             X_val_df, pd.Series(y_val), seed=args.seed)

    # Tune the decision threshold on validation. Frozen before test eval.
    decision_threshold = tune_threshold_on_validation(
        booster, X_val_df, pd.Series(y_val),
    )
    print(f"\nDecision threshold (F1-optimal on validation): "
          f"{decision_threshold:.4f}")

    print("\nEvaluating on held-out test...")
    metrics = evaluate(
        booster, X_te_df, pd.Series(y_te),
        pd.Series(typ_te), decision_threshold=decision_threshold,
    )
    print(f"  ROC-AUC: {metrics.get('roc_auc'):.4f}    "
          f"PR-AUC: {metrics.get('pr_auc'):.4f}")
    print(f"  Decision threshold (frozen from validation): "
          f"{metrics['decision_threshold']:.4f}")
    print(f"  TP={metrics['n_true_positive']}  "
          f"FP={metrics['n_false_positive']}  "
          f"FN={metrics['n_false_negative']}")
    print("  Recall by typology:")
    for typ, vals in metrics["recall_by_typology"].items():
        print(f"    {typ:32s} {vals['n_caught']}/{vals['n_total']}  "
              f"recall={vals['recall']:.2f}")

    # Save text booster regardless of ONNX outcome — used for hash + reload
    booster_path = MODELS_DIR / "model.txt"
    booster.save_model(str(booster_path))

    # ONNX export (best effort)
    onnx_ok = False
    onnx_path = MODELS_DIR / "model.onnx"
    if not args.skip_onnx:
        print("\nExporting ONNX...")
        onnx_ok = export_onnx(booster, len(feature_cols), onnx_path)
        print(f"  ONNX: {'ok -> ' + str(onnx_path) if onnx_ok else 'failed/skipped'}")

    # SHA-256 of the canonical model artifact (ONNX if available, else text)
    canonical_path = onnx_path if onnx_ok else booster_path
    with canonical_path.open("rb") as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()
    print(f"\nModel SHA-256: {sha256[:16]}…  (from {canonical_path.name})")

    # Score every transaction (full dataset, train+test) and compute SHAP
    print("\nScoring full dataset and computing SHAP...")
    full_X_df = pd.DataFrame(X, columns=feature_cols)
    scores_full = booster.predict(full_X_df, num_iteration=booster.best_iteration)
    shap_payload = compute_shap(booster, full_X_df, feature_cols)

    # Predictions cache
    pred_path = MODELS_DIR / "predictions.json"
    write_predictions_cache(
        transaction_ids=txn_ids,
        scores=scores_full,
        shap_payload=shap_payload,
        feature_names=feature_cols,
        model_sha256=sha256,
        output_path=pred_path,
    )
    print(f"  predictions cache -> {pred_path}  ({pred_path.stat().st_size/1024:.1f} KB)")

    # Global SHAP baseline = mean |SHAP| per feature, useful for the dashboard
    sv = np.array(shap_payload["shap_values"])
    shap_baseline = {
        feature_cols[i]: float(np.abs(sv[:, i]).mean())
        for i in range(sv.shape[1])
    }

    jur_validation = jurisdiction_validation(scores_full, df)

    metadata = {
        "model_sha256": sha256,
        "model_type": "lightgbm_binary",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_train": int(len(y_tr)),
        "n_test": int(len(y_te)),
        "best_iteration": int(booster.best_iteration or booster.num_trees()),
        "features": feature_cols,
        "metrics": metrics,
        "shap_baseline": shap_baseline,
        "jurisdiction_validation": jur_validation,
        "hyperparameters": {
            "objective": "binary",
            "learning_rate": 0.05,
            "num_leaves": 31,
            "max_depth": 6,
            "scale_pos_weight": "auto (n_neg / n_pos)",
            "early_stopping_rounds": 25,
        },
        "training_window": {
            "transaction_count": int(len(y)),
            "positive_count": int(y.sum()),
            "positive_rate": round(float(y.mean()), 4),
        },
    }
    with (MODELS_DIR / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"  metadata -> {MODELS_DIR / 'metadata.json'}")

    # Mirror to the worker bundle so the running Worker imports the latest
    # predictions + threshold without a manual copy step. Worker still needs
    # a `wrangler dev` reload to pick the new bundle up.
    if not args.no_worker_sync:
        WORKER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        worker_predictions = WORKER_DATA_DIR / "predictions.json"
        worker_metadata = WORKER_DATA_DIR / "model-metadata.json"
        shutil.copyfile(MODELS_DIR / "predictions.json", worker_predictions)
        shutil.copyfile(MODELS_DIR / "metadata.json", worker_metadata)
        print(f"\nWorker sync:")
        print(f"  {worker_predictions}")
        print(f"  {worker_metadata}")
        print(f"  (restart `wrangler dev` to pick up the new bundle)")

    # Neon write-back
    if not args.no_neon:
        print("\nWriting model_versions row to Neon...")
        ok = write_model_version_to_neon(sha256=sha256, metadata=metadata)
        print(f"  {'inserted/updated' if ok else 'skipped'}")

    print("\nDone.")


if __name__ == "__main__":
    main()
