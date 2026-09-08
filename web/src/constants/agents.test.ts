import { describe, expect, it } from "vitest";

import {
  AGENT_CATEGORIES,
  categoryDescription,
  categoryLabel,
} from "@/constants/agents";

/**
 * `categoryLabel` has to be TOTAL, and these are the cases that were wrong.
 *
 * `AgentCategory` is an open string. The code this replaced looked a slug up in
 * a hardcoded list of five and fell back to the literal "Monitoring" on a card,
 * or indexed a `Record<AgentCategory, string>` directly and produced `undefined`
 * in the detail breadcrumb. The backend classifies into thirteen slugs, so both
 * were wrong for the majority of the catalog - and a WRONG label is worse than
 * a derived one, because it is a claim about what the agent does.
 */
describe("categoryLabel", () => {
  it("uses the editorial label for a category Dolphin has copy for", () => {
    expect(categoryLabel("grid-trading")).toBe("Grid Trading");
    expect(categoryLabel("health-factor")).toBe("Health Factor");
  });

  it("derives a label for a backend category with no editorial entry", () => {
    // These are all real slugs from convex/lib/categorize.ts that the old
    // hardcoded list did not contain.
    expect(categoryLabel("research")).toBe("Research");
    expect(categoryLabel("security")).toBe("Security");
    expect(categoryLabel("general")).toBe("General");
    expect(categoryLabel("health-monitoring")).toBe("Health Monitoring");
  });

  it("derives a label for a category nobody has invented yet", () => {
    // The whole point of the open set: a slug from the registry that no code
    // in this repo has ever seen must still render as words.
    expect(categoryLabel("quantum-arbitrage")).toBe("Quantum Arbitrage");
  });

  it("never returns undefined, an empty string, or a wrong category's name", () => {
    for (const slug of [
      "research",
      "security",
      "general",
      "",
      "unknown-thing",
    ]) {
      const label = categoryLabel(slug);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      // The specific regression: everything unknown used to read "Monitoring".
      if (slug !== "monitoring") expect(label).not.toBe("Monitoring");
    }
  });

  it("handles null and undefined rather than throwing", () => {
    expect(categoryLabel(null)).toBe("Uncategorised");
    expect(categoryLabel(undefined)).toBe("Uncategorised");
  });
});

describe("categoryDescription", () => {
  it("covers every category Dolphin has editorial copy for", () => {
    for (const category of AGENT_CATEGORIES) {
      expect(categoryDescription(category.slug)).toBe(category.description);
    }
  });

  it("covers the backend categories the editorial list omits", () => {
    // Regression guard: these exist in convex/lib/categorize.ts and had no
    // presence in this app at all.
    for (const slug of [
      "monitoring",
      "research",
      "development",
      "security",
      "payments",
      "content",
      "automation",
      "general",
    ]) {
      expect(categoryDescription(slug)).toBeTruthy();
    }
  });

  it("returns null rather than inventing copy for an unknown category", () => {
    // Deliberate: a made-up description of a category Dolphin does not
    // understand would be exactly the fabrication AGENTS.md SS5 forbids.
    expect(categoryDescription("quantum-arbitrage")).toBeNull();
    expect(categoryDescription(null)).toBeNull();
  });
});
