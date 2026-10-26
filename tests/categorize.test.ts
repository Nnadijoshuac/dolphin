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

test("a claim to a graded category needs the agent's own words behind it (2026-10-26)", () => {
  const bort = categorize({
    ...base,
    registryCategories: ["health-factor"],
    name: "BORT COIN DEPLOYER AGENT",
    description: "Launches BSC memecoins on Four.meme and Flap from real signal posts, and keeps a dated record of every launch.",
  });
  assert.notEqual(bort.slug, "health-factor");
  const pad = categorize({ ...base, registryCategories: ["yield"], name: "claude.ai", description: "An AI agent on .AI Pad (BNB Chain)." });
  assert.notEqual(pad.slug, "yield");
});

test("a graded claim the agent's words support still wins", () => {
  const vitals = categorize({ ...base, registryCategories: ["health-factor"], name: "Vitals", description: "Health factor monitoring for Venus Core Pool positions." });
  assert.equal(vitals.slug, "health-factor");
  const sluice = categorize({ ...base, registryCategories: ["yield"], name: "Sluicegate", description: "Net-APR-at-size yield routing across BNB Chain venues." });
  assert.equal(sluice.slug, "yield");
});
