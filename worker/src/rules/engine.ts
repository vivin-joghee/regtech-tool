/**
 * Rule engine entry point — applies all rule families to a transaction
 * for every applicable jurisdiction, aggregates verdicts, and surfaces
 * cross-jurisdiction contradictions.
 *
 * The engine is intentionally pure: takes a TransactionContext + an
 * MlSignal, returns a ScoringResult. No DB I/O. Persistence happens at
 * a layer above (the route handler), so the engine is unit-testable.
 */

import { checkMlScore } from "./ml";
import { checkPep } from "./pep";
import { getRulePacks } from "./loader";
import { checkSanctions } from "./sanctions";
import { checkRiskBasedRules } from "./sg-specific";
import {
  checkCurrencyTransactionRule,
  checkSuspicionReportRule,
} from "./threshold";
import {
  type Jurisdiction,
  type JurisdictionVerdict,
  type MlSignal,
  type ScoringResult,
  type TransactionContext,
  mostRestrictive,
} from "./types";

export async function scoreTransaction(
  txn: TransactionContext,
  ml: MlSignal,
): Promise<ScoringResult> {
  const packs = await getRulePacks();
  const perJurisdiction: JurisdictionVerdict[] = [];

  for (const jur of txn.inScopeJurisdictions) {
    const { pack, sha } = packs[jur];

    // Suspicion-creating rules (sanctions, PEP, ML, risk-based rules) —
    // these establish whether suspicion exists, independent of any
    // reporting threshold. Risk-based rules embody MAS's principles-based
    // approach (block on EDD failures, TBML, layering, behavioural
    // anomalies); they currently exist only on the SG side.
    const suspicionHits = [
      ...checkSanctions(txn, pack),
      ...checkPep(txn, pack),
      ...checkMlScore(ml, pack),
      ...checkRiskBasedRules(txn, pack),
    ];

    // CTR is independent of suspicion — it fires on amount alone for cash.
    const ctrHits = checkCurrencyTransactionRule(txn, pack);

    // SAR/STR is a meta-rule: amount floor + suspicion present (per the
    // verified §1020.320(a)(2) two-part test). Must run AFTER the
    // suspicion-creating rules above, and must NOT include CTR hits as
    // suspicion signals.
    const susReportHits = checkSuspicionReportRule(txn, pack, suspicionHits);

    const hits = [...suspicionHits, ...ctrHits, ...susReportHits];

    perJurisdiction.push({
      jurisdiction: jur,
      verdict: mostRestrictive(hits.map((h) => h.verdict)),
      hits,
      rulePackSha: sha,
    });
  }

  // Contradiction detection: only meaningful when both regimes were in scope.
  let contradiction: ScoringResult["contradiction"] = null;
  if (perJurisdiction.length === 2) {
    const us = perJurisdiction.find((p) => p.jurisdiction === "US");
    const sg = perJurisdiction.find((p) => p.jurisdiction === "SG");
    if (us && sg && us.verdict !== sg.verdict) {
      contradiction = { usVerdict: us.verdict, sgVerdict: sg.verdict };
    }
  }

  return {
    transactionId: txn.id,
    perJurisdiction,
    contradiction,
    mlScore: ml.score,
    modelSha: ml.modelSha,
  };
}

export type { Jurisdiction, ScoringResult, TransactionContext, MlSignal };
