# Strait Compliance — Web (Cloudflare Pages)

Vite + React 18 + TypeScript + Tailwind 4. Talks to the Worker API at `/api/*` (proxied to `http://localhost:8787` by Vite during local dev).

## Quick start

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Make sure the Worker is also running (`cd ../worker && npm run dev`). Vite's proxy in [vite.config.ts](vite.config.ts) routes `/api/*` to the Worker on port 8787.

## Pages (Phase 1 of the frontend)

| Route | Built fully? | Notes |
|---|---|---|
| `/` | ✓ | Landing — explains scope and (deliberately) the tool's exclusions, per Task 2 |
| `/dashboard` | ✓ | Counts + version badges + Replay all button |
| `/transactions` | ✓ | Paginated full dataset view |
| `/alerts` | ✓ | Filterable by jurisdiction, status, severity (client-side severity filter for the prototype) |
| `/contradictions` | ✓ | Grouped by verdict-pair (US block→SG flag etc.) and full table |
| `/jurisdiction-config` | ✓ | Side-by-side: parsed rules + raw YAML |

## Pages deferred to Phase 2

- `/alerts/:id` — drawer or detail page with full SHAP attribution chart
- `/sar-scaffold/:alertId` — pre-filled structured fields for SAR/STR
- `/model-card` — rendered metadata.json
- `/audit-log` — append-only reviewer-action log
- `/typologies` — typology library
- Replay control panel — Play / Pause / speed / scrubber (currently the dashboard has a single "Replay all" button)

## Deploying to Cloudflare Pages

```bash
npm run build              # outputs to ./dist
# Then in the Cloudflare dashboard: connect this repo, set the build command
# to `npm run build`, build output dir to `web/dist`, and add an env var:
#   VITE_API_BASE = https://<your-worker>.workers.dev
```
