/**
 * /api/alerts — listing only in Phase A.1. Detail endpoint with full
 * SHAP visualisation data is deferred to Phase A.2 alongside the
 * frontend.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { schema, getDb } from "../db/client";
import type { AppContext } from "../env";
import { jurisdictionSchema } from "../rules/types";

export const alertsRoute = new Hono<AppContext>();

const listQuery = z.object({
  jurisdiction: jurisdictionSchema.optional(),
  status: z
    .enum(["new", "in_review", "escalated", "dismissed", "filed"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

alertsRoute.get("/", zValidator("query", listQuery), async (c) => {
  const { jurisdiction, status, limit, offset } = c.req.valid("query");
  const db = getDb(c.env.DATABASE_URL);

  const filters = [
    jurisdiction ? eq(schema.alerts.jurisdiction, jurisdiction) : undefined,
    status ? eq(schema.alerts.status, status) : undefined,
  ].filter((x): x is NonNullable<typeof x> => x !== undefined);

  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select()
    .from(schema.alerts)
    .where(where)
    .orderBy(desc(schema.alerts.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.alerts)
    .where(where);

  return c.json({ limit, offset, total: count, items: rows });
});
