/**
 * ML score rule — applies the LightGBM scorer's output.
 *
 * Threshold resolution: if the YAML rule pack specifies `ml_score.threshold`
 * it wins (deliberate per-jurisdiction override). Otherwise we fall back to
 * the auto-tuned `decision_threshold` carried on the MlSignal — which the
 * route handler reads from the model card. This means re-training the model
 * automatically rolls a new threshold forward without any YAML edit.
 */

import type { MlSignal, RulePack, RuleHit } from "./types";

export function checkMlScore(
  ml: MlSignal,
  pack: RulePack,
): RuleHit[] {
  const threshold = pack.ml_score.threshold ?? ml.decisionThreshold;
  if (ml.score < threshold) return [];

  // Surface the top-3 contributing features (highest |SHAP|) for explainability.
  const sorted = Object.entries(ml.shap)
    .map(([f, v]) => [f, v] as const)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3);

  const source = pack.ml_score.threshold !== undefined ? "yaml_override" : "model_card";

  return [
    {
      ruleId: pack.ml_score.rule_id,
      verdict: pack.ml_score.triggers_verdict,
      reason: `ML score ${ml.score.toFixed(4)} >= threshold ${threshold.toFixed(4)}`,
      evidence: {
        score: ml.score,
        threshold,
        threshold_source: source,
        model_sha: ml.modelSha,
        top_features: Object.fromEntries(sorted),
      },
    },
  ];
}
