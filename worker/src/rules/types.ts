/**
 * Rule pack types — these mirror the YAML in worker/config/{us,sg}.yaml.
 * Keep in sync with that file structure; loader.ts validates with Zod.
 */

import { z } from "zod";

export const verdictSchema = z.enum(["block", "flag", "allow"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const jurisdictionSchema = z.enum(["US", "SG"]);
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;

const ruleConfigBase = z.object({
  triggers_verdict: verdictSchema,
  rule_id: z.string(),
  citation: z.string().optional(),
});

export const sanctionsConfigSchema = z.object({
  primary_list: z.string(),
  also_apply: z.array(z.string()).optional(),
  triggers_verdict: verdictSchema,
});

export const thresholdConfigSchema = ruleConfigBase.extend({
  threshold_native: z.number().nullable(),
  native_currency: z.enum(["USD", "SGD"]),
});

export const pepConfigSchema = ruleConfigBase.extend({
  scope: z.enum(["foreign_only", "foreign_and_domestic"]),
});

export const mlConfigSchema = z.object({
  // Optional — when omitted (the default), the engine uses the auto-tuned
  // `decision_threshold` from the model card so a re-trained model
  // automatically rolls forward without a YAML edit. Specify a value here
  // only as a deliberate per-jurisdiction override.
  threshold: z.number().optional(),
  triggers_verdict: verdictSchema,
  rule_id: z.string(),
});

/**
 * Risk-based rule — fires `block` (or whatever verdict configured) when a
 * specific flag is set in `transactions.raw.sg_signals` (or the equivalent
 * jurisdiction-specific signals object). Models MAS's principles-based,
 * risk-based supervisory approach where banks decline transactions on EDD
 * failures, behavioural anomalies, or TBML inconsistencies — outcomes that
 * the US's threshold-driven regime typically only flags rather than blocks.
 *
 * Each rule cites either MAS Notice 626 (general) or a FATF Recommendation.
 */
export const riskBasedRuleSchema = z.object({
  triggers_verdict: verdictSchema,
  rule_id: z.string(),
  flag_in_raw: z.string(),
  description: z.string().optional(),
  citation: z.string().optional(),
});

export const rulePackSchema = z.object({
  jurisdiction: jurisdictionSchema,
  schema_version: z.number(),
  human_label: z.string(),
  authority: z.string(),
  prudential_examiners: z.array(z.string()),
  statute: z.array(z.string()),
  sanctions: sanctionsConfigSchema,
  // currency_transaction is OPTIONAL. The US has a CTR rule under 31 CFR
  // §1010.311 (cash transactions > $10,000). Singapore has no general bank
  // CTR — bank cash reporting is purely suspicion-based via STR
  // (CDSA s.45). The S$20,000 figure circulated in earlier drafts is from
  // the PSPM Act 2019 for precious-metals dealers, not banks.
  // See worker/RULES_VERIFICATION.md for sources.
  currency_transaction: thresholdConfigSchema.optional(),
  // Two flavours of suspicion-report config; only one of these will be set
  // per jurisdiction (US uses suspicious_activity, SG uses suspicious_transaction).
  suspicious_activity: thresholdConfigSchema.optional(),
  suspicious_transaction: thresholdConfigSchema.optional(),
  pep: pepConfigSchema,
  ml_score: mlConfigSchema,
  // Optional risk-based rules — currently used by Singapore to encode the
  // MAS principles-based supervisory approach (PEP EDD, TBML, layering,
  // behavioural deviation, EDD-on-onboarding). These produce Type C
  // contradictions (SG block / US flag).
  risk_based_rules: z.record(z.string(), riskBasedRuleSchema).optional(),
  ai_governance: z.record(z.string(), z.unknown()).optional(),
  direction_of_travel_2026: z.string().optional(),
});

export type RulePack = z.infer<typeof rulePackSchema>;

/* -------------------------------------------------------------------------- */
/*  Inputs and outputs to the rule engine                                     */
/* -------------------------------------------------------------------------- */

/**
 * The minimum projection of a transaction the engine needs. We don't pass
 * the full Drizzle row because the engine should be testable in isolation
 * with a synthetic input.
 */
export interface TransactionContext {
  id: string;
  amountNative: number;
  currency: "USD" | "SGD";
  amountUsd: number | null;
  amountSgd: number | null;
  channel: string | null;
  inScopeJurisdictions: Jurisdiction[];
  raw: {
    ofac_sdn_match?: boolean;
    mas_tfs_match?: boolean;
    [k: string]: unknown;
  };
  originatorPepStatus: "none" | "foreign" | "domestic" | "international_org" | null;
  beneficiaryPepStatus: "none" | "foreign" | "domestic" | "international_org" | null;
}

/** Channel constants used by the CTR rule to gate on cash. */
export const CASH_CHANNELS = ["CASH_USD", "CASH_SGD"] as const;
export function isCashChannel(channel: string | null): boolean {
  if (channel === null) return false;
  return (CASH_CHANNELS as readonly string[]).includes(channel);
}

export interface MlSignal {
  score: number;
  shap: Record<string, number>;
  modelSha: string;
  /** Auto-tuned decision threshold from the model card. */
  decisionThreshold: number;
}

export interface RuleHit {
  ruleId: string;
  verdict: Verdict;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface JurisdictionVerdict {
  jurisdiction: Jurisdiction;
  verdict: Verdict;          // most restrictive of the rule hits, or 'allow'
  hits: RuleHit[];
  rulePackSha: string;       // git SHA of the rule pack at scoring time
}

export interface ScoringResult {
  transactionId: string;
  perJurisdiction: JurisdictionVerdict[];
  contradiction: null | {
    usVerdict: Verdict;
    sgVerdict: Verdict;
  };
  mlScore: number;
  modelSha: string;
}

/* -------------------------------------------------------------------------- */
/*  Verdict ordering — used to compute "most restrictive"                     */
/* -------------------------------------------------------------------------- */

const VERDICT_RANK: Record<Verdict, number> = {
  allow: 0,
  flag: 1,
  block: 2,
};

export function mostRestrictive(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return "allow";
  return verdicts.reduce<Verdict>(
    (acc, v) => (VERDICT_RANK[v] > VERDICT_RANK[acc] ? v : acc),
    "allow",
  );
}
