/**
 * Loads, parses, validates, and content-hashes the jurisdiction rule packs.
 *
 * The YAML files in worker/config/ are the source of truth. They get
 * bundled as strings by the Wrangler Text rule (see wrangler.toml).
 * On module init we parse + Zod-validate them, then expose them as
 * typed `RulePack` objects.
 *
 * The SHA-256 of each rule pack's YAML text is computed and persisted
 * alongside every alert at scoring time, so a rule change is always
 * traceable to a specific deployed version of that file.
 */

import { parse as parseYaml } from "yaml";

import usYamlText from "../../config/us.yaml";
import sgYamlText from "../../config/sg.yaml";
import { type Jurisdiction, type RulePack, rulePackSchema } from "./types";

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface LoadedPack {
  pack: RulePack;
  sha: string;
  raw: string;
}

let cache: Record<Jurisdiction, LoadedPack> | null = null;

export async function getRulePacks(): Promise<Record<Jurisdiction, LoadedPack>> {
  if (cache) return cache;

  const us = rulePackSchema.parse(parseYaml(usYamlText));
  const sg = rulePackSchema.parse(parseYaml(sgYamlText));

  cache = {
    US: { pack: us, sha: await sha256(usYamlText), raw: usYamlText },
    SG: { pack: sg, sha: await sha256(sgYamlText), raw: sgYamlText },
  };
  return cache;
}

export async function getRulePack(jur: Jurisdiction): Promise<LoadedPack> {
  const all = await getRulePacks();
  return all[jur];
}
