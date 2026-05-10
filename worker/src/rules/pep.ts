/**
 * PEP screening — encodes the asymmetry between US and Singapore PEP scope.
 *
 *   - US (foreign_only): triggers only when a counterparty is a foreign PEP
 *   - SG (foreign_and_domestic): triggers on foreign, domestic, or
 *     international-organisation PEPs
 *
 * This is the divergence that makes the SG-domestic-PEP transactions in
 * the synthetic dataset surface in SG alerts but NOT in US alerts.
 */

import type { RulePack, RuleHit, TransactionContext } from "./types";

type PepStatus = "none" | "foreign" | "domestic" | "international_org" | null;

function isInScope(status: PepStatus, scope: "foreign_only" | "foreign_and_domestic"): boolean {
  if (status === null || status === "none") return false;
  if (scope === "foreign_only") return status === "foreign";
  // foreign_and_domestic — anything that isn't 'none'
  return status === "foreign" || status === "domestic" || status === "international_org";
}

export function checkPep(
  txn: TransactionContext,
  pack: RulePack,
): RuleHit[] {
  const cfg = pack.pep;
  const origHit = isInScope(txn.originatorPepStatus, cfg.scope);
  const beneHit = isInScope(txn.beneficiaryPepStatus, cfg.scope);

  if (!origHit && !beneHit) return [];

  return [
    {
      ruleId: cfg.rule_id,
      verdict: cfg.triggers_verdict,
      reason: `PEP screening: counterparty in scope (${cfg.scope}, ${
        origHit ? "originator" : "beneficiary"
      } = ${origHit ? txn.originatorPepStatus : txn.beneficiaryPepStatus})`,
      evidence: {
        scope: cfg.scope,
        originator_pep: txn.originatorPepStatus,
        beneficiary_pep: txn.beneficiaryPepStatus,
        citation: cfg.citation,
      },
    },
  ];
}
