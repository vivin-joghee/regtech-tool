/**
 * Tells TypeScript that .yaml imports return their raw text content,
 * matching the wrangler [[rules]] Text loader.
 */
declare module "*.yaml" {
  const content: string;
  export default content;
}

/**
 * Same idea for .json predictions cache.
 */
declare module "*.json" {
  const content: unknown;
  export default content;
}
