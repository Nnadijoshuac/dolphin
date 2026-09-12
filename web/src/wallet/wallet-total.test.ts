import { describe, expect, it } from "vitest";

import { summariseTotal, type TotalInput } from "@/wallet/wallet-total";

const IDENTITY = "0x1111111111111111111111111111111111111111";
const DOLPHIN = "0x2222222222222222222222222222222222222222";

/** Everything absent; each test turns on only what it is about. */
function base(overrides: Partial<TotalInput> = {}): TotalInput {
  return {
    identityAddress: null,
    identityWei: null,
    identityLoading: false,
    dolphinAddress: null,
    dolphinWei: null,
    dolphinLoading: false,
    dolphinErrored: false,
    ...overrides,
  };
}

describe("summariseTotal", () => {
  it("asks rather than answers when no account exists", () => {
    expect(summariseTotal(base())).toEqual({ kind: "none" });
  });

  it("sums both accounts once each has reported", () => {
    const result = summariseTotal(
      base({
        identityAddress: IDENTITY,
        identityWei: BigInt(3),
        dolphinAddress: DOLPHIN,
        dolphinWei: BigInt(4),
      }),
    );
    expect(result).toEqual({ kind: "ready", accounts: 2, wei: BigInt(7) });
  });

  it("reports a single account as a total of one", () => {
    expect(
      summariseTotal(base({ identityAddress: IDENTITY, identityWei: BigInt(5) })),
    ).toEqual({ kind: "ready", accounts: 1, wei: BigInt(5) });
  });

  /*
   * The §5 cases. Each of these MUST refuse to produce a figure — a sum that
   * omits an account it does not know about is a wrong total, not a small one.
   */
  it("refuses a total while a balance is still being read", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(3),
          dolphinAddress: DOLPHIN,
          dolphinLoading: true,
        }),
      ),
    ).toEqual({ kind: "reading" });
  });

  it("refuses a total when one balance failed to read", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(3),
          dolphinAddress: DOLPHIN,
          dolphinWei: BigInt(4),
          dolphinErrored: true,
        }),
      ),
    ).toEqual({ kind: "partial" });
  });

  it("refuses a total when an account exists but reported nothing", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(3),
          dolphinAddress: DOLPHIN,
          dolphinWei: null,
        }),
      ),
    ).toEqual({ kind: "partial" });
  });

  it("treats loading as loading, not as failure", () => {
    expect(
      summariseTotal(base({ identityAddress: IDENTITY, identityLoading: true })),
    ).toEqual({ kind: "reading" });
  });

  /*
   * The double-count guard. Connecting the Dolphin Wallet's own address as the
   * identity wallet is possible and nothing prevents it; without this the hero
   * would report twice what the person holds.
   */
  it("counts one balance once when both accounts are the same address", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(9),
          dolphinAddress: IDENTITY,
          dolphinWei: BigInt(9),
        }),
      ),
    ).toEqual({ kind: "ready", accounts: 1, wei: BigInt(9) });
  });

  it("matches the same address across checksum casing", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY.toUpperCase().replace("0X", "0x"),
          identityWei: BigInt(9),
          dolphinAddress: IDENTITY,
          dolphinWei: BigInt(9),
        }),
      ),
    ).toEqual({ kind: "ready", accounts: 1, wei: BigInt(9) });
  });

  /*
   * A duplicated Dolphin address must not drag the total into "partial" or
   * "reading" on account of its own state — it is not being counted, so its
   * read does not gate anything.
   */
  it("ignores a duplicate account's own read state", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(9),
          dolphinAddress: IDENTITY,
          dolphinWei: null,
          dolphinLoading: true,
          dolphinErrored: true,
        }),
      ),
    ).toEqual({ kind: "ready", accounts: 1, wei: BigInt(9) });
  });

  it("still totals when a funded identity sits beside an empty agent wallet", () => {
    expect(
      summariseTotal(
        base({
          identityAddress: IDENTITY,
          identityWei: BigInt(12),
          dolphinAddress: DOLPHIN,
          dolphinWei: BigInt(0),
        }),
      ),
    ).toEqual({ kind: "ready", accounts: 2, wei: BigInt(12) });
  });
});
