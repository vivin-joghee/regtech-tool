/**
 * Neon HTTP driver bound to Drizzle. The HTTP transport is what makes
 * this work in Cloudflare Workers — Workers don't open raw TCP sockets,
 * so the classic libpq-based pg client would fail. Neon's serverless
 * driver speaks HTTP for one-shot queries and WebSocket for transactions.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: { url: string; db: Database } | null = null;

export function getDb(databaseUrl: string): Database {
  if (cached && cached.url === databaseUrl) return cached.db;
  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });
  cached = { url: databaseUrl, db };
  return db;
}

export { schema };
