/**
 * DOLPHIN'S OWN AGENTS ARE LABELLED - ALWAYS. (Mentor review, 2026-09-29: "A
 * Dolphin-operated agent on a wallet designed to look unrelated is, by your own
 * definition, related-party activity that's been concealed." The owner
 * agreed: no undisclosed first-party wallets, ever.)
 *
 * Every wallet Dolphin operates an agent from is listed in the
 * FIRST_PARTY_WALLETS deployment setting (comma-separated addresses) and on
 * the public policy page (/policies/conflicts). An agent owned by, or paid
 * to, one of them is marked "By Dolphin" wherever it appears - the same probe,
 * the same rules, no ranking boost.
 */

export function firstPartyWallets(): Set<string> {
  return new Set(
    (process.env.FIRST_PARTY_WALLETS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^0x[0-9a-f]{40}$/.test(value)),
  );
}

export function isFirstParty(owner: string | null | undefined, agentWallet: string | null | undefined, wallets = firstPartyWallets()): boolean {
  if (wallets.size === 0) return false;
  return Boolean((owner && wallets.has(owner.toLowerCase())) || (agentWallet && wallets.has(agentWallet.toLowerCase())));
}
