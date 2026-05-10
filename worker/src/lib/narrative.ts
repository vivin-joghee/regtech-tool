/**
 * Natural-language explainer for the alert detail drawer.
 *
 * Consumes a fully-resolved scoring result + transaction + counterparties
 * and produces a multi-paragraph plain-English explanation following the
 * structure:
 *
 *   1. What the transaction is (parties, amount, channel, currency)
 *   2. Why each regime is in scope (or not)
 *   3. What rules fired in each regime, with citations
 *   4. The contradiction (if any) and what it represents architecturally
 *   5. Closing architectural insight (verbose only)
 *
 * No external NLP dependency — the rule structure already carries the
 * semantic information; we just compose it into prose.
 */

import type { Customer, Transaction } from "../db/schema";
import type {
  Jurisdiction,
  JurisdictionVerdict,
  ScoringResult,
  Verdict,
} from "../rules/types";

type RuleHit = JurisdictionVerdict["hits"][number];

interface NarrativeInput {
  transaction: Transaction;
  originator: Customer | null;
  beneficiary: Customer | null;
  scoring: ScoringResult;
  /** Auto-tuned decision threshold from the model card. */
  mlThreshold: number;
}

interface NarrativeOutput {
  /** Short one-line lede (≤ 200 chars). */
  headline: string;
  /** Multi-paragraph plain-English explanation. */
  paragraphs: string[];
  /** Plain-English contradiction explanation, or null if none. */
  contradiction_explanation: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function fmtMoney(amount: string | number | null, currency: string): string {
  if (amount === null) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  return `${currency} ${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function describeParty(c: Customer | null): string {
  if (!c) return "an unknown counterparty";
  const type = c.customerType.replace("_", " ");
  const dom = c.domicileCountry ?? "??";
  let pep = "";
  if (c.pepStatus === "foreign") pep = ", a foreign PEP";
  else if (c.pepStatus === "domestic") pep = ", a domestic PEP";
  else if (c.pepStatus === "international_org") pep = ", an international-organisation PEP";
  if (c.beneficialOwner) {
    pep = `, a ${c.customerType} beneficially owned by ${c.beneficialOwner}`;
    return `${c.legalName} (${dom}, ${type}${pep})`;
  }
  return `${c.legalName} (${dom}, ${type}${pep})`;
}

function describeChannel(channel: string | null, _currency: string, withArticle = true): string {
  const article = withArticle ? "a " : "";
  if (!channel) return `${article}transfer`;
  switch (channel) {
    case "CASH_USD":
    case "CASH_SGD":
      return `${article}cash deposit at a bank teller`;
    case "SWIFT":
      return `${article}SWIFT wire`;
    case "FAST":
      return `${article}Singapore FAST transfer`;
    case "GIRO":
      return `${article}Singapore GIRO transfer`;
    case "ACH":
      return `${article}US ACH transfer`;
    case "FEDWIRE":
      return `${article}Fedwire transfer`;
    case "CHIPS":
      return `${article}wire via CHIPS`;
    default:
      return `${article}${channel} transfer`;
  }
}

function explainScope(
  inScope: Jurisdiction[],
  channel: string | null,
  currency: string,
  origDom: string | null,
  beneDom: string | null,
): string {
  const usIn = inScope.includes("US");
  const sgIn = inScope.includes("SG");
  const reasons: string[] = [];

  if (usIn && sgIn) {
    if (origDom === "SG" || beneDom === "SG") {
      reasons.push("Singapore is in scope because at least one party is SG-domiciled");
    }
    if (channel === "CASH_USD" || origDom === "US" || beneDom === "US") {
      reasons.push("the United States is in scope because of US-side party domicile or US-bank cash channel");
    }
    if (
      currency === "USD" &&
      (channel === "SWIFT" || channel === "CHIPS" || channel === "FEDWIRE") &&
      origDom !== "US" &&
      beneDom !== "US"
    ) {
      reasons.push("the United States is in scope because USD via SWIFT cross-border clears through NY (the OFAC extraterritoriality lever)");
    }
    return `Both regimes are in scope: ${reasons.join("; ")}.`;
  }
  if (usIn) return "Only the United States is in scope.";
  if (sgIn) return "Only Singapore is in scope.";
  return "Neither regime is in scope (this should not happen for valid data).";
}

function describeHit(hit: RuleHit): string {
  // Look up citation in evidence if present
  const citation = (hit.evidence?.citation as string | undefined) ?? null;
  const cited = citation ? ` (${citation})` : "";
  return `${hit.ruleId}${cited} — ${hit.reason}`;
}

function explainJurisdiction(
  jurName: string,
  v: JurisdictionVerdict | undefined,
): string {
  if (!v) {
    return `${jurName} side is not in scope, so no rules apply.`;
  }
  if (v.hits.length === 0) {
    return `${jurName} side: verdict is ${v.verdict}; no rules fired.`;
  }
  const verdictWord =
    v.verdict === "block" ? "blocked" : v.verdict === "flag" ? "flagged" : "allowed";
  const ruleList = v.hits.map((h) => `\n  - ${describeHit(h)}`).join("");
  return `${jurName} side: ${verdictWord} (${v.verdict}). Rules fired:${ruleList}`;
}

function explainContradiction(
  contra: ScoringResult["contradiction"],
  perJur: JurisdictionVerdict[],
): string | null {
  if (!contra) return null;

  const us = perJur.find((p) => p.jurisdiction === "US");
  const sg = perJur.find((p) => p.jurisdiction === "SG");
  const usVerdict = contra.usVerdict;
  const sgVerdict = contra.sgVerdict;

  // Identify the architectural pattern this contradiction represents
  let pattern = "the two regimes reached different verdicts";

  const usHits = us?.hits ?? [];
  const sgHits = sg?.hits ?? [];
  const usHasOfac = usHits.some((h) => h.ruleId.includes("OFAC"));
  const sgHasMas = sgHits.some((h) => h.ruleId.includes("MAS_TFS"));
  const usHasCtr = usHits.some((h) => h.ruleId.includes("CTR"));
  const sgHasRbr = sgHits.some((h) => h.ruleId.includes(".RBR."));

  if (sgHasRbr && sgVerdict === "block" && (usVerdict === "allow" || usVerdict === "flag")) {
    pattern =
      "Singapore's risk-based supervisory approach blocks (one or more SG.RBR rules fired) while the US's threshold-based regime did not escalate to block — MAS's principles-based stance vs the US's rule-based stance";
  } else if (usHasOfac && !sgHasMas && usVerdict === "block") {
    pattern =
      "the counterparty is on OFAC SDN but not on MAS-TFS — the canonical sanctions list divergence";
  } else if (usHasCtr && (sgHits.length ?? 0) === 0 && usVerdict === "flag") {
    pattern =
      "US has a $10K CTR floor for cash transactions (31 CFR §1010.311); Singapore has no general bank cash threshold — the threshold-vs-suspicion regime divergence";
  }

  return `Contradiction: US verdict is ${usVerdict}, Singapore verdict is ${sgVerdict}. This happens because ${pattern}. The system does not silently pick a side — resolution is human work.`;
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

export function buildNarrative(input: NarrativeInput): NarrativeOutput {
  const t = input.transaction;
  const o = input.originator;
  const b = input.beneficiary;
  const sc = input.scoring;
  const usV = sc.perJurisdiction.find((p) => p.jurisdiction === "US");
  const sgV = sc.perJurisdiction.find((p) => p.jurisdiction === "SG");

  const amountStr = fmtMoney(t.amountNative, t.currency);
  const channelDescrArticle = describeChannel(t.channel, t.currency, true);
  const channelDescrNoArticle = describeChannel(t.channel, t.currency, false);
  const origDescr = describeParty(o);
  const beneDescr = describeParty(b);

  // Headline — no article so it reads as a noun phrase
  const headline = `${amountStr} ${channelDescrNoArticle} from ${o?.legalName ?? "—"} to ${b?.legalName ?? "—"}`;

  const paragraphs: string[] = [];

  // Paragraph 1 — what is this transaction
  paragraphs.push(
    `This is ${amountStr} via ${channelDescrArticle}, from ${origDescr} to ${beneDescr}. The corridor is ${t.corridor ?? "—"}.`,
  );

  // Paragraph 2 — scope
  paragraphs.push(
    explainScope(
      t.inScopeJurisdictions,
      t.channel,
      t.currency,
      o?.domicileCountry ?? null,
      b?.domicileCountry ?? null,
    ),
  );

  // Paragraph 3 — what fired in each regime
  paragraphs.push(explainJurisdiction("United States", usV));
  paragraphs.push(explainJurisdiction("Singapore", sgV));

  // Paragraph 4 — contradiction (if any)
  const contraExplanation = explainContradiction(sc.contradiction, sc.perJurisdiction);
  if (contraExplanation) paragraphs.push(contraExplanation);

  // Paragraph 5 — ML if applicable
  if (sc.mlScore > 0) {
    const thr = input.mlThreshold;
    paragraphs.push(
      `The ML model scored this transaction at ${sc.mlScore.toFixed(4)}. ` +
        (sc.mlScore >= thr
          ? `That is at or above the ${thr.toFixed(4)} decision threshold, so the ML rule fires on each side where the regime is in scope.`
          : `That is below the ${thr.toFixed(4)} decision threshold, so the ML rule did not fire.`),
    );
  }

  return {
    headline,
    paragraphs,
    contradiction_explanation: contraExplanation,
  };
}
