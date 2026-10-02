import { describe, expect, it } from "vitest";

import { composeTask, defaultTaskDescription, fillProblem, inputsForCategory } from "./erc8183-policy";

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

describe("hire inputs", () => {
  const TOKEN = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";

  it("asks a security agent for a token and others for a wallet", () => {
    expect(inputsForCategory("security")).toEqual(["token"]);
    expect(inputsForCategory("health-factor")).toEqual(["wallet"]);
    expect(inputsForCategory("general")).toEqual(["wallet"]);
  });

  it("refuses a symbol where an address is needed", () => {
    expect(fillProblem(["token"], { wallet: null, token: "CAKE", note: "" })).toMatch(/not its symbol/);
    expect(fillProblem(["token"], { wallet: null, token: TOKEN, note: "" })).toBeNull();
    expect(fillProblem(["wallet"], { wallet: "", token: null, note: "" })).toMatch(/wallet address/);
  });

  it("states every value on its own line", () => {
    const task = composeTask("security", ["token"], { wallet: null, token: TOKEN, note: "Planning to buy $50." });
    expect(task).toContain(`Check the BNB Chain token ${TOKEN}`);
    expect(task).toContain(`Token: ${TOKEN}`);
    expect(task).toContain("Note: Planning to buy $50.");
    const health = composeTask("health-factor", ["wallet"], { wallet: WALLET, token: null, note: "" });
    expect(health).toContain(WALLET);
    expect(health).toContain(`Wallet: ${WALLET}`);
  });
});
