import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";

import {
  buildWithdrawCall,
  maxNativeWithdrawal,
  parseWithdrawAmount,
  withdrawRefusal,
} from "./withdraw-policy";

const U = "0xcE24439F2D9C6a2289F741120FE202248B666666" as const;
const DOLPHIN = "0x17bD9951F868082669c60C1285433a847f0A6FfF";
const OWNER = "0x13450a106568D011D25D8AC222b489B098Df9196";
const TENTH = BigInt("100000000000000000");

describe("parseWithdrawAmount", () => {
  it("reads plain decimals in atomic units", () => {
    expect(parseWithdrawAmount("0.1", 18)).toBe(TENTH);
    expect(parseWithdrawAmount("1", 18)).toBe(BigInt("1000000000000000000"));
    expect(parseWithdrawAmount(".5", 6)).toBe(BigInt(500000));
  });
  it("refuses what is not a positive, representable amount", () => {
    for (const bad of ["", "0", "0.0", "-1", "abc", "1,5", "1.2.3", "0.1234567"]) {
      expect(parseWithdrawAmount(bad, 6)).toBeNull();
    }
  });
});

describe("maxNativeWithdrawal", () => {
  it("keeps the gas and setup reserve behind, never below zero", () => {
    expect(maxNativeWithdrawal(BigInt(1000), BigInt(300))).toBe(BigInt(700));
    expect(maxNativeWithdrawal(BigInt(200), BigInt(300))).toBe(BigInt(0));
  });
});

describe("withdrawRefusal", () => {
  const base = { amountRaw: TENTH, available: TENTH, from: DOLPHIN, to: OWNER, symbol: "U" };
  it("allows a withdrawal to the connected wallet within the balance", () => {
    expect(withdrawRefusal(base)).toBeNull();
  });
  it("refuses without a connected wallet, to itself, over the balance, or unread", () => {
    expect(withdrawRefusal({ ...base, to: null })).toMatch(/Connect your wallet/);
    expect(withdrawRefusal({ ...base, to: DOLPHIN.toLowerCase() })).toMatch(/Dolphin Wallet itself/);
    expect(withdrawRefusal({ ...base, amountRaw: TENTH + BigInt(1) })).toMatch(/more U/);
    expect(withdrawRefusal({ ...base, available: null })).toMatch(/could not be read/);
    expect(withdrawRefusal({ ...base, amountRaw: null })).toMatch(/Enter an amount/);
  });
});

describe("buildWithdrawCall", () => {
  it("sends BNB as value straight to the owner", () => {
    expect(buildWithdrawCall({ kind: "native", symbol: "BNB", decimals: 18 }, OWNER, TENTH)).toEqual({
      to: OWNER,
      value: TENTH,
    });
  });
  it("sends a token as transfer(owner, amount) on the token contract", () => {
    const call = buildWithdrawCall({ kind: "token", token: U, symbol: "U", decimals: 18 }, OWNER, TENTH);
    expect(call.to).toBe(U);
    expect(call.value).toBeUndefined();
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data! });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([OWNER, TENTH]);
  });
});
