/**
 * Sanctions rules — screen the transaction's counterparties against the
 * active jurisdiction's sanctions list.
 *
 * In the prototype we read the match flags from `transactions.raw` JSONB
 * (set by the synthetic generator). In production this would query a live
 * sanctions feed (OFAC SDN, MAS TFS, UN-SC) cached in KV.
 *
 * The primary divergence this rule encodes:
 *   - US sanctions block whenever OFAC SDN match is true
 *   - SG sanctions block whenever MAS TFS match is true
 *   - A counterparty on OFAC but NOT on MAS TFS produces a contradiction
 */

import type { RulePack, RuleHit, TransactionContext } from "./types";

function matchesPrimaryList(
  raw: TransactionContext["raw"],
  list: string,
): boolean {
  if (list === "OFAC_SDN") return Boolean(raw.ofac_sdn_match);
  if (list === "MAS_TFS") return Boolean(raw.mas_tfs_match);
  // UN_SC and other lists not modeled in synthetic data — treated as no-match.
  return false;
}

export function checkSanctions(
  txn: TransactionContext,
  pack: RulePack,
): RuleHit[] {
  const hits: RuleHit[] = [];
  const cfg = pack.sanctions;

  if (matchesPrimaryList(txn.raw, cfg.primary_list)) {
    hits.push({
      ruleId: `${pack.jurisdiction}.SANCTIONS.${cfg.primary_list}`,
      verdict: cfg.triggers_verdict,
      reason: `Counterparty matches ${cfg.primary_list} sanctions list`,
      evidence: {
        list: cfg.primary_list,
        ofac_sdn_match: Boolean(txn.raw.ofac_sdn_match),
        mas_tfs_match: Boolean(txn.raw.mas_tfs_match),
      },
    });
  }

  for (const extra of cfg.also_apply ?? []) {
    if (matchesPrimaryList(txn.raw, extra)) {
      hits.push({
        ruleId: `${pack.jurisdiction}.SANCTIONS.${extra}`,
        verdict: cfg.triggers_verdict,
        reason: `Counterparty matches ${extra} sanctions list (also-apply)`,
        evidence: { list: extra },
      });
    }
  }

  return hits;
}
