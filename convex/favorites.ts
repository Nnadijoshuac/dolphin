/**
 * FAVORITES: agents a signed-in wallet starred (2026-09-28).
 *
 * The owner's spec: the star exists only for a connected wallet, a favorite
 * ranks higher FOR THAT PERSON, and the stars are data - "favorited vs actually
 * used" is the question they want answered. See the note on `agentFavorites` in
 * schema.ts for why a star never touches an agent's public rank.
 *
 * The wallet always comes from the session token (lib/walletAuth.ts), never
 * from an argument, so nobody can star on someone else's behalf.
 */

import { ConvexError, v } from "convex/values";

import { query, mutation } from "./_generated/server";
import { toPublicAgent } from "./lib/publicAgent";
import { requireWalletAddress } from "./lib/walletAuth";
import { coerceAgentKey } from "./model/agent";

/** More than anyone browsing a catalog this size will star; a ceiling on a public write. */
export const MAX_FAVORITES_PER_WALLET = 200;
/** How many starred agents the "Your favorites" shelf resolves. */
const SHELF_AGENTS = 24;

/** Idempotent: starring twice keeps one row, un-starring nothing is a no-op. */
export const set = mutation({
  args: { sessionToken: v.string(), agentKey: v.string(), favorite: v.boolean() },
  handler: async (ctx, args): Promise<{ favorite: boolean }> => {
    const walletAddress = await requireWalletAddress(ctx, args.sessionToken, "favorites.set");
    const agentKey = coerceAgentKey(args.agentKey);
    if (!agentKey) throw new ConvexError("That is not an agent.");

    const existing = await ctx.db
      .query("agentFavorites")
      .withIndex("by_wallet_agent", (q) => q.eq("walletAddress", walletAddress).eq("agentKey", agentKey))
      .unique();

    if (!args.favorite) {
      if (existing) await ctx.db.delete(existing._id);
      return { favorite: false };
    }
    if (existing) return { favorite: true };

    // Only catalog agents, so the table cannot be filled with invented keys.
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique();
    if (!agent) throw new ConvexError("That agent is not in the catalog.");

    const count = (
      await ctx.db
        .query("agentFavorites")
        .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
        .take(MAX_FAVORITES_PER_WALLET)
    ).length;
    if (count >= MAX_FAVORITES_PER_WALLET) {
      throw new ConvexError(`You can keep up to ${MAX_FAVORITES_PER_WALLET} favorites. Remove one first.`);
    }

    await ctx.db.insert("agentFavorites", {
      walletAddress,
      agentKey,
      createdAt: new Date().toISOString(),
    });
    return { favorite: true };
  },
});

/**
 * The signed-in wallet's favorites, newest first: every key (for the stars)
 * and the live agents among them (for the shelf).
 *
 * A null or dead token is an ordinary answer - nothing starred - rather than a
 * throw, because this runs on every Discover render for anyone connected.
 */
export const mine = query({
  args: { sessionToken: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken }) => {
    if (!sessionToken) return { agentKeys: [], agents: [] };
    let walletAddress: string;
    try {
      walletAddress = await requireWalletAddress(ctx, sessionToken, "favorites.mine");
    } catch {
      return { agentKeys: [], agents: [] };
    }

    const rows = await ctx.db
      .query("agentFavorites")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .order("desc")
      .take(MAX_FAVORITES_PER_WALLET);

    const agents = [];
    for (const row of rows) {
      if (agents.length >= SHELF_AGENTS) break;
      const agent = await ctx.db
        .query("agents")
        .withIndex("by_key", (q) => q.eq("agentKey", row.agentKey))
        .unique();
      // A delisted favorite keeps its star (it may come back) but leaves the shelf.
      if (agent && agent.status === "live") agents.push(toPublicAgent(agent));
    }

    return { agentKeys: rows.map((row) => row.agentKey), agents };
  },
});
