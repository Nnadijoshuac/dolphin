/**
 * ENVIRONMENT VARIABLES: a wallet's own API keys and secrets. (2026-09-28)
 *
 * The owner's direction: nobody's agent runs on Dolphin's free model - each
 * builder brings their own keys, and manages them beside the draft. These are
 * those keys, kept like a hosting provider keeps env vars: write-only from the
 * browser's point of view.
 *
 *  - The value is encrypted (AES-256-GCM, random 96-bit IV per write) in an
 *    ACTION, under DOLPHIN_ENV_KEY - a 32-byte deployment secret that lives in
 *    the Convex dashboard, never in this repo. A dump of the table is useless
 *    without it.
 *  - No public function returns a value. `list` gives names, times and the
 *    last four characters. Decryption is internal only, for the agent runtime.
 *  - Every write is authenticated by the session token (lib/walletAuth.ts);
 *    the wallet is never an argument.
 */

import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { open, seal } from "./lib/secretBox";
import { requireWalletAddress } from "./lib/walletAuth";

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_VALUE_CHARS = 4_000;
export const MAX_VARS_PER_WALLET = 50;

/** The session's wallet, for actions (which have no db of their own). */
export const walletFor = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => requireWalletAddress(ctx, sessionToken, "Environment variables"),
});

/** Names and hints for the signed-in wallet. Never a value. */
export const list = query({
  args: { sessionToken: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken }) => {
    if (!sessionToken) return [];
    let walletAddress: string;
    try {
      walletAddress = await requireWalletAddress(ctx, sessionToken, "Environment variables");
    } catch {
      return [];
    }
    const rows = await ctx.db
      .query("userEnvVars")
      .withIndex("by_wallet_name", (q) => q.eq("walletAddress", walletAddress))
      .take(MAX_VARS_PER_WALLET);
    return rows.map((row) => ({ name: row.name, last4: row.last4, updatedAt: row.updatedAt }));
  },
});

/** Creates or replaces a variable. The value is encrypted before it is stored. */
export const set = action({
  args: { sessionToken: v.string(), name: v.string(), value: v.string() },
  handler: async (ctx, args): Promise<{ name: string; last4: string }> => {
    const walletAddress: string = await ctx.runQuery(internal.envVars.walletFor, { sessionToken: args.sessionToken });
    const name = args.name.trim().toUpperCase();
    if (!NAME_PATTERN.test(name)) {
      throw new ConvexError("Use a name like OPENAI_API_KEY: capital letters, digits and underscores, starting with a letter.");
    }
    const value = args.value.trim();
    if (value.length === 0) throw new ConvexError("The value is empty.");
    if (value.length > MAX_VALUE_CHARS) throw new ConvexError(`Values are limited to ${MAX_VALUE_CHARS} characters.`);

    const box = await seal(value);
    const last4 = value.length > 8 ? value.slice(-4) : "";
    await ctx.runMutation(internal.envVars.store, { walletAddress, name, ...box, last4 });
    return { name, last4 };
  },
});

export const store = internalMutation({
  args: { walletAddress: v.string(), name: v.string(), ciphertext: v.string(), iv: v.string(), last4: v.string() },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("userEnvVars")
      .withIndex("by_wallet_name", (q) => q.eq("walletAddress", args.walletAddress).eq("name", args.name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ciphertext: args.ciphertext, iv: args.iv, last4: args.last4, updatedAt: now });
      return;
    }
    const count = (
      await ctx.db
        .query("userEnvVars")
        .withIndex("by_wallet_name", (q) => q.eq("walletAddress", args.walletAddress))
        .take(MAX_VARS_PER_WALLET)
    ).length;
    if (count >= MAX_VARS_PER_WALLET) {
      throw new ConvexError(`You can keep up to ${MAX_VARS_PER_WALLET} variables. Remove one first.`);
    }
    await ctx.db.insert("userEnvVars", { ...args, createdAt: now, updatedAt: now });
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), name: v.string() },
  handler: async (ctx, { sessionToken, name }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Environment variables");
    const row = await ctx.db
      .query("userEnvVars")
      .withIndex("by_wallet_name", (q) => q.eq("walletAddress", walletAddress).eq("name", name))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

export const sealedFor = internalQuery({
  args: { walletAddress: v.string(), name: v.string() },
  handler: async (ctx, { walletAddress, name }) =>
    ctx.db
      .query("userEnvVars")
      .withIndex("by_wallet_name", (q) => q.eq("walletAddress", walletAddress).eq("name", name))
      .unique(),
});

/**
 * A variable's value, for the agent runtime only. Internal: no client can
 * call it, and nothing that calls it may return the value to one.
 */
export const reveal = internalAction({
  args: { walletAddress: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const row = await ctx.runQuery(internal.envVars.sealedFor, args);
    if (!row) return null;
    return open({ ciphertext: row.ciphertext, iv: row.iv });
  },
});
