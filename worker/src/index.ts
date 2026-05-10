/**
 * Strait Compliance — Worker entry point.
 * Registers all /api/* routes under a single Hono app.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { AppContext } from "./env";
import { alertsRoute } from "./routes/alerts";
import { contradictionsRoute } from "./routes/contradictions";
import { healthRoute } from "./routes/health";
import { jurisdictionRoute } from "./routes/jurisdiction";
import { modelRoute } from "./routes/model";
import { scoreRoute } from "./routes/score";
import { transactionsRoute } from "./routes/transactions";

const app = new Hono<AppContext>();

// CORS open during development. Will tighten to the Pages origin in Phase A.2.
app.use("*", cors());
app.use("*", logger());

app.get("/", (c) =>
  c.json({
    service: "strait-compliance-worker",
    version: "0.1.0",
    docs: "see worker/README.md and Task3_Architecture.md §2.2",
  }),
);

app.route("/api/health", healthRoute);
app.route("/api/jurisdiction-config", jurisdictionRoute);
app.route("/api/score", scoreRoute);
app.route("/api/transactions", transactionsRoute);
app.route("/api/alerts", alertsRoute);
app.route("/api/contradictions", contradictionsRoute);
app.route("/api/model-card", modelRoute);

app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error("Worker error:", err);
  return c.json(
    { error: err.message ?? "Internal server error" },
    500,
  );
});

export default app;
