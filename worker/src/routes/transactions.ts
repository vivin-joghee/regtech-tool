/**
 * Transactions endpoints — listing + replay + per-id detail.
 *
 *   GET  /api/transactions                 — paginated list
 *   GET  /api/transactions/:id/detail      — full scored view + persisted alerts + contradiction + full SHAP
 *   POST /api/transactions/:id/replay      — re-score, persist alerts/contradictions
 *   POST /api/transactions/replay-all      — replay every transaction (demo helper)
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { schema, getDb } from "../db/client";
import type { AppContext } from "../env";
import { buildNarrative } from "../lib/narrative";
import { getDecisionThreshold, getModelSha, getPrediction } from "../ml/predictions";
import { scoreTransaction } from "../rules/engine";
import type { TransactionContext } from "../rules/types";

export const transactionsRoute = new Hono<AppContext>();

/* -------------------------------------------------------------------------- */
/*  GET /api/transactions                                                     */
/* -------------------------------------------------------------------------- */

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

transactionsRoute.get("/", zValidator("query", listQuery), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const db = getDb(c.env.DATABASE_URL);

  const rows = await db
    .select()
    .from(schema.transactions)
    .orderBy(desc(schema.transactions.occurredAt))
    .limit(limit)
    .offset(offset);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.transactions);

  return c.json({ limit, offset, total: count, items: rows });
});

/* -------------------------------------------------------------------------- */
/*  GET /api/transactions/:id/detail                                          */
/*  Full scored view: transaction + counterparties + alerts + contradiction   */
/*  + ML score + full SHAP attributions. Used by the alert drawer in the UI.  */
/* -------------------------------------------------------------------------- */

transactionsRoute.get("/:id/detail", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DATABASE_URL);

  const [txn] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, id))
    .limit(1);
  if (!txn) return c.json({ error: "Transaction not found" }, 404);

  const counterpartyIds = [txn.originatorId, txn.beneficiaryId].filter(
    (x): x is string => x !== null,
  );
  const counterparties = counterpartyIds.length
    ? await db
        .select()
        .from(schema.customers)
        .where(inArray(schema.customers.id, counterpartyIds))
    : [];
  const cMap = new Map(counterparties.map((c) => [c.id, c]));
  const originator = txn.originatorId ? cMap.get(txn.originatorId) ?? null : null;
  const beneficiary = txn.beneficiaryId ? cMap.get(txn.beneficiaryId) ?? null : null;

  // Re-run the engine for the structured rule-hit reasons
  const ctx: TransactionContext = {
    id: txn.id,
    amountNative: Number(txn.amountNative),
    currency: txn.currency.trim() as "USD" | "SGD",
    amountUsd: txn.amountUsd === null ? null : Number(txn.amountUsd),
    amountSgd: txn.amountSgd === null ? null : Number(txn.amountSgd),
    channel: txn.channel ?? null,
    inScopeJurisdictions: txn.inScopeJurisdictions,
    raw: txn.raw as TransactionContext["raw"],
    originatorPepStatus:
      (originator?.pepStatus as TransactionContext["originatorPepStatus"]) ?? null,
    beneficiaryPepStatus:
      (beneficiary?.pepStatus as TransactionContext["beneficiaryPepStatus"]) ?? null,
  };

  const cached = getPrediction(txn.id);
  const ml = {
    score: cached?.score ?? 0,
    shap: cached?.shap ?? {},
    modelSha: getModelSha(),
    decisionThreshold: getDecisionThreshold(),
  };

  const scoring = await scoreTransaction(ctx, ml);

  const persistedAlerts = await db
    .select()
    .from(schema.alerts)
    .where(eq(schema.alerts.transactionId, txn.id))
    .orderBy(desc(schema.alerts.severity));

  const [persistedContradiction] = await db
    .select()
    .from(schema.jurisdictionContradictions)
    .where(eq(schema.jurisdictionContradictions.transactionId, txn.id))
    .limit(1);

  const narrative = buildNarrative({
    transaction: txn,
    originator,
    beneficiary,
    scoring,
    mlThreshold: ml.decisionThreshold,
  });

  return c.json({
    transaction: txn,
    originator,
    beneficiary,
    scoring,
    persistedAlerts,
    persistedContradiction: persistedContradiction ?? null,
    shap: cached
      ? { score: cached.score, shap: cached.shap, modelSha: getModelSha() }
      : null,
    narrative,
  });
});

/* -------------------------------------------------------------------------- */
/*  POST /api/transactions/:id/replay  — score + persist                      */
/* -------------------------------------------------------------------------- */

interface ReplayPersistOptions {
  reviewer?: string;
}

async function replayAndPersist(
  db: ReturnType<typeof getDb>,
  transactionId: string,
  _opts: ReplayPersistOptions = {},
) {
  const [txn] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, transactionId))
    .limit(1);
  if (!txn) return null;

  const ids = [txn.originatorId, txn.beneficiaryId].filter(
    (x): x is string => x !== null,
  );
  const counterparties = ids.length
    ? await db
        .select()
        .from(schema.customers)
        .where(inArray(schema.customers.id, ids))
    : [];
  const byId = new Map(counterparties.map((cu) => [cu.id, cu]));

  const ctx: TransactionContext = {
    id: txn.id,
    amountNative: Number(txn.amountNative),
    currency: txn.currency.trim() as "USD" | "SGD",
    amountUsd: txn.amountUsd === null ? null : Number(txn.amountUsd),
    amountSgd: txn.amountSgd === null ? null : Number(txn.amountSgd),
    channel: txn.channel ?? null,
    inScopeJurisdictions: txn.inScopeJurisdictions,
    raw: txn.raw as TransactionContext["raw"],
    originatorPepStatus:
      (byId.get(txn.originatorId ?? "")?.pepStatus as
        | TransactionContext["originatorPepStatus"]
        | undefined) ?? null,
    beneficiaryPepStatus:
      (byId.get(txn.beneficiaryId ?? "")?.pepStatus as
        | TransactionContext["beneficiaryPepStatus"]
        | undefined) ?? null,
  };

  const cached = getPrediction(txn.id);
  const ml = {
    score: cached?.score ?? 0,
    shap: cached?.shap ?? {},
    modelSha: getModelSha(),
    decisionThreshold: getDecisionThreshold(),
  };

  const result = await scoreTransaction(ctx, ml);

  // Idempotency: clear any prior alerts and contradictions for this txn.
  await db.delete(schema.alerts).where(eq(schema.alerts.transactionId, txn.id));
  await db
    .delete(schema.jurisdictionContradictions)
    .where(eq(schema.jurisdictionContradictions.transactionId, txn.id));

  // Persist one alert per rule hit (rule_id is granular enough for the UI
  // to roll up by jurisdiction).
  const alertInserts: typeof schema.alerts.$inferInsert[] = [];
  for (const v of result.perJurisdiction) {
    for (const hit of v.hits) {
      alertInserts.push({
        transactionId: txn.id,
        jurisdiction: v.jurisdiction,
        ruleId: hit.ruleId,
        severity: hit.verdict === "block" ? 5 : hit.verdict === "flag" ? 3 : 1,
        mlScore: ml.score.toString(),
        shapAttribution: cached?.shap ?? {},
        rulePackSha: v.rulePackSha,
        modelSha: ml.modelSha,
        status: "new",
      });
    }
  }
  if (alertInserts.length) {
    await db.insert(schema.alerts).values(alertInserts);
  }

  if (result.contradiction) {
    await db.insert(schema.jurisdictionContradictions).values({
      transactionId: txn.id,
      usVerdict: result.contradiction.usVerdict,
      sgVerdict: result.contradiction.sgVerdict,
      resolution: "pending",
      rationale: "Auto-generated: US and SG rule packs produced different verdicts at scoring time.",
    });
  }

  return result;
}

transactionsRoute.post("/:id/replay", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DATABASE_URL);
  const result = await replayAndPersist(db, id);
  if (!result) return c.json({ error: "Transaction not found" }, 404);
  return c.json(result);
});

/* -------------------------------------------------------------------------- */
/*  POST /api/transactions/replay-all                                         */
/*  Walks every transaction in DB, scores it, and persists alerts. Used to    */
/*  populate the demo state in one go.                                        */
/* -------------------------------------------------------------------------- */

transactionsRoute.post("/replay-all", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const all = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions);

  let alertCount = 0;
  let contradictionCount = 0;
  let scored = 0;

  for (const { id } of all) {
    const result = await replayAndPersist(db, id);
    if (result) {
      scored += 1;
      alertCount += result.perJurisdiction.reduce((acc, v) => acc + v.hits.length, 0);
      if (result.contradiction) contradictionCount += 1;
    }
  }

  return c.json({
    scored,
    alerts_written: alertCount,
    contradictions_written: contradictionCount,
  });
});
