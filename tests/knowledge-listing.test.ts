import assert from "node:assert/strict";
import { test } from "node:test";

import { knowledgeCallPrice, knowledgeRegistration, priceUToRaw, servedFromListing, type ListingKnowledge } from "../convex/lib/knowledgeServe";

const listing: ListingKnowledge = {
  documents: [
    {
      documentId: "doc1",
      name: "styles",
      sha256: "ab".repeat(32),
      sections: [{ title: "Showreel", slug: "showreel", chars: 120, storageId: "s1" as never }],
    },
  ],
  tools: [
    { name: "list_sections", kind: "list", description: "Lists.", section: null, priceU: null, enabled: true },
    { name: "get_showreel", kind: "get", description: "Showreel.", section: { documentId: "doc1", slug: "showreel" }, priceU: "0.25", enabled: true },
    { name: "search_knowledge", kind: "search", description: "Search.", section: null, priceU: null, enabled: false },
    { name: "ask", kind: "ask", description: "Ask.", section: null, priceU: "0.02", enabled: true },
  ],
};

test("U prices become 18-decimal base units exactly", () => {
  assert.equal(priceUToRaw("0.01"), "10000000000000000");
  assert.equal(priceUToRaw("0.25"), "250000000000000000");
  assert.equal(priceUToRaw("1"), "1000000000000000000");
  assert.equal(priceUToRaw("0.001"), "1000000000000000");
});

test("each tool is charged its own price; free and switched-off tools are free; other names fall through", () => {
  assert.deepEqual(knowledgeCallPrice(listing, "get_showreel"), { known: true, priceRaw: "250000000000000000" });
  assert.deepEqual(knowledgeCallPrice(listing, "list_sections"), { known: true, priceRaw: null });
  assert.deepEqual(knowledgeCallPrice(listing, "search_knowledge"), { known: true, priceRaw: null });
  assert.deepEqual(knowledgeCallPrice(listing, "ask"), { known: true, priceRaw: "20000000000000000" });
  assert.deepEqual(knowledgeCallPrice(listing, "a0__report"), { known: false, priceRaw: null });
  assert.deepEqual(knowledgeCallPrice(null, "get_showreel"), { known: false, priceRaw: null });
});

test("a published agent serves only its switched-on tools, each section naming its document", () => {
  const served = servedFromListing(listing);
  assert.deepEqual(served?.tools.map((t) => t.name), ["list_sections", "get_showreel", "ask"]);
  assert.equal(served?.sections[0].documentName, "styles");
  assert.equal(servedFromListing(undefined), null);
});

test("the registration file lists live tools with prices and each document's fingerprint", () => {
  const file = knowledgeRegistration(listing);
  assert.deepEqual(file.tools.map((t) => [t.name, t.price?.display ?? "free"]), [["list_sections", "free"], ["get_showreel", "0.25 U"], ["ask", "0.02 U"]]);
  assert.deepEqual(file.knowledge, [{ name: "styles", sha256: "ab".repeat(32), sections: 1 }]);
});
