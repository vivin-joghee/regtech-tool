"""
Strait Compliance — Neon Postgres Seeder
=========================================

Reads the parquet files produced by `generate_synthetic_data.py` and loads
them into the active Neon branch identified by `DATABASE_URL`.

The seed is destructive by design: it TRUNCATEs the dataset tables before
inserting, so the demo state is reproducible. To prevent accidental wipes,
the script always prints the (password-redacted) target URL and prompts
for confirmation unless `--yes` is supplied.

Run (after `python generate_synthetic_data.py`):

    # 1. Copy .env.example to .env.local at the project root and paste in
    #    the DEV branch DATABASE_URL.
    # 2. Activate the venv.
    python seed_neon.py                # prompts before destructive actions
    python seed_neon.py --yes          # skip the prompt
    python seed_neon.py --dry-run      # show what would happen, do nothing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import pandas as pd
import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data"

# Tables we own (and therefore TRUNCATE). Order matters — children first
# so foreign-key cascade is unambiguous, even though we use CASCADE.
DATASET_TABLES = [
    "audit_log",
    "jurisdiction_contradictions",
    "alerts",
    "transactions",
    "customers",
]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true",
                   help="Print the planned operations and exit without writing")
    p.add_argument("--yes", action="store_true",
                   help="Skip the interactive confirmation prompt (use in CI)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def redact_password(url: str) -> str:
    """Replace the password component of a postgres URL with *** for logging."""
    return re.sub(r"(://[^:]+):[^@]+@", r"\1:***@", url)


def load_dataframes() -> tuple[pd.DataFrame, pd.DataFrame]:
    customers_path = DATA_DIR / "customers.parquet"
    transactions_path = DATA_DIR / "transactions.parquet"
    if not customers_path.exists() or not transactions_path.exists():
        sys.exit(
            f"Parquet files not found in {DATA_DIR}. "
            f"Run `python generate_synthetic_data.py` first."
        )
    customers = pd.read_parquet(customers_path)
    transactions = pd.read_parquet(transactions_path)
    return customers, transactions


def prepare_customer_rows(df: pd.DataFrame) -> list[dict]:
    """Project the parquet dataframe down to the columns the Postgres schema
    actually has. ofac_sdn / mas_tfs / alias are generator-internal only."""
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "id": r["id"],
            "legal_name": r["legal_name"],
            "customer_type": r["customer_type"],
            "domicile_country": r["domicile_country"],
            "pep_status": r["pep_status"],
            "risk_rating": int(r["risk_rating"]),
            "onboarded_at": r["onboarded_at"].to_pydatetime()
                if hasattr(r["onboarded_at"], "to_pydatetime") else r["onboarded_at"],
            "beneficial_owner": r["beneficial_owner"]
                if pd.notna(r["beneficial_owner"]) else None,
        })
    return rows


def prepare_transaction_rows(df: pd.DataFrame) -> list[dict]:
    """Map parquet rows to insertable dicts.

    The generator now writes scenario_category, expected_us_verdict, etc.
    as top-level columns on the parquet AND inside `raw`. We ingest only
    the canonical Postgres schema columns and trust that `raw` already
    carries the scenario fields for downstream queries."""
    rows = []
    for _, r in df.iterrows():
        # raw was serialized to a JSON string in generate_synthetic_data.py
        raw_dict = json.loads(r["raw"])
        rows.append({
            "id": r["id"],
            "originator_id": r["originator_id"],
            "beneficiary_id": r["beneficiary_id"],
            "amount_native": float(r["amount_native"]),
            "currency": r["currency"],
            "amount_usd": float(r["amount_usd"]) if pd.notna(r["amount_usd"]) else None,
            "amount_sgd": float(r["amount_sgd"]) if pd.notna(r["amount_sgd"]) else None,
            "corridor": r["corridor"],
            "channel": r["channel"],
            "in_scope_jurisdictions": list(r["in_scope_jurisdictions"]),
            "raw": Jsonb(raw_dict),
            "occurred_at": r["occurred_at"].to_pydatetime()
                if hasattr(r["occurred_at"], "to_pydatetime") else r["occurred_at"],
        })
    return rows


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

INSERT_CUSTOMER_SQL = """
INSERT INTO customers
    (id, legal_name, customer_type, domicile_country, pep_status,
     risk_rating, onboarded_at, beneficial_owner)
VALUES
    (%(id)s, %(legal_name)s, %(customer_type)s, %(domicile_country)s,
     %(pep_status)s, %(risk_rating)s, %(onboarded_at)s, %(beneficial_owner)s)
"""

INSERT_TRANSACTION_SQL = """
INSERT INTO transactions
    (id, originator_id, beneficiary_id, amount_native, currency,
     amount_usd, amount_sgd, corridor, channel, in_scope_jurisdictions,
     raw, occurred_at)
VALUES
    (%(id)s, %(originator_id)s, %(beneficiary_id)s, %(amount_native)s,
     %(currency)s, %(amount_usd)s, %(amount_sgd)s, %(corridor)s,
     %(channel)s, %(in_scope_jurisdictions)s, %(raw)s, %(occurred_at)s)
"""


def truncate_tables(cur: psycopg.Cursor) -> None:
    cur.execute(
        "TRUNCATE " + ", ".join(DATASET_TABLES) + " RESTART IDENTITY CASCADE"
    )


def verify_counts(cur: psycopg.Cursor) -> dict[str, int]:
    counts = {}
    for table in DATASET_TABLES:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        row = cur.fetchone()
        counts[table] = row[0] if row else 0
    return counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    # Load env from project root, not pipeline dir
    env_path = PROJECT_ROOT / ".env.local"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        # Fallback: also try .env
        load_dotenv(PROJECT_ROOT / ".env")

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sys.exit(
            "DATABASE_URL not set. Copy .env.example to .env.local at the "
            "project root and paste in the dev branch connection string."
        )

    customers_df, transactions_df = load_dataframes()
    cust_rows = prepare_customer_rows(customers_df)
    txn_rows = prepare_transaction_rows(transactions_df)

    print("=" * 60)
    print("Strait Compliance — Neon Seeder")
    print("=" * 60)
    print(f"Target:        {redact_password(db_url)}")
    print(f"Will TRUNCATE: {', '.join(DATASET_TABLES)}")
    print(f"Will INSERT:   {len(cust_rows):>4} customers")
    print(f"               {len(txn_rows):>4} transactions")
    print("=" * 60)

    if args.dry_run:
        print("DRY RUN — no changes made.")
        return

    if not args.yes:
        ans = input("Proceed? Type 'yes' to continue: ")
        if ans.strip().lower() != "yes":
            print("Aborted.")
            return

    print("Connecting...")
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            print("  Truncating dataset tables...")
            truncate_tables(cur)

            print(f"  Inserting {len(cust_rows)} customers...")
            cur.executemany(INSERT_CUSTOMER_SQL, cust_rows)

            print(f"  Inserting {len(txn_rows)} transactions...")
            cur.executemany(INSERT_TRANSACTION_SQL, txn_rows)

            print("  Verifying counts...")
            counts = verify_counts(cur)
        conn.commit()

    print("\nFinal row counts:")
    for table, count in counts.items():
        print(f"  {table:<30s} {count:>5d}")

    print("\nDone.")


if __name__ == "__main__":
    main()
