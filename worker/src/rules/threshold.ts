/**
 * Threshold rules.
 *
 * Two distinct rule families live here:
 *   1. CTR — Currency Transaction Report. Fires on AMOUNT ALONE if the
 *      transaction is in cash and exceeds the jurisdiction's threshold.
 *      Verified per 31 CFR §1010.311 (US, "more than $10,000" in currency).
 *
 *   2. SAR/STR — Suspicious Activity/Transaction Report. This is a
 *      META-RULE. It requires BOTH:
 *        - amount ≥ jurisdiction floor (US has $5K; SG has none), AND
 *        - some other rule has already produced a suspicion hit.
 *      Verified per 31 CFR §1020.320(a)(2): "involves or aggregates at
 *      least $5,000 in funds or other assets, AND the financial
 *      institution knows, suspects, or has reason to suspect that..."
 *
 * Because SAR/STR depends on other rules' output, it must run AFTER the
 * other rules — see the orchestration in engine.ts. CTR runs independently.
 */

import { isCashChannel } from "./types";
import type { RulePack, RuleHit, TransactionContext } from "./types";

function nativeAmountFor(
  txn: TransactionContext,
  nativeCurrency: "USD" | "SGD",
): number | null {
  if (nativeCurrency === "USD") return txn.amountUsd;
  if (nativeCurrency === "SGD") return txn.amountSgd;
  return null;
}

/**
 * Currency Transaction Report — fires on amount alone but ONLY when the
 * transaction is in cash. 31 CFR §1010.311 limits CTR to "transaction in
 * currency" — wires, ACH, and other electronic transfers are out of scope.
 *
 * Only US has a CTR rule in our current pack (Singapore intentionally
 * omits it — banks have no general bank CTR threshold — see sg.yaml note).
 */
export function checkCurrencyTransactionRule(
  txn: TransactionContext,
  pack: RulePack,
): RuleHit[] {
  const ctr = pack.currency_transaction;
  if (!ctr) return [];

  // Verified per §1010.311: applies to currency only.
  if (!isCashChannel(txn.channel)) return [];

  const ctrAmount = nativeAmountFor(txn, ctr.native_currency);
  if (
    ctr.threshold_native === null ||
    ctrAmount === null ||
    ctrAmount < ctr.threshold_native
  ) {
    return [];
  }

  return [
    {
      ruleId: ctr.rule_id,
      verdict: ctr.triggers_verdict,
      reason: `Amount ${ctrAmount.toFixed(2)} ${ctr.native_currency} >= CTR threshold ${ctr.threshold_native}`,
      evidence: {
        amount_native: ctrAmount,
        threshold: ctr.threshold_native,
        currency: ctr.native_currency,
        citation: ctr.citation,
      },
    },
  ];
}

/**
 * Suspicious Activity / Suspicious Transaction Report.
 *
 * Meta-rule: only fires when another rule has already established
 * suspicion AND (for jurisdictions with a floor) the amount meets it.
 *
 * Caller MUST pass the existing suspicion-creating hits (sanctions, PEP,
 * ML). CTR hits are NOT suspicion signals — they are reporting
 * obligations independent of suspicion — and must not be passed in.
 */
export function checkSuspicionReportRule(
  txn: TransactionContext,
  pack: RulePack,
  suspicionHits: RuleHit[],
): RuleHit[] {
  const sus = pack.suspicious_activity ?? pack.suspicious_transaction;
  if (!sus) return [];

  // No suspicion-creating rule fired → no SAR/STR.
  if (suspicionHits.length === 0) return [];

  // If the jurisdiction has a monetary floor (US: $5K), enforce it.
  if (sus.threshold_native !== null) {
    const susAmount = nativeAmountFor(txn, sus.native_currency);
    if (susAmount === null || susAmount < sus.threshold_native) return [];
  }

  return [
    {
      ruleId: sus.rule_id,
      verdict: sus.triggers_verdict,
      reason: `SAR/STR triggered: ${suspicionHits.length} suspicion signal(s) present${
        sus.threshold_native !== null
          ? ` AND amount >= ${sus.threshold_native} ${sus.native_currency}`
          : " (no monetary floor)"
      }`,
      evidence: {
        threshold: sus.threshold_native,
        suspicion_rule_ids: suspicionHits.map((h) => h.ruleId),
        citation: sus.citation,
      },
    },
  ];
}
