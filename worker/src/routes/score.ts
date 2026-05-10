/**
 * /api/score
 *
 * Two flavours:
 *   POST /api/score                  — score an arbitrary payload (no persist)
 *   POST /api/score/:transactionId   — score an existing transaction in DB
 *
 * Neither writes alerts — see /api/transactions/:id/replay for the path
 * that scores AND persists. Separating these keeps "what would the
 * engine say?" callable independently for testing and demo purposes.
 */

import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { schema, getDb } from "../db/client";
import type { AppContext } from "../env";
import { getDecisionThreshold, getModelSha, getPrediction } from "../ml/predictions";
import { scoreTransaction } from "../rules/engine";
import type { TransactionContext } from "../rules/types";
import { jurisdictionSchema } from "../rules/types";

export const scoreRoute = new Hono<AppContext>();

/* -------------------------------------------------------------------------- */
/*  Score an existing transaction (preview only — does not persist)           */
/* -------------------------------------------------------------------------- */

scoreRoute.post("/:transactionId", async (c) => {
  const txnId = c.req.param("transactionId");
  const db = getDb(c.env.DATABASE_URL);

  const [txn] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, txnId))
    .limit(1);

  if (!txn) return c.json({ error: "Transaction not found" }, 404);

  // Hydrate originator + beneficiary PEP statuses
  const ids = [txn.originatorId, txn.beneficiaryId].filter(
    (x): x is string => x !== null,
  );
  const counterparties = ids.length
    ? await db
        .select()
        .from(schema.customers)
        .where(inArray(schema.customers.id, ids))
    : [];
  const byId = new Map(counterparties.map((c) => [c.id, c]));

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
  return c.json(result);
});

/* -------------------------------------------------------------------------- */
/*  Score an arbitrary payload (used by tests and for what-if analysis)       */
/* -------------------------------------------------------------------------- */

const adhocSchema = z.object({
  id: z.string().uuid().optional(),
  amount_native: z.number().nonnegative(),
  currency: z.enum(["USD", "SGD"]),
  amount_usd: z.number().nullable().optional(),
  amount_sgd: z.number().nullable().optional(),
  in_scope_jurisdictions: z.array(jurisdictionSchema).min(1),
  raw: z
    .object({
      ofac_sdn_match: z.boolean().optional(),
      mas_tfs_match: z.boolean().optional(),
    })
    .passthrough()
    .default({}),
  originator_pep_status: z
    .enum(["none", "foreign", "domestic", "international_org"])
    .nullable()
    .default(null),
  beneficiary_pep_status: z
    .enum(["none", "foreign", "domestic", "international_org"])
    .nullable()
    .default(null),
  channel: z.string().nullable().default(null),
  ml_score: z.number().min(0).max(1).optional(),
  ml_shap: z.record(z.string(), z.number()).optional(),
});

scoreRoute.post("/", zValidator("json", adhocSchema), async (c) => {
  const body = c.req.valid("json");

  const ctx: TransactionContext = {
    id: body.id ?? "adhoc-" + crypto.randomUUID(),
    amountNative: body.amount_native,
    currency: body.currency,
    amountUsd: body.amount_usd ?? null,
    amountSgd: body.amount_sgd ?? null,
    channel: body.channel ?? null,
    inScopeJurisdictions: body.in_scope_jurisdictions,
    raw: body.raw,
    originatorPepStatus: body.originator_pep_status,
    beneficiaryPepStatus: body.beneficiary_pep_status,
  };

  const ml = {
    score: body.ml_score ?? 0,
    shap: body.ml_shap ?? {},
    modelSha: getModelSha(),
    decisionThreshold: getDecisionThreshold(),
  };

  const result = await scoreTransaction(ctx, ml);
  return c.json(result);
});
