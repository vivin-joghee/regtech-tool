/**
 * Drizzle schema — mirrors the Neon DDL applied in
 * Task3_Architecture.md §4.5. Keep this file in sync with the database
 * by running `npm run db:generate` and reviewing the generated migration
 * before committing.
 */

import {
  bigserial,
  char,
  customType,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const jurisdictionCode = pgEnum("jurisdiction_code", ["US", "SG"]);
export const verdictEnum = pgEnum("verdict", ["block", "flag", "allow"]);
export const alertStatusEnum = pgEnum("alert_status", [
  "new",
  "in_review",
  "escalated",
  "dismissed",
  "filed",
]);

// Drizzle's `pg-core` does not yet have first-class array-of-enum support,
// so we declare it via a customType. The DB column is `jurisdiction_code[]`.
// The Neon HTTP driver returns Postgres array literals as raw strings (e.g.
// "{US,SG}"), so we round-trip via the from/toDriver hooks.
const jurisdictionCodeArray = customType<{
  data: ("US" | "SG")[];
  driverData: string;
}>({
  dataType() {
    return "jurisdiction_code[]";
  },
  fromDriver(value): ("US" | "SG")[] {
    if (Array.isArray(value)) return value as ("US" | "SG")[];
    if (typeof value !== "string") return [];
    const trimmed = value.replace(/^\{|\}$/g, "");
    if (trimmed === "") return [];
    return trimmed.split(",").map((s) => s.trim()) as ("US" | "SG")[];
  },
  toDriver(value: ("US" | "SG")[]): string {
    return `{${value.join(",")}}`;
  },
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  customerType: text("customer_type").notNull(),
  domicileCountry: char("domicile_country", { length: 2 }),
  beneficialOwner: text("beneficial_owner"),
  pepStatus: text("pep_status"),
  riskRating: smallint("risk_rating"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    originatorId: uuid("originator_id").references(() => customers.id),
    beneficiaryId: uuid("beneficiary_id").references(() => customers.id),
    amountNative: numeric("amount_native", { precision: 20, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 20, scale: 2 }),
    amountSgd: numeric("amount_sgd", { precision: 20, scale: 2 }),
    corridor: text("corridor"),
    channel: text("channel"),
    inScopeJurisdictions: jurisdictionCodeArray("in_scope_jurisdictions").notNull(),
    raw: jsonb("raw").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_tx_corridor").on(t.corridor),
    index("idx_tx_occurred").on(t.occurredAt),
    index("idx_tx_orig").on(t.originatorId),
    index("idx_tx_bene").on(t.beneficiaryId),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    jurisdiction: jurisdictionCode("jurisdiction").notNull(),
    ruleId: text("rule_id").notNull(),
    severity: smallint("severity"),
    mlScore: numeric("ml_score", { precision: 6, scale: 4 }),
    shapAttribution: jsonb("shap_attribution"),
    rulePackSha: text("rule_pack_sha").notNull(),
    modelSha: text("model_sha").notNull(),
    status: alertStatusEnum("status").notNull().default("new"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_alert_jur").on(t.jurisdiction),
    index("idx_alert_status").on(t.status),
    index("idx_alert_tx").on(t.transactionId),
  ],
);

export const jurisdictionContradictions = pgTable("jurisdiction_contradictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  usVerdict: verdictEnum("us_verdict").notNull(),
  sgVerdict: verdictEnum("sg_verdict").notNull(),
  resolution: text("resolution").notNull().default("pending"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  details: jsonb("details"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const modelVersions = pgTable("model_versions", {
  sha256: text("sha256").primaryKey(),
  modelType: text("model_type").notNull(),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull(),
  features: jsonb("features").notNull(),
  metrics: jsonb("metrics").notNull(),
  shapBaseline: jsonb("shap_baseline"),
  jurisdictionValidation: jsonb("jurisdiction_validation"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});

// Inferred types for use elsewhere in the worker.
export type Customer = typeof customers.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type NewContradiction = typeof jurisdictionContradictions.$inferInsert;
export type NewAuditEntry = typeof auditLog.$inferInsert;
