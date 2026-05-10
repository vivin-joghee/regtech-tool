# Strait Compliance — Synthetic Dataset

This folder is the dataset the prototype runs against. **All data is synthetic — no real customer, transaction, or sanctions information is used.** It is generated from the deterministic Python script at [`pipeline/generate_synthetic_data.py`](../generate_synthetic_data.py) and re-runnable from a fixed seed.

## How the data was produced

```
python pipeline/generate_synthetic_data.py --seed 42 --csv
```

- `--seed 42` makes the run reproducible (same seed → byte-identical output).
- The generator does NOT read any real bank data, OFAC list, or MAS feed.
- "Sanctioned" entities, "PEPs", and shell-company names are invented — the
  rule engine treats them as such only because the generator marks them with
  `ofac_sdn=True` / `pep_status="foreign"` flags in the customer record.
- All names, addresses, and amounts are fabricated.

## What's in the folder

| File | Rows | Purpose |
|---|---:|---|
| `customers.csv` | 84 | The synthetic customer pool — corporates, individuals, FIs, PEPs, sanctioned entities, mules. CSV format for inspection. |
| `customers.parquet` | 84 | Same data, parquet format — the canonical pipeline input (preserves dtypes). |
| `transactions.csv` | 1,000 | One row per synthetic transaction. Each carries `expected_us_verdict`, `expected_sg_verdict`, and `expected_contradiction_type` columns set by the generator — used as ground truth by `validate_scenarios.py`. |
| `transactions.parquet` | 1,000 | Same, parquet. |
| `transactions_sample.csv` | 55 | A curated sample — 5 transactions per scenario category. Best file to skim if you want to see the shape of the data without paging through 1,000 rows. |
| `generation_summary.json` | — | Counts by scenario category, expected verdict, and contradiction type. |
| `scenario_validation_report.json` | — | After replaying through the rule engine, this compares actual vs expected verdicts per category. Honest mismatch reporting is a deliberate choice. |

## What's modelled

1,000 transactions split across 11 scenario categories ([`pipeline/SCENARIO_DESIGN.md`](../SCENARIO_DESIGN.md)):

| # | Category | Why it matters for AML |
|---|---|---|
| 1 | Normal | The realistic baseline — must NOT over-flag |
| 2 | Structuring | Multiple cash deposits just below US $10K |
| 3 | Large cash | Single cash deposit > $10K (US.CTR fires; SG has no general CTR) |
| 4 | Rapid movement | Velocity bursts across corridors |
| 5 | Sanctions / high-risk | OFAC SDN, MAS-TFS, OFAC-only, sanctioned-foreign-PEP combos |
| 6 | PEP | Foreign PEPs (verified rules only) |
| 7 | Cross-border | USD via SWIFT — tests US extraterritoriality (NY clearing) |
| 8 | Behavioral deviation | Sudden activity spikes |
| 9 | Just-below-limits | $9,900 / $4,950 patterns |
| 10 | Business / trade unusual | Round-tripping, shell companies |
| 11 | SG-specific risk-based | The 8 SG.RBR.* rules — drives Type C contradictions |

Each transaction is annotated by the generator with its expected verdict per regime, so the validator can flag every divergence between the engine's actual output and the design intent.

## Why parquet AND csv

- **CSV** is human-readable and opens in Excel — best for sharing with examiners or non-Python readers.
- **Parquet** preserves the dict-typed `raw` column and the list-typed `in_scope_jurisdictions` column natively. CSV stores both as JSON strings, which is portable but loses query ergonomics.

The pipeline reads parquet (faster, type-safe). CSV is the demo artefact.

## Reproducibility

Two runs with the same `--seed` produce byte-identical parquet + CSV files. UUID generation is also seeded, so `transactions[*].id` columns match across runs — which is necessary for the SHAP cache (`worker/data/predictions.json`) to remain joinable to the database after a re-seed.

## What is NOT in this folder

- Real customer PII
- Real OFAC / MAS sanctions lists (we use 7 invented entities flagged via the `ofac_sdn`/`mas_tfs` columns)
- Live transaction feeds
- Production model artefacts (those live in [`worker/data/`](../../worker/data/))
