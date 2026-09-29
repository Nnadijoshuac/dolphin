/**
 * MY AGENTS - the agents a wallet BUILT, with what each is doing right now.
 * (2026-09-29, for the My Agents page. Hires already have their own query.)
 *
 * One call per page view, gated by the sign-in session: drafts are private
 * (a draft's conversation key is its capability), so a wallet sees only its
 * own. Capped at MAX_DRAFTS, and every per-draft read is an index range with
 * a small `take`, so the cost is bounded whatever the owner has built.
 *
 * Every field is read, none estimated: whether it is published and how, the
 * trade key's real status and expiry, when its trigger runs next, and how many
 * practice trades it has made. No P&L - that would need prices at read time,
 * and a number shown here must be one Dolphin actually measured.
 */
import { v } from "convex/values";
import { getAddress, isAddress } from "viem";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireWalletAddress } from "./lib/walletAuth";

const MAX_DRAFTS = 12;

/** The symbols of the allowances recorded on a trade key; empty when unreadable. */
function spendSymbols(permissionsJson: string): string[] {
  try {
    const parsed = JSON.parse(permissionsJson) as { approvals?: { symbol?: unknown }[] };
    return [...new Set((parsed.approvals ?? []).map((approval) => String(approval.symbol ?? "")).filter(Boolean))].slice(0, 6);
  } catch {
    return [];
  }
}
const TRADE_COUNT_CAP = 50;

export const built = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const owner = await requireWalletAddress(ctx, sessionToken, "myAgents.built");

    // Drafts store the owner as the client wrote it; read each spelling (at most three ranges).
    const spellings = new Set([owner, owner.toLowerCase()]);
    if (isAddress(owner, { strict: false })) spellings.add(getAddress(owner));
    const byId = new Map<string, Doc<"agentDrafts">>();
    for (const spelling of spellings) {
      const rows = await ctx.db
        .query("agentDrafts")
        .withIndex("by_owner", (q) => q.eq("ownerAddress", spelling))
        .order("desc")
        .take(MAX_DRAFTS);
      for (const row of rows) byId.set(row._id, row);
    }
    const drafts = [...byId.values()]
      // Nothing to show for a conversation that never produced an agent.
      .filter((draft) => Boolean(draft.name?.trim()))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DRAFTS);

    const nowSec = Date.now() / 1000;
    return Promise.all(
      drafts.map(async (draft) => {
        const conversation = await ctx.db.get(draft.conversationId);
        const listings = await ctx.db
          .query("builtAgents")
          .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
          .take(4);
        const listing =
          listings.find((row) => row.status === "registered" && row.network === "bsc") ??
          listings.find((row) => row.status === "registered") ??
          null;
        const keys = await ctx.db
          .query("agentTradeKeys")
          .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
          .order("desc")
          .take(3);
        const key = keys.find((row) => row.status !== "pending") ?? null;
        const triggers = await ctx.db
          .query("agentTriggers")
          .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
          .take(10);
        const nextRunAt = triggers.reduce<number | null>(
          (soonest, trigger) => (soonest === null || trigger.nextRunAt < soonest ? trigger.nextRunAt : soonest),
          null,
        );
        const trades = await ctx.db
          .query("paperTrades")
          .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
          .order("desc")
          .take(TRADE_COUNT_CAP);

        return {
          conversationKey: conversation?.conversationKey ?? null,
          name: draft.name ?? "Untitled agent",
          description: draft.description ?? null,
          updatedAt: draft.updatedAt,
          paperMode: draft.paperMode !== false,
          published: listing
            ? {
                hash: listing.hash,
                visibility: listing.purpose === "private" ? ("private" as const) : ("public" as const),
                priceUsd: listing.hirePriceUsd ?? null,
                network: listing.network,
              }
            : null,
          trading: key
            ? {
                status: key.status === "active" && key.expiry <= nowSec ? ("expired" as const) : key.status,
                expiresAt: key.expiry * 1000,
                // Which tokens the key may spend - the allowances the owner approved at grant time.
                spends: spendSymbols(key.permissionsJson),
              }
            : null,
          nextRunAt,
          practiceTrades: trades.length,
          practiceTradesCapped: trades.length >= TRADE_COUNT_CAP,
          lastTradeAt: trades[0]?.at ?? null,
        };
      }),
    );
  },
});
