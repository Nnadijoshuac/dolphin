/**
 *   npx tsx --test tests/dedupe-retired.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDuplicates, selfRetired } from "../convex/lib/dedupe";

describe("self-retired registrations", () => {
  it("takes the publisher at its word", () => {
    assert.equal(selfRetired({ name: "Tidemark (retired duplicate)", description: "Duplicate registration, not in service." }), true);
    assert.equal(selfRetired({ name: "Old Router", description: "Deprecated - use v2." }), true);
  });
  it("leaves ordinary agents alone", () => {
    assert.equal(selfRetired({ name: "Tidemark", description: "Realised yield, measured from on-chain exchange-rate growth." }), false);
    assert.equal(selfRetired({ name: "Retirement Planner", description: "Plans a retirement portfolio." }), false);
  });
  it("is kept out of browse by findDuplicates", () => {
    const rows = [
      { agentKey: "a", name: "Tidemark", description: "Yield", ownerAddress: "0x1", rank: 2 },
      { agentKey: "b", name: "Tidemark (retired duplicate)", description: "Not in service.", ownerAddress: "0x1", rank: 1 },
    ];
    assert.deepEqual([...findDuplicates(rows)], ["b"]);
  });
});
