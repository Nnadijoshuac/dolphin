/**
 *   npx tsx --test tests/dedupe-series.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDuplicates, SERIES_MIN, type DedupeCandidate } from "../convex/lib/dedupe";

const OWNER = "0x72bb8416eefe38fe76a4568ed826359ac5253db1";
function stock(i: number, rank: number): DedupeCandidate {
  return {
    agentKey: `56:reg:${i}`,
    name: `TICK${i}x`,
    description: `Explore market data for Company ${i} xStock (TICK${i}x) on BNB Chain, including price, market cap.`,
    ownerAddress: OWNER,
    rank,
  };
}

describe("mass-produced series", () => {
  it("keeps one listing of a publisher's templated run", () => {
    const run = Array.from({ length: 30 }, (_, i) => stock(i, i === 7 ? 99 : i));
    const dup = findDuplicates(run);
    assert.equal(dup.size, 29);
    assert.equal(dup.has("56:reg:7"), false);
  });

  it("leaves a small suite from one publisher alone", () => {
    const run = Array.from({ length: SERIES_MIN - 1 }, (_, i) => stock(i, i));
    assert.equal(findDuplicates(run).size, 0);
  });

  it("does not group different publishers that share an opening", () => {
    const run = Array.from({ length: 30 }, (_, i) => ({ ...stock(i, i), ownerAddress: `0x${i.toString(16).padStart(40, "0")}` }));
    assert.equal(findDuplicates(run).size, 0);
  });
});
