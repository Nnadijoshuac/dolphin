/**
 * Sign-in with Ethereum, as three calls: ask for a challenge, sign it, exchange
 * the signature for a session.
 *
 * Read convex/lib/walletAuth.ts first - it carries the decision record for why
 * this exists, why the session is a bearer token rather than ctx.auth, and why
 * the server builds the message.
 *
 * ---------------------------------------------------------------------------
 * WHY requestNonce AND verifySignature ARE ACTIONS
 * ---------------------------------------------------------------------------
 * Both need something a Convex mutation cannot give them.
 *
 * requestNonce needs real randomness. Convex seeds randomness deterministically
 * inside queries and mutations - which is exactly right for reproducibility and
 * exactly wrong for a security nonce. Actions run outside that determinism, so
 * crypto.getRandomValues there is genuine.
 *
 * verifySignature needs the network, for the smart-account path: an EOA
 * signature is recovered with pure arithmetic, but a contract account (which
 * the Altana "Dolphin Wallet" is - an EIP-7702 upgraded EOA) verifies through
 * ERC-1271, and that is a call to the account itself on BSC.
 *
 * Both therefore write through internal mutations rather than writing directly.
 */

import { v } from "convex/values";
import { recoverMessageAddress } from "viem";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { BSC_CHAIN_ID, bscPublicClient } from "./lib/bscClient";
import {
  NONCE_TTL_MS,
  SESSION_TTL_MS,
  buildSiweMessage,
  hasExpired,
  hashSessionToken,
  normalizeAddress,
  randomHex,
} from "./lib/walletAuth";

/* ─────────────────────── challenge ─────────────────────── */

export const requestNonce = action({
  args: { address: v.string() },
  returns: v.object({
    nonce: v.string(),
    /** Sign THIS string, byte for byte. Anything else will not verify. */
    message: v.string(),
    expiresAt: v.string(),
  }),
  handler: async (
    ctx,
    { address },
  ): Promise<{ nonce: string; message: string; expiresAt: string }> => {
    const normalized = normalizeAddress(address, "requestNonce");

    const nonce = randomHex(16);
    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + NONCE_TTL_MS).toISOString();

    const message = buildSiweMessage({
      address: normalized,
      nonce,
      issuedAt,
      expiresAt,
    });

    await ctx.runMutation(internal.walletAuth.storeNonce, {
      nonce,
      address: normalized,
      message,
      issuedAt,
      expiresAt,
    });

    return { nonce, message, expiresAt };
  },
});

export const storeNonce = internalMutation({
  args: {
    nonce: v.string(),
    address: v.string(),
    message: v.string(),
    issuedAt: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, args) => {
    // Opportunistic cleanup of this address's dead challenges. A user who taps
    // connect three times should not leave three live nonces behind, and this
    // costs one indexed scan on a table that only ever holds minutes of rows.
    const stale = await ctx.db
      .query("authNonces")
      .filter((q) => q.eq(q.field("address"), args.address))
      .collect();
    for (const row of stale) {
      if (hasExpired(row.expiresAt)) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.insert("authNonces", args);
    return null;
  },
});

export const takeNonce = internalQuery({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    return ctx.db
      .query("authNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
  },
});

/* ─────────────────────── verification ─────────────────────── */

export const verifySignature = action({
  args: {
    nonce: v.string(),
    /** The signature over the stored message, as returned by the wallet. */
    signature: v.string(),
  },
  returns: v.object({
    token: v.string(),
    address: v.string(),
    expiresAt: v.string(),
  }),
  handler: async (
    ctx,
    { nonce, signature },
  ): Promise<{ token: string; address: string; expiresAt: string }> => {
    const challenge = await ctx.runQuery(internal.walletAuth.takeNonce, { nonce });

    if (!challenge) {
      throw new Error(
        "This sign-in challenge is not recognised. It may already have been used - ask for a new one.",
      );
    }
    if (hasExpired(challenge.expiresAt)) {
      // Burn it anyway, so an expired challenge cannot be retried later.
      await ctx.runMutation(internal.walletAuth.deleteNonce, { nonce });
      throw new Error("This sign-in challenge has expired. Ask for a new one and sign again.");
    }

    const expected = challenge.address;
    const signatureHex = signature as `0x${string}`;

    /*
     * Two verification paths, cheapest first.
     *
     * An ordinary EOA is verified by recovering the signer from the signature -
     * pure arithmetic, no network, no cost. Only if that fails is the contract
     * path tried, because a smart account (ERC-1271) can only be verified by
     * asking the account itself, which is an RPC call.
     *
     * The order matters for more than cost: the great majority of sign-ins are
     * EOAs, and making every one of them wait on BSC would put an external
     * dependency in front of the app's login.
     */
    let verified = false;

    try {
      const recovered = await recoverMessageAddress({
        message: challenge.message,
        signature: signatureHex,
      });
      verified = recovered.toLowerCase() === expected.toLowerCase();
    } catch {
      verified = false;
    }

    if (!verified) {
      try {
        verified = await bscPublicClient.verifyMessage({
          address: expected as `0x${string}`,
          message: challenge.message,
          signature: signatureHex,
        });
      } catch {
        verified = false;
      }
    }

    // Single-use regardless of outcome. A failed attempt must not leave a live
    // challenge behind for someone to keep guessing against.
    await ctx.runMutation(internal.walletAuth.deleteNonce, { nonce });

    if (!verified) {
      throw new Error(
        `That signature does not verify as ${expected}. Make sure the wallet that signed is the one being connected.`,
      );
    }

    const token = randomHex(32);
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

    await ctx.runMutation(internal.walletAuth.storeSession, {
      tokenHash: hashSessionToken(token),
      address: expected,
      chainId: BSC_CHAIN_ID,
      issuedAt: new Date(now).toISOString(),
      expiresAt,
    });

    return { token, address: expected, expiresAt };
  },
});

export const deleteNonce = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    const row = await ctx.db
      .query("authNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

export const storeSession = internalMutation({
  args: {
    tokenHash: v.string(),
    address: v.string(),
    chainId: v.number(),
    issuedAt: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, args) => {
    // Drop this address's expired sessions while we are here. Live ones are
    // kept: the same wallet signed in on a second device is a normal thing and
    // signing in on a phone must not silently sign someone out on a laptop.
    const existing = await ctx.db
      .query("walletSessions")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .collect();
    for (const row of existing) {
      if (hasExpired(row.expiresAt)) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.insert("walletSessions", args);
    return null;
  },
});

/* ─────────────────────── session use ─────────────────────── */

/**
 * Who this token belongs to, or null.
 *
 * Public so the client can tell a live session from an expired one without
 * attempting a write and reading the error. It returns only the address and the
 * expiry - never the token, never anything else about the account.
 */
export const currentSession = query({
  args: { sessionToken: v.union(v.string(), v.null()) },
  returns: v.union(
    v.null(),
    v.object({ address: v.string(), expiresAt: v.string() }),
  ),
  handler: async (ctx, { sessionToken }) => {
    if (!sessionToken) return null;

    const row = await ctx.db
      .query("walletSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hashSessionToken(sessionToken)))
      .unique();

    if (!row || hasExpired(row.expiresAt)) return null;
    return { address: row.address, expiresAt: row.expiresAt };
  },
});

export const signOut = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const row = await ctx.db
      .query("walletSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hashSessionToken(sessionToken)))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});
