/**
 * Worker bindings — declared once, used everywhere via Hono's generic.
 */

export interface Env {
  DATABASE_URL: string;
  // Future bindings (uncomment as we add them):
  // RULE_PACKS: KVNamespace;
  // ARTIFACTS: R2Bucket;
}

export type AppContext = {
  Bindings: Env;
};
