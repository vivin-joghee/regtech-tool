/**
 * /api/model-card — serves the bundled model-metadata.json verbatim.
 *
 * The metadata is the canonical artifact emitted by `pipeline/train_model.py`
 * for the deployed model. It includes:
 *   - SHA-256 (matches alerts.model_sha)
 *   - features used
 *   - performance metrics + auto-tuned decision threshold
 *   - recall by typology
 *   - jurisdictional validation (per-regime score distribution)
 *   - SHAP global importance baseline
 *   - hyperparameters
 *
 * The Phase A.2 architecture commits to having this as a structured page in
 * the UI, per Option A's "model card / governance documentation stub"
 * requirement.
 */

import { Hono } from "hono";

import metadataJson from "../../data/model-metadata.json";
import type { AppContext } from "../env";

export const modelRoute = new Hono<AppContext>();

modelRoute.get("/", (c) => c.json(metadataJson));
