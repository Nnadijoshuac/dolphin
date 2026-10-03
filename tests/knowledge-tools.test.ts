import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanDescribedTool, parsePriceU, proposeKnowledgeTools, searchSections, type KnowledgeDoc } from "../convex/lib/knowledgeTools";

const styles: KnowledgeDoc = {
  id: "doc1",
  name: "Motion styles",
  sections: [
    { title: "Apple Style", slug: "apple_style" },
    { title: "Showreel", slug: "showreel" },
  ],
};

test("Dolphin proposes list, one get per section, search and ask, with suggested prices", () => {
  const tools = proposeKnowledgeTools([styles], [], true);
  assert.deepEqual(
    tools.map((t) => [t.name, t.priceU, t.enabled]),
    [
      ["list_sections", null, true],
      ["get_apple_style", "0.01", true],
      ["get_showreel", "0.01", true],
      ["search_knowledge", null, true],
      ["ask", "0.02", true],
    ],
  );
  assert.deepEqual(tools[1].section, { documentId: "doc1", slug: "apple_style" });
});

test("ask starts off without a brain: it needs the builder's own model", () => {
  const ask = proposeKnowledgeTools([styles], [], false).find((t) => t.name === "ask");
  assert.equal(ask?.enabled, false);
});

test("a builder's price, switch and wording survive a regeneration", () => {
  const first = proposeKnowledgeTools([styles], [], true);
  const edited = first.map((t) =>
    t.name === "get_showreel" ? { ...t, priceU: "0.25", enabled: false, description: "My showreel notes.", edited: true } : t,
  );
  const more: KnowledgeDoc = { id: "doc2", name: "Extras", sections: [{ title: "Endings", slug: "endings" }] };
  const again = proposeKnowledgeTools([styles, more], edited, true);
  const showreel = again.find((t) => t.name === "get_showreel");
  assert.deepEqual([showreel?.priceU, showreel?.enabled, showreel?.description], ["0.25", false, "My showreel notes."]);
  assert.ok(again.some((t) => t.name === "get_endings" && t.priceU === "0.01"));
});

test("past 16 sections, one get_section replaces a tool per section", () => {
  const big: KnowledgeDoc = {
    id: "doc3",
    name: "Big guide",
    sections: Array.from({ length: 20 }, (_, i) => ({ title: `Part ${i + 1}`, slug: `part_${i + 1}` })),
  };
  const tools = proposeKnowledgeTools([big], [], true);
  assert.deepEqual(tools.map((t) => t.name), ["list_sections", "get_section", "search_knowledge", "ask"]);
  assert.match(tools[1].description, /and 14 more/);
});

test("a heading two documents share is named after its document", () => {
  const a: KnowledgeDoc = { id: "a", name: "Styles", sections: [{ title: "Introduction", slug: "introduction" }] };
  const b: KnowledgeDoc = { id: "b", name: "Steering notes", sections: [{ title: "Introduction", slug: "introduction" }] };
  const names = proposeKnowledgeTools([a, b], [], true).map((t) => t.name);
  assert.ok(names.includes("get_introduction"));
  assert.ok(names.includes("get_steering_notes_introduction"), names.join(", "));
});

test("two sections with one slug never share a tool name", () => {
  const twin: KnowledgeDoc = { id: "d", name: "D", sections: [{ title: "Setup", slug: "setup" }, { title: "Setup", slug: "setup" }] };
  const names = proposeKnowledgeTools([twin], [], true).map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test("prices are checked like x402 checks them", () => {
  assert.deepEqual(parsePriceU("0.05"), { priceU: "0.05" });
  assert.deepEqual(parsePriceU(".5"), { priceU: "0.5" });
  assert.deepEqual(parsePriceU(""), { priceU: null });
  assert.deepEqual(parsePriceU("free"), { priceU: null });
  assert.equal(parsePriceU("0.0001"), null); // under 0.001 U
  assert.equal(parsePriceU("5000"), null);
  assert.equal(parsePriceU("1e3"), null);
});

test("search points at the right section", () => {
  const sections = [
    { title: "Apple Style", text: "Slow push-ins, soft gradients, white space.\n\nType enters with a 400 ms ease-out." },
    { title: "Showreel", text: "Fast montage at 120 BPM. Cut on the beat; hold hero shots for two bars." },
  ];
  const hits = searchSections("how fast should the montage cut on the beat?", sections);
  assert.equal(hits[0].section, "Showreel");
  // The query and sections that picked a bare heading on dev (2026-10-03).
  const dev = [
    { title: "Showreel", text: "## Showreel\n\nFast montage at 120 BPM. Cut on the beat; hold hero shots for two bars." },
    { title: "Fast-cut Black and White", text: "## Fast-cut Black and White\n\nHigh contrast, grain at 8%. Cuts every 6-8 frames." },
  ];
  const first = searchSections("how fast should a montage cut?", dev)[0];
  assert.equal(first.section, "Showreel");
  assert.ok(!first.text.startsWith("#"));
  assert.equal(searchSections("gradients", sections)[0].section, "Apple Style");
  assert.deepEqual(searchSections("the and of", sections), []);
});

test("a described tool from the chat is made safe", () => {
  const existing = proposeKnowledgeTools([styles], [], true);
  const made = cleanDescribedTool(
    {
      name: "Make Storyboard!",
      description: "Writes a five-shot storyboard in one of the styles.",
      inputs: [
        { name: "style", description: "Which style" },
        { name: "seconds", description: "How long" },
        { name: "style", description: "duplicate" },
        { name: "a", description: "too short" },
      ],
      instructions: "Fetch the style's section, then write five numbered shots that fit the length.",
    },
    existing,
    true,
  );
  assert.ok("tool" in made);
  if (!("tool" in made)) return;
  assert.equal(made.tool.name, "make_storyboard");
  assert.deepEqual(made.tool.inputs?.map((i) => i.name), ["style", "seconds"]);
  assert.deepEqual([made.tool.priceU, made.tool.enabled, made.tool.kind], ["0.02", true, "described"]);
});

test("a described tool cannot take a document tool's name or exist without instructions", () => {
  const existing = proposeKnowledgeTools([styles], [], true);
  const base = { description: "Does a useful thing for the buyer.", inputs: [], instructions: "Do the useful thing well." };
  assert.ok("problem" in cleanDescribedTool({ ...base, name: "get_showreel" }, existing, true));
  assert.ok("problem" in cleanDescribedTool({ ...base, name: "ask" }, existing, true));
  assert.ok("problem" in cleanDescribedTool({ ...base, name: "summarise", instructions: "" }, existing, true));
  // Without a brain it is made, but starts switched off: it runs on the builder's own model.
  const off = cleanDescribedTool({ ...base, name: "summarise" }, existing, false);
  assert.ok("tool" in off && off.tool.enabled === false);
});

test("described tools survive regeneration, even with no documents left", () => {
  const made = cleanDescribedTool(
    { name: "make_storyboard", description: "Writes a storyboard.", inputs: [], instructions: "Write five shots." },
    [],
    true,
  );
  assert.ok("tool" in made);
  if (!("tool" in made)) return;
  const tools = [...proposeKnowledgeTools([styles], [], true), { ...made.tool, priceU: "0.5" }];
  assert.ok(proposeKnowledgeTools([styles], tools, true).some((t) => t.name === "make_storyboard" && t.priceU === "0.5"));
  assert.deepEqual(proposeKnowledgeTools([], tools, true).map((t) => t.name), ["make_storyboard"]);
});
