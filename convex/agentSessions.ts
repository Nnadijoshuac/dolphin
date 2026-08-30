import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator } from "./categoryStatsValidators";

/**
 * Altana session grants, recorded next to the agentHires row they belong to.
 *
 * WHY THIS TABLE EXISTS. A session is the one thing in Dolphin that hands real
 * authority to someone else, so "what have I authorized" has to have exactly
 * one answer. Keeping the grant only in the granting browser would have made
 * the wallet screen and the hire record two independent stories about the same
 * fact, and the first time they disagreed a user would be looking at a screen
 * telling them an agent cannot spend when it can.
 *
 * WHAT IS AND IS NOT IN HERE. Only public reference detail: the session's
 * public key (which is its on-chain identifier and all revokeSession needs),
 * the granted bounds, and the agent it was granted to. No signer, no key
 * material of any kind - that stays where Altana's SDK keeps it, in the
 * device's secure element and in memory for the life of a tab. Nothing here
 * can be used to act on a wallet; it can only be used to describe and to find
 * what to revoke.
 *
 * Keyed on the ALTANA wallet address, not the hiring wallet. Those are two
 * different accounts (Altana's SDK has no injected signer, so a Dolphin wallet
 * can never be the user's MetaMask account) and it is the Altana wallet that
 * actually carries the authority.
 */

const allowedContractValidator = v.object({
  address: v.string(),
  label: v.string(),
});

function normalize(label: string, address: string): string {
  if (!isAddress(address)) {
    throw new Error(`agentSessions: "${address}" is not a valid EVM address (${label}).`);
  }
  return getAddress(address);
}

/**
 * Records a grant that already happened on-chain. Deliberately not a "create a
 * session" mutation: Convex cannot sign, and a row claiming a session exists
 * before one does would be exactly the plausible-looking false claim AGENTS.md
 * §5 rules out. The client grants first, then reports what it got.
 */
export const recordSessionGrant = mutation({
  args: {
    tokenId: v.string(),
    /** The agent's name as shown to the user at grant time. */
    agentName: v.string(),
    category: agentCategoryValidator,
    altanaWalletAddress: v.string(),
    /** The wagmi/injected address on the matching agentHires row, if any. */
    hirerWalletAddress: v.union(v.string(), v.null()),
    sessionPublicKey: v.string(),
    allowlist: v.array(allowedContractValidator),
    /** Decimal string - a bigint is not a Convex value. */
    spendCapWei: v.string(),
    spendPeriod: v.string(),
    /** Unix epoch seconds. */
    expiry: v.number(),
    grantTransactionHash: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    if (args.allowlist.length === 0) {
      // An empty allowlist is how Altana spells "any contract". Refusing it
      // here means an unrestricted session can never be recorded as though it
      // were a bounded one, whatever the client believed it was doing.
      throw new Error(
        "recordSessionGrant: refusing a session with an empty call allowlist - " +
          "Altana treats omitted/empty `calls` as all-targets-allowed.",
      );
    }

    const altanaWalletAddress = normalize("altanaWalletAddress", args.altanaWalletAddress);
    const hirerWalletAddress =
      args.hirerWalletAddress === null
        ? null
        : normalize("hirerWalletAddress", args.hirerWalletAddress);
    const allowlist = args.allowlist.map((entry) => ({
      address: normalize(`allowlist:${entry.label}`, entry.address),
      label: entry.label,
    }));

    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_session_key", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("sessionPublicKey", args.sessionPublicKey),
      )
      .unique();

    const grantedAt = new Date().toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        revokedAt: null,
        expiry: args.expiry,
        grantedAt,
      });
      return existing._id;
    }

    return ctx.db.insert("agentSessions", {
      chainId: BSC_CHAIN_ID,
      tokenId: args.tokenId,
      agentName: args.agentName,
      category: args.category,
      altanaWalletAddress,
      hirerWalletAddress,
      sessionPublicKey: args.sessionPublicKey,
      allowlist,
      spendCapWei: args.spendCapWei,
      spendPeriod: args.spendPeriod,
      expiry: args.expiry,
      grantedAt,
      revokedAt: null,
      grantTransactionHash: args.grantTransactionHash,
      status: "active",
    });
  },
});

/**
 * Records a revocation that already landed on-chain. The row is kept rather
 * than deleted so a user can see that they did revoke something, and when.
 */
export const markSessionRevoked = mutation({
  args: {
    sessionPublicKey: v.string(),
  },
  handler: async (ctx, { sessionPublicKey }) => {
    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_session_key", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("sessionPublicKey", sessionPublicKey),
      )
      .unique();

    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
    });
    return existing._id;
  },
});

/**
 * Every session ever granted from one Altana wallet, newest first.
 *
 * Revoked and expired rows are returned too, with their real status. The
 * wallet screen decides what to show; a query that silently dropped them would
 * make "I revoked that" unverifiable after the fact.
 */
export const getSessionsForAltanaWallet = query({
  args: {
    altanaWalletAddress: v.string(),
  },
  handler: async (ctx, { altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return [];
    const normalized = getAddress(altanaWalletAddress);

    const rows = await ctx.db
      .query("agentSessions")
      .withIndex("by_altana_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", normalized),
      )
      .collect();

    const nowSeconds = Math.floor(Date.now() / 1000);

    return rows
      .map((row) => ({
        ...row,
        // Expiry is a fact about the clock, not a stored state anything
        // updates, so it is derived on read rather than left to go stale.
        status:
          row.status === "active" && row.expiry <= nowSeconds
            ? ("expired" as const)
            : row.status,
      }))
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
  },
});

/** Active sessions granted to one agent from one Altana wallet. */
export const getActiveSessionForAgent = query({
  args: {
    tokenId: v.string(),
    altanaWalletAddress: v.string(),
  },
  handler: async (ctx, { tokenId, altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return null;
    const normalized = getAddress(altanaWalletAddress);
    const nowSeconds = Math.floor(Date.now() / 1000);

    const rows = await ctx.db
      .query("agentSessions")
      .withIndex("by_altana_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", normalized),
      )
      .collect();

    return (
      rows.find(
        (row) =>
          row.tokenId === tokenId &&
          row.status === "active" &&
          row.expiry > nowSeconds,
      ) ?? null
    );
  },
});

/**
 * One-time maintenance: remove a session row by its public key.
 *
 * internalMutation, so it is not reachable from either frontend. It exists
 * because this table's own verification probes write real rows, and a probe
 * row left behind would show up on a real wallet screen as authority someone
 * never granted.
 */
export const deleteSessionByKey = internalMutation({
  args: { sessionPublicKey: v.string() },
  handler: async (ctx, { sessionPublicKey }) => {
    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_session_key", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("sessionPublicKey", sessionPublicKey),
      )
      .unique();
    if (!existing) return "not-found";
    await ctx.db.delete(existing._id);
    return "deleted";
  },
});
