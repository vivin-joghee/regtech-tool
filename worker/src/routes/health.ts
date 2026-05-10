import { Hono } from "hono";

import type { AppContext } from "../env";
import { getCacheMeta } from "../ml/predictions";
import { getRulePacks } from "../rules/loader";

export const healthRoute = new Hono<AppContext>();

healthRoute.get("/", async (c) => {
  const packs = await getRulePacks();
  return c.json({
    status: "ok",
    rule_packs: {
      US: { sha: packs.US.sha.slice(0, 16), schema_version: packs.US.pack.schema_version },
      SG: { sha: packs.SG.sha.slice(0, 16), schema_version: packs.SG.pack.schema_version },
    },
    model: getCacheMeta(),
    timestamp: new Date().toISOString(),
  });
});
