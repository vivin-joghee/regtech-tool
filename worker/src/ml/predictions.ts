/**
 * Predictions cache loader.
 *
 * The cache is the pre-computed score + SHAP attribution for every
 * transaction in the synthetic dataset. It's bundled with the worker
 * for the prototype; in production it would live in R2 and be fetched
 * on cold start (see Task3_Architecture.md §6, "edge inference vs
 * pre-scored fallback").
 *
 * Refresh by re-running `python pipeline/train_model.py` and copying
 * the new file to worker/data/predictions.json.
 */

import predictionsJson from "../../data/predictions.json";
import metadataJson from "../../data/model-metadata.json";

interface PredictionEntry {
  score: number;
  shap: Record<string, number>;
}

interface PredictionsCache {
  schema_version: number;
  model_sha256: string;
  computed_at: string;
  feature_names: string[];
  base_value: number;
  shap_method: string;
  predictions: Record<string, PredictionEntry>;
}

interface ModelMetadata {
  model_sha256: string;
  metrics: { decision_threshold: number };
}

const cache = predictionsJson as unknown as PredictionsCache;
const metadata = metadataJson as unknown as ModelMetadata;

export function getModelSha(): string {
  return cache.model_sha256;
}

export function getPrediction(transactionId: string): PredictionEntry | null {
  return cache.predictions[transactionId] ?? null;
}

/**
 * Auto-tuned decision threshold from the model card. Source of truth for
 * the ML rule's firing threshold unless a rule pack overrides it explicitly.
 */
export function getDecisionThreshold(): number {
  return metadata.metrics.decision_threshold;
}

export function getCacheMeta() {
  return {
    schema_version: cache.schema_version,
    model_sha256: cache.model_sha256,
    computed_at: cache.computed_at,
    shap_method: cache.shap_method,
    feature_count: cache.feature_names.length,
    transaction_count: Object.keys(cache.predictions).length,
    base_value: cache.base_value,
  };
}
