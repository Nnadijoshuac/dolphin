import assert from "node:assert/strict";
import { test } from "node:test";

import { categorize } from "../convex/lib/categorize";

const base = { registryCategories: [], tags: [], skills: [] };

test("a V3 range re-centring agent is rebalancing, not general (Bound, 2026-10-04)", () => {
  const bound = categorize({ ...base, name: "Bound", description: "Marque reference agent: PancakeSwap V3 range health and bounded re-centre planning." });
  assert.equal(bound.slug, "rebalancing");
  const range = categorize({ ...base, name: "Mandate Range-1", description: "Recenters PancakeSwap V3 positions that have drifted out of range." });
  assert.equal(range.slug, "rebalancing");
});

test("a vague registry label still loses to a specific rebalancing description", () => {
  const bound = categorize({ ...base, registryCategories: ["defi"], name: "Bound", description: "PancakeSwap V3 range health and bounded re-centre planning." });
  assert.equal(bound.slug, "rebalancing");
});
