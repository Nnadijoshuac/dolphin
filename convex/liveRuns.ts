/**
 * PUBLIC RUNS (owner, 2026-10-18): "$6 → ?". Anyone can make an agent's run public: it trades its Dolphin
 * Wallet's real money and the whole thing is watchable at /live/<slug> until the wallet runs out or its
 * owner ends the run. No finish line and no time limit (owner, 2026-10-18: the global $100 target is gone).
 *
 * Every number is read from the chain, never typed in: `start` values the wallet before anything is
 * written, and `tick` (every 5 minutes, crons.ts) values it again, keeps a small history, copies the
 * engine's latest decisions, and ends the run - switching the agent's autopilot off - when the wallet falls
 * to the floor. The trading engine itself (strategy.ts) is not touched.
 */

import { ConvexError, v } from "convex/values";
import { erc20Abi, getAddress, isAddress, type Address } from "viem";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { bscPublicClient } from "./lib/bscClient";
import { describeRule, type Rule, type RuleState } from "./lib/strategy";
import { verifiedTokens } from "./lib/tradeTokens";
import { requireWalletAddress } from "./lib/walletAuth";

const FLOOR_USD = 0;
/** Below this the wallet cannot pay for a swap and its gas: the run is over. */
const DUST_USD = 0.5;
const HISTORY_CAP = 1500;
const THOUGHTS_CAP = 40;

/* ── valuing a wallet, from the chain ─────────────────────────────────────── */

const STABLE = new Set(["USDT", "USDC", "FDUSD", "U"]);
const PAIR: Record<string, string> = { BNB: "BNBUSDT", WBNB: "BNBUSDT", BTCB: "BTCUSDT", ETH: "ETHUSDT", CAKE: "CAKEUSDT", XVS: "XVSUSDT" };

/** Everything the wallet holds on Dolphin's verified list, in dollars. Throws rather than guess. */
async function walletUsd(wallet: string): Promise<number> {
  const owner = getAddress(wallet) as Address;
  const tokens = verifiedTokens();
  const raws = await Promise.all(
    tokens.map((token) =>
      token.address === null
        ? bscPublicClient.getBalance({ address: owner })
        : bscPublicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    ),
  );
  const held = tokens.map((token, index) => ({ token, amount: Number(raws[index]) / 10 ** token.decimals })).filter((h) => h.amount > 0);
  const pairs = [...new Set(held.filter((h) => !STABLE.has(h.token.symbol)).map((h) => PAIR[h.token.symbol]).filter(Boolean))];
  const prices = new Map<string, number>();
  if (pairs.length) {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(pairs))}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Binance answered ${response.status} for prices.`);
    for (const row of (await response.json()) as { symbol: string; price: string }[]) prices.set(row.symbol, Number(row.price));
  }
  let usd = 0;
  for (const { token, amount } of held) {
    if (STABLE.has(token.symbol)) usd += amount;
    else {
      const price = prices.get(PAIR[token.symbol] ?? "");
      if (price === undefined) throw new Error(`No price for ${token.symbol}.`);
      usd += amount * price;
    }
  }
  return Math.round(usd * 100) / 100;
}

/* ── starting and ending ──────────────────────────────────────────────────── */

async function draftForKey(ctx: QueryCtx, conversationKey: string) {
  const conversation = await ctx.db.query("dolphinConversations").withIndex("by_key", (q) => q.eq("conversationKey", conversationKey)).unique();
  if (!conversation || (conversation.mode ?? "chat") !== "build") return null;
  return ctx.db.query("agentDrafts").withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id)).unique();
}

/** Who may start a run of this agent, and with which wallet. Throws the reason in plain words. */
export const prepare = internalQuery({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }) => {
    const owner = await requireWalletAddress(ctx, sessionToken, "Going live");
    const draft = await draftForKey(ctx, conversationKey);
    if (!draft) throw new ConvexError("That agent was not found.");
    if ((draft.ownerAddress ?? "").toLowerCase() !== owner.toLowerCase()) throw new ConvexError("Only the agent's owner can make its run public.");
    if (!(draft.rules ?? []).length) throw new ConvexError("This agent has no trading rule yet.");
    if (draft.paperMode !== false) throw new ConvexError("Switch the agent's Trading mode to Live first: a public run trades real money.");
    if (!draft.autopilot?.on) throw new ConvexError("Switch the agent's Autopilot on first.");
    const running = await ctx.db.query("liveRuns").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).collect();
    if (running.some((run) => run.status === "running")) throw new ConvexError("This agent is already live.");
    const keys = await ctx.db.query("agentTradeKeys").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(5);
    const key = keys.find((row) => row.status === "active" && row.expiry * 1000 > Date.now());
    if (!key) throw new ConvexError("The agent has no active trade key, so it cannot trade. Grant one in its panel first.");
    return { draftId: draft._id, owner, walletAddress: key.altanaWalletAddress, name: draft.name ?? "Untitled agent" };
  },
});

export const create = internalMutation({
  args: {
    slug: v.string(),
    draftId: v.id("agentDrafts"),
    conversationKey: v.string(),
    ownerAddress: v.string(),
    walletAddress: v.string(),
    name: v.string(),
    startUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("liveRuns", {
      ...args,
      floorUsd: FLOOR_USD,
      startedAt: now,
      status: "running",
      endedAt: null,
      lastUsd: args.startUsd,
      lastValuedAt: now,
      history: [{ t: now, usd: args.startUsd }],
      thoughts: [],
    });
  },
});

/** Makes an agent's run public, starting from the wallet's value read now. */
export const start = action({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }): Promise<{ slug: string; startUsd: number }> => {
    const prep: { draftId: Id<"agentDrafts">; owner: string; walletAddress: string; name: string } = await ctx.runQuery(internal.liveRuns.prepare, {
      sessionToken,
      conversationKey,
    });
    if (!isAddress(prep.walletAddress, { strict: false })) throw new ConvexError("The agent's wallet address is not valid.");
    const startUsd = await walletUsd(prep.walletAddress);
    if (startUsd <= DUST_USD) throw new ConvexError(`The wallet holds $${startUsd.toFixed(2)}. Fund it first.`);
    const slug = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
    await ctx.runMutation(internal.liveRuns.create, {
      slug,
      draftId: prep.draftId,
      conversationKey,
      ownerAddress: prep.owner,
      walletAddress: prep.walletAddress,
      name: prep.name,
      startUsd,
    });
    return { slug, startUsd };
  },
});

/** The owner ends a run early. The agent keeps its autopilot; only the public run ends. */
export const end = mutation({
  args: { sessionToken: v.string(), slug: v.string() },
  handler: async (ctx, { sessionToken, slug }) => {
    const owner = await requireWalletAddress(ctx, sessionToken, "Ending a run");
    const run = await ctx.db.query("liveRuns").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!run || run.ownerAddress.toLowerCase() !== owner.toLowerCase()) throw new ConvexError("That run is not yours.");
    if (run.status === "running") await ctx.db.patch(run._id, { status: "ended", endedAt: Date.now() });
  },
});

/* ── the 5-minute check ───────────────────────────────────────────────────── */

export const runningRuns = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("liveRuns").withIndex("by_status_started", (q) => q.eq("status", "running")).take(50),
});

export const engineState = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const rows = await ctx.db.query("strategyRuns").withIndex("by_draft_rule", (q) => q.eq("draftId", draftId)).take(20);
    return rows.map((row) => ({ lastCheckedAt: row.lastCheckedAt, reason: row.lastReason ?? row.lastError ?? null }));
  },
});

export const record = internalMutation({
  args: { runId: v.id("liveRuns"), usd: v.number(), at: v.number(), reasons: v.array(v.string()) },
  handler: async (ctx, { runId, usd, at, reasons }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return;
    const agent = await ctx.db.get(run.draftId);
    const stopped = !agent?.autopilot?.on;
    const last = run.history[run.history.length - 1];
    const history =
      !last || Math.abs(usd - last.usd) / Math.max(last.usd, 0.01) >= 0.005 || at - last.t >= 3_600_000
        ? [...run.history, { t: at, usd }].slice(-HISTORY_CAP)
        : run.history;
    let thoughts = run.thoughts;
    for (const text of reasons) {
      if (!thoughts.some((thought) => thought.text === text)) thoughts = [...thoughts, { t: at, text }].slice(-THOUGHTS_CAP);
    }
    const status = usd <= Math.max(run.floorUsd, DUST_USD) ? "lost" : stopped ? "ended" : "running";
    await ctx.db.patch(run._id, { lastUsd: usd, lastValuedAt: at, history, thoughts, status, endedAt: status === "running" ? null : at });
    if (status !== "running") {
      // The run is over: the agent stops opening trades. Its owner can switch it back on.
      const draft = await ctx.db.get(run.draftId);
      if (draft?.autopilot?.on) await ctx.db.patch(draft._id, { autopilot: { ...draft.autopilot, on: false } });
    }
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const runs: Doc<"liveRuns">[] = await ctx.runQuery(internal.liveRuns.runningRuns, {});
    for (const run of runs) {
      try {
        const usd = await walletUsd(run.walletAddress);
        const engine: { lastCheckedAt: number; reason: string | null }[] = await ctx.runQuery(internal.liveRuns.engineState, { draftId: run.draftId });
        const reasons = engine.filter((row) => row.lastCheckedAt > run.lastValuedAt - 300_000 && row.reason).map((row) => row.reason as string);
        await ctx.runMutation(internal.liveRuns.record, { runId: run._id, usd, at: Date.now(), reasons });
      } catch (cause) {
        // One unreadable wallet or price never ends a run; the next check tries again.
        console.warn(`liveRuns.tick ${run.slug}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  },
});

/* ── what anyone can see ──────────────────────────────────────────────────── */

function summary(run: Doc<"liveRuns">, market: string | null) {
  return {
    slug: run.slug,
    name: run.name,
    ownerAddress: run.ownerAddress,
    walletAddress: run.walletAddress,
    market,
    startUsd: run.startUsd,
    floorUsd: run.floorUsd,
    lastUsd: run.lastUsd,
    lastValuedAt: run.lastValuedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
  };
}

async function marketOf(ctx: QueryCtx, draftId: Id<"agentDrafts">): Promise<string | null> {
  const draft = await ctx.db.get(draftId);
  const rule = (draft?.rules ?? [])[0] as Rule | undefined;
  return rule?.market ?? null;
}

/** Runs live now, newest first, and the last few that finished. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db.query("liveRuns").withIndex("by_status_started", (q) => q.eq("status", "running")).order("desc").take(20);
    const finished = [
      ...(await ctx.db.query("liveRuns").withIndex("by_status_started", (q) => q.eq("status", "lost")).order("desc").take(5)),
      ...(await ctx.db.query("liveRuns").withIndex("by_status_started", (q) => q.eq("status", "ended")).order("desc").take(5)),
    ].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    return {
      running: await Promise.all(running.map(async (run) => summary(run, await marketOf(ctx, run.draftId)))),
      finished: await Promise.all(finished.slice(0, 8).map(async (run) => summary(run, await marketOf(ctx, run.draftId)))),
    };
  },
});

/** One run in full: the money, its rules, what it is thinking, and every trade since it went live. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const run = await ctx.db.query("liveRuns").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!run) return null;
    const draft = await ctx.db.get(run.draftId);
    const rules = ((draft?.rules ?? []) as Rule[]).slice(0, 6);
    const states = await ctx.db.query("strategyRuns").withIndex("by_draft_rule", (q) => q.eq("draftId", run.draftId)).take(20);
    const runTrades = await ctx.db
      .query("strategyTrades")
      .withIndex("by_draft", (q) => q.eq("draftId", run.draftId).gte("at", run.startedAt))
      .order("desc")
      .take(1000);
    // A run can start while a position is open. Its first trade is then a sell, so the buy that opened
    // it (made before the run started) is shown too - otherwise the page shows a sale of nothing.
    const oldest = runTrades[runTrades.length - 1];
    if (oldest && oldest.kind === "exit") {
      const opener = await ctx.db
        .query("strategyTrades")
        .withIndex("by_draft", (q) => q.eq("draftId", run.draftId).lt("at", run.startedAt))
        .order("desc")
        .filter((q) => q.and(q.eq(q.field("kind"), "enter"), q.eq(q.field("ruleId"), oldest.ruleId)))
        .first();
      if (opener) runTrades.push(opener);
    }
    const trades = runTrades.slice(0, 60);
    const closed = runTrades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
    // The engine's minute clock: the next run it has booked. It looks at the market every minute, but
    // writes a decision only once per closed candle, so this - not lastCheckedAt - is its pulse.
    const clock = await ctx.db.query("strategyClock").withIndex("by_key", (q) => q.eq("key", "main")).unique();
    return {
      ...summary(run, rules[0]?.market ?? null),
      timeframe: rules[0]?.timeframe ?? null,
      watching: Boolean(draft?.autopilot?.on),
      nextLookAt: clock?.nextAt ?? null,
      rules: rules.map((rule) => describeRule(rule)),
      history: run.history,
      thoughts: [...run.thoughts].reverse(),
      tradeCount: runTrades.length,
      closedCount: closed.length,
      winCount: closed.filter((trade) => (trade.pnlPct ?? 0) > 0).length,
      engine: states.map((row) => ({
        lastCheckedAt: row.lastCheckedAt,
        reason: row.lastReason ?? row.lastError ?? null,
        position: ((row.state as RuleState | null)?.position ?? null) as RuleState["position"],
      })),
      // Each rule's own numbers and live state, so the page can show how far the market is from its
      // trigger, how much of its daily cap is used, and where its stop and target sit.
      desk: rules.map((rule) => {
        const row = states.find((state) => state.ruleId === rule.id);
        const state = (row?.state ?? null) as RuleState | null;
        const today = new Date().toISOString().slice(0, 10);
        return {
          id: rule.id,
          name: rule.name,
          timeframe: rule.timeframe,
          when: rule.when,
          until: rule.until,
          stopLossPct: rule.stopLossPct,
          takeProfitPct: rule.takeProfitPct,
          sizeUsd: rule.sizeUsd,
          maxTradesPerDay: rule.maxTradesPerDay,
          cooldownMinutes: rule.cooldownMinutes,
          tradesToday: state && state.tradesDay === today ? state.tradesToday : 0,
          lastTradeAt: state?.lastTradeAt ?? null,
          lastCheckedAt: row?.lastCheckedAt ?? null,
          reason: row?.lastReason ?? row?.lastError ?? null,
          position: state?.position ?? null,
        };
      }),
      trades: trades.map((trade) => ({
        at: trade.at,
        kind: trade.kind,
        side: trade.side,
        market: trade.market,
        price: trade.price,
        sizeUsd: trade.sizeUsd,
        pnlPct: trade.pnlPct,
        paper: trade.paper,
        reason: trade.reason,
        // A Dolphin Wallet swap keeps its transaction hash as orderId (strategy.ts executeRule).
        txHash: trade.txHash ?? (trade.network === "bsc" && /^0x[0-9a-fA-F]{64}$/.test(trade.orderId ?? "") ? trade.orderId! : null),
      })),
    };
  },
});

/** A wallet's value as a run would see it - for checking a wallet before going live (internal). */
export const valueWallet = internalAction({
  args: { wallet: v.string() },
  handler: async (_ctx, { wallet }): Promise<number> => walletUsd(wallet),
});
