# Strait Compliance — Cloudflare Worker (API)

Hono-based API on Cloudflare Workers, talking to Neon Postgres via `@neondatabase/serverless`.

## Quick start

```bash
cd worker
npm install

# 1. Local secrets — create worker/.dev.vars (gitignored) with:
#    DATABASE_URL=postgresql://...   # the dev branch URL

# 2. Local dev server (http://localhost:8787)
npm run dev

# 3. Type-check
npm run typecheck

# 4. Deploy (only when ready)
npm run deploy
```

## Endpoints (Phase A.1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status, rule pack SHAs, model SHA |
| GET | `/api/jurisdiction-config` | Both rule packs |
| GET | `/api/jurisdiction-config/:code` | One rule pack (US or SG) + raw YAML |
| POST | `/api/score` | Score an arbitrary payload (no persist) |
| POST | `/api/score/:transactionId` | Preview-score an existing transaction (no persist) |
| GET | `/api/transactions` | Paginated transactions list |
| POST | `/api/transactions/:id/replay` | Score an existing transaction + persist alerts/contradictions |
| POST | `/api/transactions/replay-all` | Walk every transaction in DB and score all of them (demo helper) |
| GET | `/api/alerts?jurisdiction=&status=` | Filterable alerts list |
| GET | `/api/contradictions?status=` | Filterable contradictions list |

## Architecture

The Worker is one of three artifacts in the project (see [`Task3_Architecture.md`](../Task3_Architecture.md)). It owns:

1. **Rule engine** ([`src/rules/`](src/rules/)) — pure TypeScript, takes a `TransactionContext` + `MlSignal`, returns a `ScoringResult`. Tested in isolation.
2. **Jurisdiction rule packs** ([`config/us.yaml`](config/us.yaml), [`config/sg.yaml`](config/sg.yaml)) — examiner-readable source of truth. Bundled as text via Wrangler's `[[rules]] type = "Text"` config; SHA-256 of each file is computed at module init and persisted on every alert.
3. **Predictions cache** ([`data/predictions.json`](data/)) — pre-scored output of `pipeline/train_model.py`. Bundled with the worker for the prototype; would live in R2 in production.

## When the model retrains

Re-run the offline pipeline, then refresh the worker's bundled artifacts:

```bash
# from project root
cd pipeline && python train_model.py --seed 42
cp models/predictions.json ../worker/data/predictions.json
cp models/metadata.json ../worker/data/model-metadata.json
cd ../worker && npm run deploy
```

## What's deferred to Phase A.2

- `GET /api/alerts/:id` (full alert detail with SHAP visualisation payload)
- `POST /api/sar-scaffold/:alertId`
- `POST /api/transactions/ingest` (full create-flow for fresh transactions, vs replay-existing)
- `GET /api/model-card`
- `GET /api/audit-log`
- `POST /api/alerts/:id/review` (override / dismiss / file)
- Auth via Cloudflare Access
- KV-backed rule pack reload (currently bundled at deploy time)
- R2-backed predictions cache (currently bundled)
