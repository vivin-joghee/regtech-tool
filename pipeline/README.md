# Strait Compliance — Offline Pipeline

Python scripts that produce the synthetic dataset, train the ML scorer, and generate model artifacts. Runs locally; outputs are uploaded to Neon (transactional data) and Cloudflare R2 (model artifacts) by separate seed scripts.

## Quick start

```bash
# From the pipeline/ directory
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 1. Generate synthetic data → data/customers.parquet, data/transactions.parquet
python generate_synthetic_data.py --seed 42 --n 1000

# 2. Seed Neon (dev branch)
#    First: copy ../.env.example to ../.env.local and paste the DEV branch
#    DATABASE_URL into it.
python seed_neon.py --dry-run      # preview only
python seed_neon.py                # destructive; prompts for 'yes'
python seed_neon.py --yes          # destructive; non-interactive (CI)
```

Subsequent steps (added in upcoming commits):

- `train_model.py` — train LightGBM scorer, export ONNX + metadata
- `compute_shap.py` — run TreeSHAP, write attribution cache to R2

## Targeting dev vs production

`seed_neon.py` reads `DATABASE_URL` from `.env.local` at the project root. Whichever branch's connection string is set there is the one that gets seeded. The default — and what you should use for development — is the **dev** branch (`br-young-snow-aoio3c7n`). Only change `DATABASE_URL` to the **production** branch URL when you're seeding the demo state.

The seeder always prints the (password-redacted) target URL and prompts for `yes` before destroying data. Pass `--yes` only in scripted workflows where you've already verified the target.

## Reproducibility

Every script is deterministic given a `--seed` value. The default seed for the assignment dataset is `42`. Do not change it without documenting why.

## Outputs

| File | Contents | Where it ends up |
|---|---|---|
| `data/customers.parquet` | ~30 customers covering every PEP / sanctions / domicile permutation needed for the typologies | Seeded into Neon `customers` table |
| `data/transactions.parquet` | ~1,000 transactions, ~5% labelled positive across 6 typology families | Seeded into Neon `transactions` table |
| `data/generation_summary.json` | Summary statistics — counts per typology, distribution by jurisdiction, sanctions hits, contradictions | Committed to repo for reviewer auditability |
