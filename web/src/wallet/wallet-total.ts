/**
 * The rule for the one number at the top of the wallet screen.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE WITH ITS OWN TESTS
 * ---------------------------------------------------------------------------
 * It is the only arithmetic on the wallet screen, and it is arithmetic over
 * money. Every other figure on that page is one balance rendered as it was
 * read; this one combines two, which means it is the only place where the page
 * can produce a number that no source ever returned.
 *
 * AGENTS.md §5 says an unread value renders as an explicit unavailable state
 * rather than a plausible-looking figure. A partial sum is exactly the failure
 * that rule is about: it is not a smaller total, it is a WRONG total, and it is
 * wrong in the direction that costs the user something — it under-reports, so
 * someone tops up an account that was already funded, or believes a hire they
 * can afford is out of reach.
 *
 * Hence four outcomes and no fifth:
 *
 *   "none"     no account exists yet     → the hero asks, it does not answer
 *   "reading"  at least one still in     → "…", never a number about to change
 *   "partial"  at least one failed       → "—", plus a line saying why
 *   "ready"    every account reported    → the sum, and only then
 *
 * The rule and the wording match components/mobile-wallet.tsx, which arrived at
 * it first. Two screens reporting two different totals for the same two
 * accounts would be worse than either being wrong alone.
 * ---------------------------------------------------------------------------
 */

export type TotalSummary =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "partial" }
  | { kind: "ready"; wei: bigint; accounts: number };

export type TotalInput = {
  /** Connected identity address, or null when nothing is connected. */
  identityAddress: string | null;
  /** Its balance in wei, or null if not read. */
  identityWei: bigint | null;
  identityLoading: boolean;
  /** The Dolphin Wallet's address, or null when none exists on this device. */
  dolphinAddress: string | null;
  dolphinWei: bigint | null;
  dolphinLoading: boolean;
  dolphinErrored: boolean;
};

export function summariseTotal(input: TotalInput): TotalSummary {
  /*
   * The duplicate-address guard matters more than it looks. Nothing stops a
   * person connecting the Dolphin Wallet's own address as their identity
   * wallet, and without this check that single balance would be counted twice
   * and the hero would report double what they actually hold. Compared
   * case-insensitively because one source is EIP-55 checksummed and the other
   * is not — a byte-equal comparison would miss it.
   */
  const countsDolphin =
    input.dolphinAddress !== null &&
    input.dolphinAddress.toLowerCase() !== input.identityAddress?.toLowerCase();

  const accounts = Number(input.identityAddress !== null) + Number(countsDolphin);
  if (accounts === 0) return { kind: "none" };

  // Loading is checked BEFORE failure: a balance that has not arrived yet has
  // not failed, and calling it unavailable would flash "—" on every load.
  if (
    (input.identityAddress !== null && input.identityLoading) ||
    (countsDolphin && input.dolphinLoading)
  ) {
    return { kind: "reading" };
  }

  if (
    (input.identityAddress !== null && input.identityWei === null) ||
    (countsDolphin && (input.dolphinErrored || input.dolphinWei === null))
  ) {
    return { kind: "partial" };
  }

  const wei =
    (input.identityAddress !== null ? input.identityWei! : BigInt(0)) +
    (countsDolphin ? input.dolphinWei! : BigInt(0));

  return { kind: "ready", accounts, wei };
}
