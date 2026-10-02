import { describe, expect, it } from "vitest";

import { defaultTaskDescription } from "./erc8183-policy";

const WALLET = "0x17bD9951F868082669c60C1285433a847f0A6FfF";

describe("defaultTaskDescription", () => {
  it("fills a known category's template with the wallet", () => {
    expect(defaultTaskDescription("yield", WALLET)).toContain(WALLET);
  });

  // Live on 2026-10-02: four "general" agents and one "payments" agent made this
  // throw, which crashed their hire card.
  it("falls back for a category with no template instead of throwing", () => {
    for (const category of ["general", "payments", "constructor"]) {
      const task = defaultTaskDescription(category, WALLET);
      expect(task).toContain(WALLET);
      expect(task.length).toBeGreaterThan(40);
    }
  });

  it("names a placeholder when no wallet is connected yet", () => {
    expect(defaultTaskDescription("general", null)).toContain("the address I will provide");
  });
});
