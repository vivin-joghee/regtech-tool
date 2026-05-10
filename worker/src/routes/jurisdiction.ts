/**
 * Read-only endpoints for examiner / reviewer transparency over the
 * jurisdiction rule packs. The architecture (§2.2) calls this out
 * explicitly: an MAS or OCC examiner should be able to look up the
 * exact rules in force without reading TypeScript.
 */

import { Hono } from "hono";

import type { AppContext } from "../env";
import { getRulePack, getRulePacks } from "../rules/loader";
import { jurisdictionSchema } from "../rules/types";

export const jurisdictionRoute = new Hono<AppContext>();

jurisdictionRoute.get("/", async (c) => {
  const packs = await getRulePacks();
  return c.json({
    US: {
      sha: packs.US.sha,
      pack: packs.US.pack,
    },
    SG: {
      sha: packs.SG.sha,
      pack: packs.SG.pack,
    },
  });
});

jurisdictionRoute.get("/:code", async (c) => {
  const parsed = jurisdictionSchema.safeParse(c.req.param("code"));
  if (!parsed.success) {
    return c.json(
      { error: "Unknown jurisdiction", supported: ["US", "SG"] },
      400,
    );
  }
  const { pack, sha, raw } = await getRulePack(parsed.data);
  return c.json({ sha, pack, raw_yaml: raw });
});
