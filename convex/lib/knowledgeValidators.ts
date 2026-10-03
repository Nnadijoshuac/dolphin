import { v } from "convex/values";

/** lib/knowledgeTools.ts KnowledgeTool, as a Convex validator. Field for field: change both together. */
export const knowledgeToolValidator = v.object({
  name: v.string(),
  kind: v.union(v.literal("list"), v.literal("get"), v.literal("get_any"), v.literal("search"), v.literal("ask"), v.literal("described")),
  description: v.string(),
  section: v.union(v.null(), v.object({ documentId: v.string(), slug: v.string() })),
  priceU: v.union(v.string(), v.null()),
  enabled: v.boolean(),
  edited: v.optional(v.boolean()),
  inputs: v.optional(v.array(v.object({ name: v.string(), description: v.string() }))),
  instructions: v.optional(v.string()),
});
