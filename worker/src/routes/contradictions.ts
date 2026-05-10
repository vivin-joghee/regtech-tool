/**
 * /api/contradictions — the substantive embodiment of Task 2 §4(d)
 * failure shape C. Surfaces every transaction where US and SG rule
 * packs produced different verdicts at scoring time.
 */

import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { schema, getDb } from "../db/client";
import type { AppContext } from "../env";

export const contradictionsRoute = new Hono<AppContext>();

const listQuery = z.object({
  status: z.enum(["pending", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

contradictionsRoute.get("/", zValidator("query", listQuery), async (c) => {
  const { status, limit, offset } = c.req.valid("query");
  const db = getDb(c.env.DATABASE_URL);

  const where =
    status === "pending"
      ? eq(schema.jurisdictionContradictions.resolution, "pending")
      : status === "resolved"
        ? sql`${schema.jurisdictionContradictions.resolution} != 'pending'`
        : undefined;

  const rows = await db
    .select({
      contradiction: schema.jurisdictionContradictions,
      transaction: schema.transactions,
    })
    .from(schema.jurisdictionContradictions)
    .leftJoin(
      schema.transactions,
      eq(schema.jurisdictionContradictions.transactionId, schema.transactions.id),
    )
    .where(where)
    .orderBy(desc(schema.jurisdictionContradictions.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.jurisdictionContradictions)
    .where(where);

  return c.json({ limit, offset, total: count, items: rows });
});
