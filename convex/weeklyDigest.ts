import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { emailConfigured, sendEmail } from "./lib/email";
import { requireWalletAddress } from "./lib/walletAuth";

/**
 * "YOUR TRADERS' WEEK" (owner, 2026-10-14: get people to come back). One plain-text email on Mondays to
 * people who asked for it: each trader they run, its trades that week and its result, practice or real.
 * Lean (owner: careful with read/writes): a weekly cron; per subscriber one indexed read of their drafts
 * and of each trader's last trades. Nothing is sent for a week with no traders.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WEEK_MS = 7 * 86_400_000;
const MAX_SUBSCRIBERS_PER_RUN = 200;

export const subscribe = mutation({
  args: { sessionToken: v.string(), email: v.string() },
  handler: async (ctx, { sessionToken, email }) => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Weekly email")).toLowerCase();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(clean) || clean.length > 200) throw new ConvexError("That email address does not look right.");
    const row = await ctx.db.query("weeklyDigest").withIndex("by_wallet", (q) => q.eq("wallet", wallet)).unique();
    if (row) await ctx.db.patch(row._id, { email: clean });
    else await ctx.db.insert("weeklyDigest", { wallet, email: clean, createdAt: Date.now(), lastSentAt: null });
    return { email: clean };
  },
});

export const unsubscribe = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Weekly email")).toLowerCase();
    const row = await ctx.db.query("weeklyDigest").withIndex("by_wallet", (q) => q.eq("wallet", wallet)).unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/** Whether this wallet gets the email, and to which address (shown masked). */
export const mine = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Weekly email").catch(() => null);
    if (!wallet) return null;
    const row = await ctx.db.query("weeklyDigest").withIndex("by_wallet", (q) => q.eq("wallet", wallet.toLowerCase())).unique();
    if (!row) return { subscribed: false as const, email: null };
    const [name, domain] = row.email.split("@");
    return { subscribed: true as const, email: `${name.slice(0, 2)}…@${domain}` };
  },
});

export const due = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("weeklyDigest").take(MAX_SUBSCRIBERS_PER_RUN),
});

type Line = { name: string; real: boolean; closed: number; won: number; resultUsd: number; running: boolean };

/** One subscriber's traders and what each did in the last 7 days. */
export const weekFor = internalQuery({
  args: { wallet: v.string() },
  handler: async (ctx, { wallet }): Promise<Line[]> => {
    const since = Date.now() - WEEK_MS;
    const drafts = (await ctx.db.query("agentDrafts").withIndex("by_owner", (q) => q.eq("ownerAddress", wallet)).order("desc").take(50)).filter(
      (draft: Doc<"agentDrafts">) => draft.trader,
    );
    const lines: Line[] = [];
    for (const draft of drafts.slice(0, 10)) {
      const trades = await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(60);
      const exits = trades.filter((trade) => trade.at >= since && trade.kind === "exit" && trade.pnlPct !== null);
      lines.push({
        name: draft.name ?? "Trader",
        real: draft.paperMode === false,
        closed: exits.length,
        won: exits.filter((trade) => (trade.pnlPct ?? 0) > 0).length,
        resultUsd: Math.round(exits.reduce((sum, trade) => sum + ((trade.pnlPct ?? 0) * trade.sizeUsd) / 100, 0) * 100) / 100,
        running: Boolean(draft.autopilot?.on),
      });
    }
    return lines;
  },
});

export const markSent = internalMutation({
  args: { id: v.id("weeklyDigest") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastSentAt: Date.now() });
  },
});

function money(usd: number): string {
  return `${usd > 0 ? "+" : usd < 0 ? "-" : ""}$${Math.abs(usd).toFixed(2)}`;
}

/** The email, plain text like every other Dolphin email (healthAlerts.ts). */
export function digestText(lines: Line[]): string {
  const rows = lines.map((line) => {
    const what = line.closed === 0 ? "no closed trades" : `${line.closed} closed, ${line.won} won, ${money(line.resultUsd)}`;
    return `- ${line.name} (${line.real ? "real money" : "practice"}${line.running ? "" : ", stopped"}): ${what}`;
  });
  return [
    "Here's what your traders did this week.",
    "",
    ...rows,
    "",
    "Quiet weeks are normal: a trader only acts when its rule is met.",
    "See every trade: https://www.dolphinamp.xyz/trade?ref=email-weekly#my-traders",
    "Test a new strategy: https://www.dolphinamp.xyz/test?ref=email-weekly",
    "",
    "Past results don't predict what happens next. Not financial advice.",
    "To stop these emails, open Your traders on Dolphin and turn the weekly email off.",
  ].join("\n");
}

export const send = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number }> => {
    if (!emailConfigured()) return { sent: 0, skipped: 0 };
    const subscribers: Doc<"weeklyDigest">[] = await ctx.runQuery(internal.weeklyDigest.due, {});
    let sent = 0;
    let skipped = 0;
    for (const row of subscribers) {
      if (row.lastSentAt && Date.now() - row.lastSentAt < WEEK_MS - 3_600_000) {
        skipped++;
        continue;
      }
      const lines: Line[] = await ctx.runQuery(internal.weeklyDigest.weekFor, { wallet: row.wallet });
      if (lines.length === 0) {
        skipped++;
        continue;
      }
      const total = lines.reduce((sum, line) => sum + line.resultUsd, 0);
      const result = await sendEmail({
        to: row.email,
        subject: lines.some((line) => line.closed > 0) ? `Your traders this week: ${money(Math.round(total * 100) / 100)}` : "Your traders this week",
        text: digestText(lines),
      });
      if (result.ok) {
        sent++;
        await ctx.runMutation(internal.weeklyDigest.markSent, { id: row._id });
      } else skipped++;
    }
    return { sent, skipped };
  },
});
