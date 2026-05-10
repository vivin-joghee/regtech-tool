/**
 * Singapore-specific risk-based rules.
 *
 * Encodes MAS's principles-based, risk-driven supervisory approach where a
 * bank declines transactions on EDD failures, behavioural anomalies, TBML
 * inconsistencies, etc. — outcomes that the US threshold-driven regime
 * typically only flags rather than blocks.
 *
 * Implementation: each rule reads a flag from `transactions.raw.sg_signals`
 * (set by the upstream KYC/transaction monitoring stack) and emits a `block`
 * verdict when the flag is true.
 *
 * The 8 rules implement the scenarios in worker/config/sg.yaml's
 * `risk_based_rules` block — see that file for citations.
 */

import type { RulePack, RuleHit, TransactionContext } from "./types";

interface SgSignals {
  pep_high_risk_destination?: boolean;
  tbml_inconsistent?: boolean;
  complex_layering?: boolean;
  behavioral_deviation_strong?: boolean;
  pep_intermediary_layering?: boolean;
  missing_documentation?: boolean;
  repeated_pattern_below_threshold?: boolean;
  new_customer_large_transfer?: boolean;
  [k: string]: unknown;
}

export function checkRiskBasedRules(
  txn: TransactionContext,
  pack: RulePack,
): RuleHit[] {
  const rbr = pack.risk_based_rules;
  if (!rbr) return [];

  const signals = (txn.raw?.sg_signals as SgSignals | undefined) ?? {};

  const hits: RuleHit[] = [];
  for (const [, config] of Object.entries(rbr)) {
    const flagValue = signals[config.flag_in_raw];
    if (Boolean(flagValue)) {
      hits.push({
        ruleId: config.rule_id,
        verdict: config.triggers_verdict,
        reason: config.description ?? `Risk-based signal: ${config.flag_in_raw}`,
        evidence: {
          flag: config.flag_in_raw,
          citation: config.citation,
        },
      });
    }
  }
  return hits;
}
