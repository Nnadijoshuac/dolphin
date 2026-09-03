import type { AgentCategory } from "@/types/agent";

/**
 * Dolphin's paid-hire policy: which rail a paid agent is paid over, and what
 * a user is shown before any money moves.
 *
 * MIRRORED BY HAND in src/wallet/erc8183-policy.ts (the Expo app), the same
 * manual-sync rule altana-policy.ts already carries. Edit both in one change.
 *
 * Deliberately free of `@altananetwork/sdk` imports, for the reason measured in
 * Session 6 and recorded beside ALTANA_CHAIN_ID: the package root is a barrel,
 * so importing one constant from it drags the whole SDK into the native Expo
 * bundle that cannot use any of it. The providers that CAN use the SDK resolve
 * its ERC8183_ADDRESSES themselves and assert they agree with the chain id
 * below.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-31): paid hires settle over ERC-8183 escrow, not x402.
 * ---------------------------------------------------------------------------
 * Measured, not assumed. Every service endpoint of all 17 catalog agents was
 * fetched live and NOT ONE answered HTTP 402 - x402 has no counterparty in
 * this catalog. What the paid agents publish instead, in their own
 * descriptions and their own A2A agent cards, is ERC-8183: an on-chain job
 * escrow denominated in $U. Three independent sellers returned real
 * wallet-signed quotes over it. Evidence in SESSION-LOG-2026-08-31-payments.md.
 *
 * TO REVERSE OR EXTEND: the Altana SDK ships working x402 support
 * (`client.fetchWithX402`, `signX402Payment`). The only thing missing is a
 * seller. The moment an endpoint in this catalog answers 402, a second rail
 * slots in beside this one; nothing here assumes it is the only possible rail,
 * only the only one with someone on the other end today.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-31): nothing about a price is a constant in this codebase.
 * ---------------------------------------------------------------------------
 * The amount, the token address, its symbol, its decimals and the payee are
 * ALL read at hire time - the first four from the seller's live quote and a
 * direct read of the token contract, the last cross-checked against the
 * agent's own registered ERC-8004 wallet. There is deliberately no price, no
 * token address and no decimals value written anywhere in this file or its
 * twin. A hardcoded one would be a plausible-looking number about someone
 * else's business, which is the exact failure AGENTS.md §5 exists to prevent.
 */

/**
 * Plain data, NOT the SDK's ERC8183_ADDRESSES - see the note above about the
 * barrel import. Providers assert this against the SDK's own value so the two
 * cannot silently diverge.
 */
export const ERC8183_CHAIN_ID = 56;

/**
 * How much longer than the escrow's own dispute window the job stays open for
 * the seller to submit into.
 *
 * 30 minutes, matching the SDK's own documented default for `hireErc8183Agent`
 * (`deadlineSeconds`, "mirrors bag erc8183 buy --deadline-min 30"). The live
 * sellers probed this session estimated 120-600 seconds to complete, so this
 * is roughly 3-15x their own estimate: comfortable for a seller having a slow
 * day, without leaving a user's money parked indefinitely if one never
 * delivers. A job past its deadline is refundable by the buyer.
 */
export const JOB_DEADLINE_SECONDS = 1800;

/**
 * What Dolphin proposes the user is buying, per category.
 *
 * These are REQUEST texts, not claims about what an agent can do - they say
 * what Dolphin is asking for, and the seller's own quote comes back saying
 * what it will actually deliver (`deliverables`), which is what the UI shows
 * beside the price. The user can edit this before anything is quoted.
 *
 * `{address}` is substituted with the user's own Dolphin Wallet, because every
 * one of these questions is only answerable about a specific account.
 */
const TASK_TEMPLATES: Readonly<Record<AgentCategory, string>> = {
  "health-factor":
    "Report the current health factor for {address} on BNB Chain, the collateral drawdown that would liquidate it, and the minimum repayment that would restore a safe position.",
  rebalancing:
    "Price the rebalance for the portfolio held by {address} on BNB Chain against the pools that would actually execute it, including swap fees and price impact at the real size.",
  yield:
    "Rank the yield venues available to {address} on BNB Chain and state whether moving the position pays for itself after costs.",
  "grid-trading":
    "Size a grid for the position held by {address} on BNB Chain and cost it against the pool itself, including the break-even spacing.",
  monitoring:
    "Report the current on-chain activity and notable changes for {address} on BNB Chain.",
  trading:
    "State the trades you would place for {address} on BNB Chain right now, with the entry, the exit, the invalidation level and the size, and cost each one against the venue that would actually fill it.",
};

export function defaultTaskDescription(
  category: AgentCategory,
  walletAddress: string | null,
): string {
  return TASK_TEMPLATES[category].replace(
    "{address}",
    walletAddress ?? "the address I will provide",
  );
}

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-31): who gets offered a payment step, and why it is not
 * "whoever the catalog says has a price".
 * ---------------------------------------------------------------------------
 * The obvious trigger is a non-zero `priceModel`. That alone would make this
 * entire feature dead code, and it is worth being precise about why rather
 * than quietly widening the condition.
 *
 * Dolphin's catalog prices EVERY agent at zero, from one constant
 * (DEFAULT_READ_ONLY_PRICE_MODEL), because ERC-8004 carries no price field and
 * 8004scan publishes none. So no agent's `priceModel` is ever non-zero, and a
 * payment step gated only on that would never render for anybody.
 *
 * Meanwhile five agents in this very catalog demonstrably DO charge - they
 * returned real wallet-signed quotes for 0.10 $U this session. The price is
 * real; it simply is not a field anyone publishes. On this rail a price is
 * something you find out by ASKING, over A2A, and asking is free and signs
 * nothing.
 *
 * So the step is offered when either is true:
 *   1. the catalog carries a real non-zero price - honoured if one ever
 *      appears, which is the brief's original trigger, unchanged; or
 *   2. the agent publishes an endpoint that can be asked for a price.
 *
 * In case 2 nothing is asserted about what the agent charges, or whether it
 * charges at all. The UI says "ask it" and the agent answers for itself. That
 * is the opposite of inventing a price: it is declining to guess one when a
 * real source exists and can be consulted on demand.
 *
 * What deliberately does NOT change: the hire gate. A zero catalog price
 * still records a free hire, and a paid ERC-8183 job is a separate purchase of
 * actual work. Those are two different transactions and the UI keeps them
 * apart.
 */

/**
 * Whether this agent publishes an endpoint Dolphin could negotiate against.
 *
 * MIRRORS selectNegotiationEndpoint in convex/lib/erc8183.ts and must agree
 * with it - this decides whether to OFFER the step, that one decides where the
 * request actually goes, and a disagreement would mean offering a button that
 * always errors. Same two exclusions for the same reasons: only A2A speaks
 * this protocol, and an endpoint still carrying an un-substituted `{agentId}`
 * template is not a URL anyone can call.
 */
export function canNegotiate(
  services: readonly { name: string; endpoint: string }[],
): boolean {
  return services.some(
    (service) => service.name === "a2a" && !service.endpoint.includes("{"),
  );
}

/**
 * Atomic units -> a display string, using the decimals the TOKEN ITSELF
 * reported. Display only: every comparison, balance check and on-chain amount
 * uses the raw bigint, never this.
 *
 * BigInt(...) rather than an `n` literal for the same reason formatBnb in
 * altana-policy.ts avoids one: web/tsconfig.json targets ES2017.
 */
export function formatTokenAmount(
  raw: string | bigint,
  decimals: number,
  maxDecimals = 6,
): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  if (decimals <= 0) return value.toString();
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === BigInt(0)) return whole.toString();
  const padded = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");
  return padded.length === 0 ? whole.toString() : `${whole}.${padded}`;
}

/** True when the wallet cannot cover `priceRaw`. Compared as bigints, never as numbers. */
export function hasSufficientBalance(
  balanceRaw: bigint | null,
  priceRaw: string,
): boolean {
  if (balanceRaw === null) return false;
  return balanceRaw >= BigInt(priceRaw);
}

/**
 * How a user actually gets the token an agent wants.
 *
 * Deliberately phrased around what was measured rather than what would be
 * convenient to say: $U has a PancakeSwap V3 U/USDT 0.01% pool holding ~10.9M
 * $U and a U/WBNB 0.05% pool holding ~2.0M, so "swap for it" is a true
 * instruction backed by a pool that can absorb the trade, not a hopeful one.
 * The V2 U/USDT pair is effectively dead (0.013 $U) and is not suggested.
 *
 * Written generically over the token the quote names, so it stays correct if a
 * seller ever quotes in something else.
 */
export function fundingHint(symbol: string, walletAddress: string | null): string {
  return (
    `Swap for ${symbol} on BNB Smart Chain — PancakeSwap V3 has the deepest ${symbol} liquidity — ` +
    `then send it to your Dolphin Wallet${walletAddress ? ` at ${walletAddress}` : ""}. ` +
    `The Dolphin Wallet is a separate account from your connected browser wallet and does not ` +
    `share its balance, so ${symbol} held elsewhere cannot pay for this.`
  );
}
