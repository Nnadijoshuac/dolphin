import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { apiBase } from "./builtAgents";
import { ensureDraft } from "./knowledge";
import { activeBlocks, validateBlocks, type AgentBlock, type BinanceConfig } from "./lib/agentBlocks";
import { closedCandles, historyCandles, MarketDataError } from "./lib/binanceMarket";
import { checkConnection, closePosition, openPosition, type ConnectionReport, type Held } from "./lib/binanceTrade";
import { DOLPHIN_SWAP_GAS_USD, GRID_TIMEFRAME, gridTagOf, planGrid, simulateGrid } from "./lib/grid";
import { RULE_TEMPLATES } from "./lib/ruleTemplates";
import { requireWalletAddress } from "./lib/walletAuth";
import { verifiedTokenBySymbol } from "./lib/tradeTokens";
import { afterCandle, cleanRule, decide, describeLocked, describeRule, EMPTY_STATE, redactReason, resultPct, resultUsd, simulate, TIMEFRAME_MS, TIMEFRAMES, VENUE_FEE_BPS, venueProblem, type Candle, type LossGuard, type Rule, type RuleState, type SimResult } from "./lib/strategy";

/**
 * TRADING RULES, RUN WITH NO AI (owner, 2026-10-03; Agent/PLAN-2026-10-03-fast-rules-binance-export.md, phase 2).
 *
 * The build chat writes rules (lib/strategy.ts, checked by cleanRule); while
 * autopilot is on, `tick` judges every newly CLOSED candle of each rule's
 * market against it - no model call - and records what it did. Inside Dolphin
 * this is PAPER trading at live Binance prices: real money moves only through
 * the Binance block and a runner on the builder's own server (phases 3-4).
 */

export const MAX_RULES = 5;

async function draftOfKey(ctx: QueryCtx, conversationKey: string): Promise<Doc<"agentDrafts"> | null> {
  const conversation = await ctx.db
    .query("dolphinConversations")
    .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
    .unique();
  if (!conversation || (conversation.mode ?? "chat") !== "build") return null;
  return ctx.db
    .query("agentDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
    .unique();
}

function rulesOf(draft: Doc<"agentDrafts"> | null): Rule[] {
  return ((draft?.rules ?? []) as Rule[]).filter((rule) => rule && typeof rule.id === "string");
}

/** The draft's Binance block (phase 3), if it has one plugged in on the canvas. */
function binanceOf(draft: Pick<Doc<"agentDrafts">, "blocks" | "detached"> | null): BinanceConfig | null {
  const block = activeBlocks((draft?.blocks ?? []) as AgentBlock[], draft?.detached).find((candidate) => candidate.type === "binance");
  return block && block.type === "binance" ? block.config : null;
}

/** How many rules an agent holds, a grid counted once - the MAX_RULES budget. */
function slotsUsed(rules: Rule[]): number {
  return rules.filter((rule) => !rule.grid).length + new Set(rules.filter((rule) => rule.grid).map((rule) => rule.grid!.id)).size;
}

function newRuleId(): string {
  return `rule-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Rules the build chat wrote, each checked; a rule with the same market,
 * timeframe and action replaces the old one (an update, not a duplicate).
 * Problems and warnings come back in words for the reply.
 */
export const addRules = internalMutation({
  args: { conversationId: v.id("dolphinConversations"), rules: v.array(v.any()) },
  handler: async (ctx, { conversationId, rules }) => addRulesTo(ctx, conversationId, rules),
});

/** One path for every new rule - the build chat's and a template's - so every one passes the same checks. */
async function addRulesTo(ctx: MutationCtx, conversationId: Id<"dolphinConversations">, rules: unknown[]): Promise<{ added: string[]; problems: string[]; warnings: string[] }> {
  {
    // A first message that only asks for a rule still has a draft to hold it (as documents do).
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return { added: [], problems: ["the conversation is gone"], warnings: [] };
    const draft = await ctx.db.get(await ensureDraft(ctx, conversation));
    if (!draft) return { added: [], problems: ["the draft could not be made"], warnings: [] };
    let current = rulesOf(draft);
    const added: string[] = [];
    const problems: string[] = [];
    const warnings: string[] = [];
    let blocks = (draft.blocks ?? []) as AgentBlock[];
    let binance = binanceOf(draft);
    const gridRaw = rules.some((raw) => gridTagOf(raw));
    for (const raw of rules.slice(0, gridRaw ? rules.length : MAX_RULES)) {
      const tag = gridTagOf(raw);
      // A grid level replaces only the same level of the same grid; any other rule, one with the same market, timeframe and action.
      const same = tag
        ? current.find((rule) => rule.grid?.id === tag.id && rule.grid.level === tag.level)
        : current.find(
            (rule) => !rule.grid && rule.market === String((raw as { market?: unknown }).market ?? "").trim() && rule.timeframe === (raw as { timeframe?: unknown }).timeframe && rule.action === (raw as { action?: unknown }).action,
          );
      const cleaned = cleanRule(raw, same?.id ?? newRuleId());
      const made = "problems" in cleaned || !tag ? cleaned : { ...cleaned, rule: { ...cleaned.rule, grid: tag } };
      if ("problems" in made) {
        problems.push(`a rule (${made.problems.join("; ")})`);
        // What the model actually wrote, for whoever tunes the prompt or the checker.
        console.warn("[strategy] rule refused:", made.problems, JSON.stringify(raw).slice(0, 1_500));
        continue;
      }
      const joinsGrid = tag && current.some((rule) => rule.grid?.id === tag.id);
      if (!same && !joinsGrid && slotsUsed(current) >= MAX_RULES) {
        problems.push(`a rule (an agent holds at most ${MAX_RULES})`);
        continue;
      }
      // A rule that trades on Binance brings its Binance block when there is none yet (phase 3).
      if (made.rule.venue !== "dolphin-wallet" && !binance) {
        binance = {
          account: made.rule.venue === "binance-wallet" ? "wallet" : "exchange",
          futures: made.rule.venue === "binance-futures",
          // The rule's own leverage, never more: the default is 1x (owner, 2026-10-03).
          maxLeverage: made.rule.venue === "binance-futures" ? made.rule.leverage : 1,
        };
        blocks = [...blocks, { id: `binance-${Math.random().toString(36).slice(2, 8)}`, type: "binance", config: binance }];
      }
      const misfit = venueProblem(made.rule, binance);
      if (misfit) {
        problems.push(`a rule (${misfit})`);
        continue;
      }
      current = same ? current.map((rule) => (rule.id === same.id ? made.rule : rule)) : [...current, made.rule];
      added.push(made.rule.name);
      warnings.push(...made.warnings);
    }
    if (added.length > 0) await ctx.db.patch(draft._id, { rules: current, blocks: validateBlocks(blocks), updatedAt: Date.now() });
    return { added, problems, warnings };
  }
}

/** The strategy templates, for the picker (lib/ruleTemplates.ts). No results: the person backtests their own pick. */
export const templates = query({
  args: {},
  handler: async () => RULE_TEMPLATES.map(({ id, name, idea, timeframe, stopLossPct, takeProfitPct }) => ({ id, name, idea, timeframe, stopLossPct, takeProfitPct })),
});

/**
 * Adds a strategy template to an agent as a rule, on the market, venue and size the person picked.
 * It goes through the same checks as a rule the build chat writes, and starts on paper like any rule.
 */
export const addTemplate = mutation({
  args: {
    conversationKey: v.string(),
    templateId: v.string(),
    market: v.string(),
    venue: v.union(v.literal("dolphin-wallet"), v.literal("binance-spot")),
    sizeUsd: v.number(),
  },
  handler: async (ctx, { conversationKey, templateId, market, venue, sizeUsd }) => {
    const template = RULE_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) throw new ConvexError("That template is not on the list.");
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation || (conversation.mode ?? "chat") !== "build") throw new ConvexError("Templates are added to an agent you are building.");
    const result = await addRulesTo(ctx, conversation._id, [
      {
        name: template.name,
        venue,
        market,
        timeframe: template.timeframe,
        action: "buy",
        sizeUsd,
        when: template.when,
        until: template.until,
        stopLossPct: template.stopLossPct,
        takeProfitPct: template.takeProfitPct,
        leverage: 1,
        maxTradesPerDay: 2,
        cooldownMinutes: 0,
      },
    ]);
    if (result.problems.length > 0) throw new ConvexError(`Could not add it: ${result.problems.join("; ")}.`);
    return result;
  },
});

const gridArgs = {
  market: v.string(),
  venue: v.union(v.literal("dolphin-wallet"), v.literal("binance-spot")),
  lower: v.number(),
  upper: v.number(),
  levels: v.number(),
  totalUsd: v.number(),
  stopBelowPct: v.union(v.number(), v.null()),
};

/**
 * A GRID BEFORE IT IS ADDED: its levels, what fees take, and a backtest of those very rules over the last
 * ~3.5 days of 5-minute candles (lib/grid.ts). Nothing is saved.
 */
export const previewGrid = action({
  args: gridArgs,
  handler: async (_ctx, spec) => {
    const plan = planGrid(spec, "grid-preview");
    if ("problems" in plan) return { problems: plan.problems };
    const rules = plan.rules.map((raw, index) => {
      const made = cleanRule(raw, `preview-${index}`);
      if ("problems" in made) throw new ConvexError(`A grid level did not pass the rule checks: ${made.problems.join("; ")}.`);
      return made.rule;
    });
    let backtest: ReturnType<typeof simulateGrid> | null = null;
    let price: number | null = null;
    try {
      const candles = await historyCandles("binance-spot", rules[0].market, GRID_TIMEFRAME, 1000);
      price = candles[candles.length - 1]?.close ?? null;
      backtest = simulateGrid(rules, candles, {
        feeBps: VENUE_FEE_BPS[spec.venue],
        gasUsd: spec.venue === "dolphin-wallet" ? DOLPHIN_SWAP_GAS_USD : 0,
        dailyLossLimitUsd: null,
      });
    } catch {
      backtest = null;
    }
    return {
      problems: [] as string[],
      buyPrices: plan.buyPrices,
      stepPcts: plan.stepPcts,
      perLevelUsd: plan.perLevelUsd,
      costPerRoundTripUsd: plan.costPerRoundTripUsd,
      worstNetPerRoundTripUsd: plan.worstNetPerRoundTripUsd,
      stopPrice: plan.stopPrice,
      warnings: plan.warnings,
      price,
      buysAtStart: price === null ? null : plan.buyPrices.filter((buyAt) => price! < buyAt).length,
      backtest: backtest && {
        totalUsd: backtest.totalUsd,
        returnPct: backtest.returnPct,
        roundTrips: backtest.roundTrips,
        feesUsd: backtest.feesUsd,
        gasUsd: backtest.gasUsd,
        maxDrawdownUsd: backtest.maxDrawdownUsd,
        buyHoldPct: backtest.buyHoldPct,
        investedUsd: backtest.investedUsd,
        fromTime: backtest.equity[0]?.time ?? null,
        toTime: backtest.equity[backtest.equity.length - 1]?.time ?? null,
      },
    };
  },
});

/** Adds a grid to an agent you are building: one rule per level, on paper like every rule, counted as one. */
export const addGrid = mutation({
  args: { conversationKey: v.string(), ...gridArgs },
  handler: async (ctx, { conversationKey, ...spec }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation || (conversation.mode ?? "chat") !== "build") throw new ConvexError("A grid is added to an agent you are building.");
    const plan = planGrid(spec, `grid-${Math.random().toString(36).slice(2, 8)}`);
    if ("problems" in plan) throw new ConvexError(`That grid does not work: ${plan.problems.join("; ")}.`);
    const result = await addRulesTo(ctx, conversation._id, plan.rules);
    if (result.problems.length > 0) throw new ConvexError(`Could not add it: ${result.problems.join("; ")}.`);
    return { levels: result.added.length, warnings: plan.warnings };
  },
});

/** The build chat's door to a grid (agentBuilder.ts reads it from the person's words): a refusal comes back as words, not a throw. */
export const addGridFor = internalMutation({
  args: { conversationId: v.id("dolphinConversations"), ...gridArgs },
  handler: async (ctx, { conversationId, ...spec }): Promise<{ levels: number; warnings: string[] } | { problem: string }> => {
    const plan = planGrid(spec, `grid-${Math.random().toString(36).slice(2, 8)}`);
    if ("problems" in plan) return { problem: plan.problems.join("; ") };
    const result = await addRulesTo(ctx, conversationId, plan.rules);
    if (result.problems.length > 0) return { problem: result.problems.join("; ") };
    return { levels: result.added.length, warnings: plan.warnings };
  },
});

/**
 * Removes a whole grid. A level still holding coins is refused: close it first (Sell now on the Wallet's
 * Trades tab), so removing a grid can never strand a real position the engine no longer watches.
 */
export const removeGrid = mutation({
  args: { conversationKey: v.string(), gridId: v.string() },
  handler: async (ctx, { conversationKey, gridId }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    const levels = rulesOf(draft).filter((rule) => rule.grid?.id === gridId);
    if (!draft || levels.length === 0) throw new ConvexError("That grid is not in this agent.");
    const runs = [];
    for (const rule of levels) {
      const run = await ctx.db
        .query("strategyRuns")
        .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
        .unique();
      if ((run?.state as RuleState | undefined)?.position) throw new ConvexError(`Level ${rule.grid!.level} still holds a position. Sell it first, then remove the grid.`);
      if (run) runs.push(run._id);
    }
    const ids = new Set(levels.map((rule) => rule.id));
    await ctx.db.patch(draft._id, {
      rules: rulesOf(draft).filter((rule) => !ids.has(rule.id)),
      pausedRuleIds: (draft.pausedRuleIds ?? []).filter((id) => !ids.has(id)),
      updatedAt: Date.now(),
    });
    for (const id of runs) await ctx.db.delete(id);
  },
});

/** Pause or resume every level of a grid at once. */
export const setGridPaused = mutation({
  args: { conversationKey: v.string(), gridId: v.string(), paused: v.boolean() },
  handler: async (ctx, { conversationKey, gridId, paused }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    const ids = rulesOf(draft).filter((rule) => rule.grid?.id === gridId).map((rule) => rule.id);
    if (!draft || ids.length === 0) throw new ConvexError("That grid is not in this agent.");
    const current = new Set(draft.pausedRuleIds ?? []);
    for (const id of ids) {
      if (paused) current.add(id);
      else current.delete(id);
    }
    await ctx.db.patch(draft._id, { pausedRuleIds: [...current], updatedAt: Date.now() });
  },
});

/** The builder changes a rule's size, leverage or stop-loss in the draft panel - re-checked like any rule. */
export const updateRule = mutation({
  args: {
    conversationKey: v.string(),
    ruleId: v.string(),
    sizeUsd: v.optional(v.number()),
    leverage: v.optional(v.number()),
    stopLossPct: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { conversationKey, ruleId, ...change }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    const rules = rulesOf(draft);
    const rule = rules.find((candidate) => candidate.id === ruleId);
    if (!draft || !rule) throw new ConvexError("That rule is not in this agent.");
    const cleaned = cleanRule({ ...rule, ...change }, rule.id);
    // A copied setup's strategy stays locked through an edit of its size, leverage or stop.
    const made = "problems" in cleaned ? cleaned : { ...cleaned, rule: { ...cleaned.rule, ...(rule.locked ? { locked: rule.locked } : {}), ...(rule.grid ? { grid: rule.grid } : {}) } };
    if ("problems" in made) throw new ConvexError(`That change does not fit the rule: ${made.problems.join("; ")}.`);
    const misfit = venueProblem(made.rule, binanceOf(draft));
    if (misfit) throw new ConvexError(`That change does not fit: ${misfit}.`);
    await ctx.db.patch(draft._id, { rules: rules.map((candidate) => (candidate.id === ruleId ? { ...made.rule, name: rule.name } : candidate)), updatedAt: Date.now() });
    return { warnings: made.warnings };
  },
});

/** Pause or resume one rule: paused, it opens nothing new but still closes what it holds. */
export const setRulePaused = mutation({
  args: { conversationKey: v.string(), ruleId: v.string(), paused: v.boolean() },
  handler: async (ctx, { conversationKey, ruleId, paused }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    if (!draft || !rulesOf(draft).some((rule) => rule.id === ruleId)) throw new ConvexError("That rule is not in this agent.");
    const current = new Set(draft.pausedRuleIds ?? []);
    if (paused) current.add(ruleId);
    else current.delete(ruleId);
    await ctx.db.patch(draft._id, { pausedRuleIds: [...current], updatedAt: Date.now() });
  },
});

export const removeRule = mutation({
  args: { conversationKey: v.string(), ruleId: v.string() },
  handler: async (ctx, { conversationKey, ruleId }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    if (!draft || !rulesOf(draft).some((rule) => rule.id === ruleId)) throw new ConvexError("That rule is not in this agent.");
    await ctx.db.patch(draft._id, { rules: rulesOf(draft).filter((rule) => rule.id !== ruleId), updatedAt: Date.now() });
    const run = await ctx.db
      .query("strategyRuns")
      .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", ruleId))
      .unique();
    if (run) await ctx.db.delete(run._id);
  },
});

/** Today's (UTC) realized loss from an agent's rule exits, in dollars - 0 when it is up. */
async function lossTodayUsd(ctx: QueryCtx, draftId: Id<"agentDrafts">, source: "dolphin" | "runner"): Promise<number> {
  const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const trades = await ctx.db
    .query("strategyTrades")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId).gte("at", midnight))
    .collect();
  const net = trades
    .filter((trade) => trade.kind === "exit" && trade.pnlPct !== null && (trade.source ?? "dolphin") === source)
    .reduce((sum, trade) => sum + resultUsd(trade.pnlPct as number, trade.sizeUsd), 0);
  return net < 0 ? Math.round(-net * 100) / 100 : 0;
}

/** The builder sets the daily loss limit in the Permissions section. Null removes it. */
export const setDailyLossLimit = mutation({
  args: { conversationKey: v.string(), usd: v.union(v.number(), v.null()) },
  handler: async (ctx, { conversationKey, usd }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    if (!draft) throw new ConvexError("That is not an agent draft.");
    if (usd !== null && !(Number.isFinite(usd) && usd >= 1 && usd <= 1_000_000)) throw new ConvexError("A daily loss limit is $1 or more - or empty for none.");
    await ctx.db.patch(draft._id, { dailyLossLimitUsd: usd === null ? null : Math.round(usd * 100) / 100, updatedAt: Date.now() });
  },
});

/** The draft panel's view: each rule in words, its warnings, whether it holds a position, and its recent trades. */
export const forConversation = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    if (!draft) return { rules: [], trades: [], running: false, dailyLossLimitUsd: null, lossTodayUsd: 0 };
    const rules = rulesOf(draft);
    const views = [];
    for (const rule of rules) {
      const run = await ctx.db
        .query("strategyRuns")
        .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
        .unique();
      const made = cleanRule(rule, rule.id);
      // A copied setup's strategy: its conditions never reach the browser (lib/strategy.ts describeLocked).
      const locked = Boolean(rule.locked);
      views.push({
        id: rule.id,
        locked,
        words: locked ? describeLocked(rule) : describeRule(rule),
        venue: rule.venue,
        market: rule.market,
        action: rule.action,
        sizeUsd: rule.sizeUsd,
        leverage: rule.leverage,
        stopLossPct: rule.stopLossPct,
        takeProfitPct: rule.takeProfitPct,
        warnings: "warnings" in made ? made.warnings : [],
        position: ((run?.state as RuleState | undefined)?.position ?? null) as RuleState["position"],
        lastCheckedAt: run?.lastCheckedAt ?? null,
        lastError: run?.lastError ?? null,
        lastReason: run?.lastReason ? (locked ? redactReason(run.lastReason) : run.lastReason) : null,
        lastLagMs: run?.lastLagMs ?? null,
        paused: (draft.pausedRuleIds ?? []).includes(rule.id),
        maxTradesPerDay: rule.maxTradesPerDay,
        // What a real position holds on its venue, so the panel shows its value live; null on paper or flat.
        heldQty: typeof (run?.held as { qty?: unknown } | undefined)?.qty === "string" ? (run?.held as { qty: string }).qty : null,
        timeframe: rule.timeframe,
        grid: rule.grid ?? null,
      });
    }
    const lockedIds = new Set(rules.filter((rule) => rule.locked).map((rule) => rule.id));
    const trades = (
      await ctx.db
        .query("strategyTrades")
        .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
        .order("desc")
        // Enough for the rule view's chart markers; the Timeline shows the newest 10.
        .take(100)
    ).map((trade) => (lockedIds.has(trade.ruleId) ? { ...trade, reason: redactReason(trade.reason) } : trade));
    return {
      rules: views,
      trades,
      running: Boolean(draft.autopilot?.on),
      dailyLossLimitUsd: draft.dailyLossLimitUsd ?? null,
      lossTodayUsd: await lossTodayUsd(ctx, draft._id, "dolphin"),
    };
  },
});

/* ── The run: every minute, with no model call ── */

/** One armed agent as the run sees it: its rules and states, and whether it trades for real. */
type ArmedDraft = {
  draftId: Id<"agentDrafts">;
  rules: Rule[];
  states: Record<string, RuleState>;
  helds: Record<string, Held | null>;
  misfits: Record<string, string>;
  guard: LossGuard;
  /** Trading mode Live (paperMode false). Paper otherwise - the default. */
  live: boolean;
  /** The owner accepted the real-money disclaimer. */
  acknowledged: boolean;
  /** Rules the owner paused: no new entries. */
  paused: string[];
  /** Rules with an order still in flight: no run touches them until it settles (claimOrder). */
  inFlight: string[];
  /** Rules whose last real trade is a buy never sold: by the trade log they hold a position. */
  openByLog: string[];
  /** The wallet whose Keys tab holds the agent's keys (the one that switched Autopilot on). */
  owner: string | null;
  binance: BinanceConfig | null;
  agentName: string;
};

/** A draft whose rules are running: Autopilot on and at least one rule. */
const isArmed = (draft: Doc<"agentDrafts">) => Boolean(draft.autopilot?.on) && rulesOf(draft).length > 0;

/** Every armed agent with its rules' states - what one run of the engine works on. */
async function loadArmed(ctx: QueryCtx): Promise<ArmedDraft[]> {
  const drafts = await ctx.db.query("agentDrafts").collect();
  const out: ArmedDraft[] = [];
  for (const draft of drafts) {
    if (!draft.autopilot?.on || rulesOf(draft).length === 0) continue;
    out.push(await armedOf(ctx, draft));
  }
  return out;
}

/** One agent as the engine sees it - for the minute run and for a close the owner asks for. */
async function armedOf(ctx: QueryCtx, draft: Doc<"agentDrafts">): Promise<ArmedDraft> {
  const out: ArmedDraft[] = [];
  {
    const rules = rulesOf(draft);
    const inFlight: string[] = [];
    /*
     * THE TRADE LOG IS THE SECOND WITNESS (owner, 2026-10-04: "this thing must never happen again").
     * strategyTrades is only ever appended to, in the same write as the trade, so a run that saves a
     * stale rule state cannot rewrite it. A rule whose last REAL trade is a buy never sold still
     * holds that position, whatever its state says.
     */
    const realTrades = (await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(200)).filter(
      (trade) => trade.paper === false && (trade.source ?? "dolphin") === "dolphin",
    );
    const openByLog: string[] = rules.filter((rule) => realTrades.find((trade) => trade.ruleId === rule.id)?.kind === "enter").map((rule) => rule.id);
    const states: Record<string, RuleState> = {};
    const helds: Record<string, Held | null> = {};
    for (const rule of rules) {
      const run = await ctx.db
        .query("strategyRuns")
        .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
        .unique();
      states[rule.id] = (run?.state as RuleState | undefined) ?? EMPTY_STATE;
      helds[rule.id] = (run?.held as Held | undefined) ?? null;
      if (run?.orderInFlight && Date.now() - run.orderInFlight < ORDER_LOCK_MS) inFlight.push(rule.id);
    }
    // The block may have changed since the rule was written: a rule that no longer fits is held, with the reason.
    const binance = binanceOf(draft);
    const misfits: Record<string, string> = {};
    for (const rule of rules) {
      const misfit = venueProblem(rule, binance);
      if (misfit) misfits[rule.id] = misfit;
    }
    out.push({
      draftId: draft._id,
      rules,
      states,
      helds,
      misfits,
      guard: { limitUsd: draft.dailyLossLimitUsd ?? null, lossTodayUsd: await lossTodayUsd(ctx, draft._id, "dolphin") },
      live: draft.paperMode === false,
      paused: draft.pausedRuleIds ?? [],
      inFlight,
      openByLog,
      acknowledged: Boolean(draft.liveAcknowledgedAt),
      owner: draft.autopilot?.walletAddress ?? null,
      binance,
      agentName: draft.name ?? "Agent",
    });
  }
  return out[0];
}

export const record = internalMutation({
  args: {
    draftId: v.id("agentDrafts"),
    ruleId: v.string(),
    state: v.any(),
    lastError: v.union(v.string(), v.null()),
    lastReason: v.optional(v.string()),
    /** Set only when it changes: what a real position holds (null once closed). */
    held: v.optional(v.any()),
    lagMs: v.optional(v.number()),
    /** The claimOrder stamp of the run that sent an order: lets it write while its lock is held, and releases it. */
    order: v.optional(v.number()),
    /** Keep the lock (an order that may still land): the stamp stays until ORDER_LOCK_MS passes. */
    keepLock: v.optional(v.boolean()),
    trade: v.union(
      v.null(),
      v.object({
        ruleName: v.string(),
        venue: v.string(),
        market: v.string(),
        side: v.union(v.literal("long"), v.literal("short")),
        kind: v.union(v.literal("enter"), v.literal("exit")),
        price: v.number(),
        sizeUsd: v.number(),
        leverage: v.number(),
        pnlPct: v.union(v.number(), v.null()),
        reason: v.string(),
        candleTime: v.number(),
        paper: v.optional(v.boolean()),
        network: v.optional(v.union(v.literal("testnet"), v.literal("live"), v.literal("bsc"))),
        orderId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { draftId, ruleId, state, lastError, lastReason, held, lagMs, order, keepLock, trade }) => {
    const now = Date.now();
    const run = await ctx.db
      .query("strategyRuns")
      .withIndex("by_draft_rule", (q) => q.eq("draftId", draftId).eq("ruleId", ruleId))
      .unique();
    /*
     * ONE WRITER WHILE AN ORDER IS IN FLIGHT (owner's first live test, 2026-10-04): three swaps sat
     * "pending" for 4 minutes each; when they gave up they saved the rule's state from before a buy
     * that had landed meanwhile, and the next run bought again. While a lock is held, only the run
     * holding it writes; every other write is dropped.
     */
    const locked = run?.orderInFlight !== undefined && now - run.orderInFlight < ORDER_LOCK_MS;
    if (locked && run?.orderInFlight !== order) return;
    const lock = order !== undefined && !keepLock ? { orderInFlight: undefined } : {};
    const reason = lastReason === undefined ? {} : { lastReason };
    const holding = { ...(held === undefined ? {} : { held }), ...(lagMs === undefined ? {} : { lastLagMs: lagMs }) };
    if (run) await ctx.db.patch(run._id, { state, lastCheckedAt: now, lastError, ...reason, ...holding, ...lock });
    else await ctx.db.insert("strategyRuns", { draftId, ruleId, state, lastCheckedAt: now, lastError, ...reason, ...holding });
    if (trade) {
      const { paper, ...rest } = trade;
      await ctx.db.insert("strategyTrades", { draftId, ruleId, ...rest, paper: paper ?? true, at: now, source: "dolphin" });
    }
  },
});

/* ── The Wallet's Trades tab: every open position of a wallet's agents, and closing one now ── */

/** The agents a signed-in wallet built (its build conversations), with their drafts. */
async function walletDrafts(ctx: QueryCtx, wallet: string) {
  // Conversations store the address as the session gave it (checksummed) or lowercased: both are looked up.
  const forms = [...new Set([wallet, wallet.toLowerCase()])];
  const conversations = (await Promise.all(forms.map((form) => ctx.db.query("dolphinConversations").withIndex("by_owner", (q) => q.eq("ownerAddress", form)).collect()))).flat();
  const out: { draft: Doc<"agentDrafts">; conversationKey: string }[] = [];
  for (const conversation of conversations) {
    if ((conversation.mode ?? "chat") !== "build") continue;
    const draft = await ctx.db.query("agentDrafts").withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id)).unique();
    if (draft && rulesOf(draft).length > 0) out.push({ draft, conversationKey: conversation.conversationKey });
  }
  return out;
}

/**
 * EVERY TRADE AN AGENT TOOK FOR YOU (owner, 2026-10-04: "a clean way for people to view their trades...
 * through their wallet page... and stop a trade immediately once the person feels it is going the wrong
 * way"). Open positions with what they hold, and the latest trades - a locked setup's reasons redacted.
 */
export const myTrades = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Your trades").catch(() => null);
    if (!wallet) return null;
    const open = [];
    const recent = [];
    for (const { draft, conversationKey } of await walletDrafts(ctx, wallet)) {
      const rules = rulesOf(draft);
      for (const rule of rules) {
        const run = await ctx.db
          .query("strategyRuns")
          .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
          .unique();
        const position = ((run?.state as RuleState | undefined)?.position ?? null) as RuleState["position"];
        if (!position) continue;
        const heldQty = typeof (run?.held as { qty?: unknown } | undefined)?.qty === "string" ? (run?.held as { qty: string }).qty : null;
        open.push({
          draftId: draft._id,
          conversationKey,
          agentName: draft.name ?? "Agent",
          ruleId: rule.id,
          words: rule.locked ? describeLocked(rule) : describeRule(rule),
          locked: Boolean(rule.locked),
          venue: rule.venue,
          market: rule.market,
          action: rule.action,
          timeframe: rule.timeframe,
          sizeUsd: rule.sizeUsd,
          leverage: rule.leverage,
          stopLossPct: rule.stopLossPct,
          takeProfitPct: rule.takeProfitPct,
          position,
          heldQty,
          // Real only when Live and something is actually held on the venue; a position opened on paper closes on paper.
          real: draft.paperMode === false && heldQty !== null,
          autopilot: Boolean(draft.autopilot?.on),
          confirming: Boolean(run?.orderInFlight && Date.now() - run.orderInFlight < ORDER_LOCK_MS),
        });
      }
      const lockedIds = new Set(rules.filter((rule) => rule.locked).map((rule) => rule.id));
      for (const trade of await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(30)) {
        recent.push({
          id: trade._id,
          agentName: draft.name ?? "Agent",
          market: trade.market,
          side: trade.side,
          kind: trade.kind,
          price: trade.price,
          sizeUsd: trade.sizeUsd,
          pnlPct: trade.pnlPct,
          paper: trade.paper,
          network: trade.network ?? null,
          orderId: trade.orderId ?? null,
          reason: lockedIds.has(trade.ruleId) ? redactReason(trade.reason) : trade.reason,
          at: trade.at,
        });
      }
    }
    recent.sort((a, b) => b.at - a.at);
    return { open, recent: recent.slice(0, 40) };
  },
});

export const ownsDraft = internalQuery({
  args: { sessionToken: v.string(), draftId: v.id("agentDrafts") },
  handler: async (ctx, { sessionToken, draftId }) => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Closing a trade")).toLowerCase();
    const draft = await ctx.db.get(draftId);
    if (!draft) return false;
    const conversation = await ctx.db.get(draft.conversationId);
    return [conversation?.ownerAddress, draft.brain?.walletAddress, draft.autopilot?.walletAddress].some((owner) => owner && owner.toLowerCase() === wallet);
  },
});

export const armedFor = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    return draft ? armedOf(ctx, draft) : null;
  },
});

/**
 * CLOSE IT NOW, whatever the rule would do (owner, 2026-10-04: "stop a trade immediately"). Through the
 * same order lock and execution as the engine's own exits, so it can never sell twice or race a run:
 * a real position sells what it holds on its venue; one opened on paper closes on paper. Works with
 * Autopilot off.
 */
export const closeNow = action({
  args: { sessionToken: v.string(), draftId: v.id("agentDrafts"), ruleId: v.string() },
  handler: async (ctx, { sessionToken, draftId, ruleId }): Promise<{ price: number; pnlPct: number; real: boolean }> => {
    if (!(await ctx.runQuery(internal.strategy.ownsDraft, { sessionToken, draftId }))) throw new ConvexError("That agent is not yours.");
    const armed: ArmedDraft | null = await ctx.runQuery(internal.strategy.armedFor, { draftId });
    const rule = armed?.rules.find((candidate) => candidate.id === ruleId);
    const state = armed?.states[ruleId];
    if (!armed || !rule || !state) throw new ConvexError("That trade is not in this agent.");
    if (!state.position) throw new ConvexError("Nothing is open on that rule any more.");
    if (armed.inFlight.includes(ruleId)) throw new ConvexError("An order of this rule is still confirming. Try again in a few minutes.");
    const order: number | null = await ctx.runMutation(internal.strategy.claimOrder, { draftId, ruleId, lastCandle: state.lastCandle });
    if (order === null) throw new ConvexError("The rule is acting right now. Try again in a moment.");
    const position = state.position;
    let price: number;
    try {
      const candles = await closedCandles(rule.venue, rule.market, "1m", 2);
      price = candles[candles.length - 1].close;
    } catch {
      await ctx.runMutation(internal.strategy.record, { draftId, ruleId, state, lastError: "Could not read the price to close. Try again.", order, trade: null });
      throw new ConvexError("The price could not be read just now. Try again.");
    }
    const decision = { type: "exit" as const, side: position.side, price, reason: "Closed by you from the Wallet." };
    const outcome = await execute(ctx, armed, rule, decision, armed.helds[ruleId] ?? null);
    if ("error" in outcome) {
      const pending = /status PENDING/i.test(outcome.error);
      await ctx.runMutation(internal.strategy.record, {
        draftId,
        ruleId,
        state,
        lastError: pending ? "The sale is still confirming on BNB Chain. This rule waits a few minutes before it trades again." : outcome.error,
        order,
        keepLock: pending,
        trade: null,
      });
      throw new ConvexError(pending ? "The sale is still confirming on BNB Chain - check again in a few minutes before trying again." : outcome.error);
    }
    const filled = outcome.real ? outcome.price : price;
    const pnlPct = resultPct(position.side, position.entryPrice, filled, rule.leverage);
    await ctx.runMutation(internal.strategy.record, {
      draftId,
      ruleId,
      state: { ...state, position: null, lastTradeAt: Date.now() },
      lastError: null,
      lastReason: "Closed by you from the Wallet.",
      held: null,
      order,
      trade: {
        ruleName: rule.name,
        venue: rule.venue,
        market: rule.market,
        side: position.side,
        kind: "exit",
        price: filled,
        sizeUsd: rule.sizeUsd,
        leverage: rule.leverage,
        pnlPct,
        reason: "Closed by you from the Wallet.",
        candleTime: Date.now(),
        ...(outcome.real ? { paper: false, network: outcome.network, ...(outcome.orderId ? { orderId: outcome.orderId } : {}) } : {}),
      },
    });
    return { price: filled, pnlPct, real: outcome.real };
  },
});

/* ── One order per rule at a time ── */

/** How long an order may stay in flight before the rule may trade again: past the relay's 4-minute wait. */
const ORDER_LOCK_MS = 6 * 60_000;

/**
 * Takes a rule's order lock before an order is sent: false if another run holds it, or if the rule's
 * state has moved since this run read it (another run judged a newer candle). The stamp it returns
 * is what lets this run - and only this run - save the rule's state afterwards (record's `order`).
 */
export const claimOrder = internalMutation({
  args: { draftId: v.id("agentDrafts"), ruleId: v.string(), lastCandle: v.union(v.number(), v.null()) },
  handler: async (ctx, { draftId, ruleId, lastCandle }): Promise<number | null> => {
    const run = await ctx.db
      .query("strategyRuns")
      .withIndex("by_draft_rule", (q) => q.eq("draftId", draftId).eq("ruleId", ruleId))
      .unique();
    if (!run) return null;
    const now = Date.now();
    if (run.orderInFlight !== undefined && now - run.orderInFlight < ORDER_LOCK_MS) return null;
    if (((run.state as RuleState | undefined)?.lastCandle ?? null) !== lastCandle) return null;
    await ctx.db.patch(run._id, { orderInFlight: now });
    return now;
  },
});

/* ── The clock: a run half a second after every minute boundary, never two for one minute ── */

/** Half a second after the boundary: the candle has closed and Binance has it. */
const AFTER_CLOSE_MS = 500;

async function clockRow(ctx: { db: QueryCtx["db"] }) {
  return ctx.db.query("strategyClock").withIndex("by_key", (q) => q.eq("key", "main")).unique();
}

/*
 * WHAT IT COSTS (owner, 2026-10-03: "you overload my convex... over 30K function calls"). Every
 * Convex function call counts, on prod and dev alike, whether anyone is trading or not. So:
 *   - nothing armed: the chain stops; the watchdog looks once a minute (1 call) and restarts it
 *     the minute a rule is armed;
 *   - rules armed: each run is the action plus ONE mutation that claims the minute, books the
 *     next run and returns the rules (was four calls), plus a write only when a rule judged a
 *     newly closed candle.
 */

const nextBoundary = () => (Math.floor(Date.now() / 60_000) + 1) * 60_000 + AFTER_CLOSE_MS;

/**
 * One run's start, in one call: claims the minute (null if another run has it - never two for one
 * minute), books the next run while any rule is armed - before the work, so a run that fails still
 * leaves the chain going - and returns the armed rules.
 */
export const startMinute = internalMutation({
  args: { minute: v.number() },
  handler: async (ctx, { minute }): Promise<ArmedDraft[] | null> => {
    const clock = await clockRow(ctx);
    if (clock && clock.lastMinute >= minute) return null;
    const armedDrafts = await loadArmed(ctx);
    const target = nextBoundary();
    const book = armedDrafts.length > 0 && !(clock && clock.nextAt >= target);
    if (clock) await ctx.db.patch(clock._id, { lastMinute: minute, ...(book ? { nextAt: target } : {}) });
    else await ctx.db.insert("strategyClock", { key: "main", nextAt: book ? target : 0, lastMinute: minute });
    if (book) await ctx.scheduler.runAt(target, internal.strategy.tick, {});
    return armedDrafts;
  },
});

/** The cron's job: (re)start the chain when a rule is armed and nothing is booked ahead. Otherwise it only looks. */
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const clock = await clockRow(ctx);
    if (clock && clock.nextAt > Date.now() - 5_000) return;
    const drafts = await ctx.db.query("agentDrafts").collect();
    if (!drafts.some(isArmed)) return;
    const target = nextBoundary();
    if (clock) await ctx.db.patch(clock._id, { nextAt: target });
    else await ctx.db.insert("strategyClock", { key: "main", nextAt: target, lastMinute: 0 });
    await ctx.scheduler.runAt(target, internal.strategy.tick, {});
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ rules: number; trades: number }> => {
    const armedDrafts: ArmedDraft[] | null = await ctx.runMutation(internal.strategy.startMinute, { minute: Math.floor(Date.now() / 60_000) });
    if (!armedDrafts) return { rules: 0, trades: 0 };
    const now = Date.now();
    // One fetch per market per run, however many rules read it.
    const cache = new Map<string, Promise<Candle[]>>();
    let rulesChecked = 0;
    let trades = 0;
    for (const armedDraft of armedDrafts) {
      const { draftId, rules, states, misfits, guard } = armedDraft;
      for (const rule of rules) {
        rulesChecked++;
        const state = states[rule.id] ?? EMPTY_STATE;
        if (misfits[rule.id]) {
          await ctx.runMutation(internal.strategy.record, { draftId, ruleId: rule.id, state, lastError: `Paused: ${misfits[rule.id]}.`, trade: null });
          continue;
        }
        const key = `${rule.venue === "binance-futures" ? "f" : "s"}:${rule.market}:${rule.timeframe}`;
        if (!cache.has(key)) cache.set(key, closedCandles(rule.venue, rule.market, rule.timeframe, 200, now));
        let candles: Candle[];
        try {
          candles = await (cache.get(key) as Promise<Candle[]>);
        } catch (cause) {
          await ctx.runMutation(internal.strategy.record, {
            draftId,
            ruleId: rule.id,
            state,
            lastError: cause instanceof MarketDataError ? cause.message : "Binance's market data did not answer. It is tried again next minute.",
            trade: null,
          });
          continue;
        }
        // An order of this rule is still in flight: this run leaves the rule alone entirely.
        if (armedDraft.inFlight.includes(rule.id)) continue;
        const judged = candles[candles.length - 1];
        if (!judged) continue;
        // Arming never trades on history: the first look only records where the market stands.
        if (state.lastCandle === null) {
          await ctx.runMutation(internal.strategy.record, {
            draftId,
            ruleId: rule.id,
            state: { ...state, lastCandle: judged.openTime },
            lastError: null,
            lastReason: "Started watching. It acts from the next closed candle, never on history.",
            trade: null,
          });
          continue;
        }
        if (judged.openTime <= state.lastCandle) continue;
        // How late this decision is: from the judged candle's close to now.
        const lagMs = Math.max(0, Date.now() - (judged.openTime + TIMEFRAME_MS[rule.timeframe]));
        let decision = decide(rule, candles, state, now, guard);
        // Paused by the owner: nothing new opens; an open position still closes by its own exits.
        if (armedDraft.paused.includes(rule.id) && decision.type === "enter") {
          decision = { type: "none", reason: "Paused by you: no new trades. Resume it from the rule's view." };
        }
        // The trade log says it already holds what its state forgot: it never buys again on top of it.
        if (decision.type === "enter" && armedDraft.live && armedDraft.openByLog.includes(rule.id) && !state.position) {
          await ctx.runMutation(internal.strategy.record, {
            draftId,
            ruleId: rule.id,
            state: { ...state, lastCandle: judged.openTime },
            lastError: "Not traded: this rule's trade log says it still holds a position its record lost. It will not buy again until that is put right.",
            lastReason: decision.reason,
            lagMs,
            trade: null,
          });
          continue;
        }
        // On paper every decision "executes" at the closed candle's price; Live sends a real order first.
        const held = armedDraft.helds[rule.id] ?? null;
        let execution: Execution = { real: false };
        let order: number | undefined;
        if (decision.type !== "none") {
          // One order per rule at a time: take the lock, or leave the rule to the run that has it.
          const claimed: number | null = await ctx.runMutation(internal.strategy.claimOrder, { draftId, ruleId: rule.id, lastCandle: state.lastCandle });
          if (claimed === null) continue;
          order = claimed;
          const outcome = await execute(ctx, armedDraft, rule, decision, held);
          if ("error" in outcome) {
            // A swap the relay left pending may still land: the lock stays, so nothing else trades on this rule until it lapses.
            const pending = /status PENDING/i.test(outcome.error);
            // Not traded: the candle is judged, the position is unchanged, and the reason is shown.
            await ctx.runMutation(internal.strategy.record, {
              draftId,
              ruleId: rule.id,
              state: afterCandle(state, judged.openTime, decision, false, now),
              lastError: pending ? "The order is still confirming on BNB Chain. This rule waits a few minutes before it trades again." : outcome.error,
              lastReason: decision.reason,
              lagMs,
              order,
              keepLock: pending,
              trade: null,
            });
            continue;
          }
          execution = outcome;
          // What the venue really paid is the price of record.
          if (outcome.real) decision = { ...decision, price: outcome.price };
        }
        // A loss closed in this run counts at once toward the next rule's check.
        if (decision.type === "exit" && state.position) {
          const usd = resultUsd(resultPct(state.position.side, state.position.entryPrice, decision.price, rule.leverage), rule.sizeUsd);
          if (usd < 0) guard.lossTodayUsd = Math.round((guard.lossTodayUsd - usd) * 100) / 100;
        }
        const next = afterCandle(state, judged.openTime, decision, true, now);
        const trade =
          decision.type === "none"
            ? null
            : {
                ruleName: rule.name,
                venue: rule.venue,
                market: rule.market,
                side: decision.side,
                kind: decision.type,
                price: decision.price,
                sizeUsd: rule.sizeUsd,
                leverage: rule.leverage,
                pnlPct: decision.type === "exit" && state.position ? resultPct(state.position.side, state.position.entryPrice, decision.price, rule.leverage) : null,
                reason: decision.reason,
                candleTime: judged.openTime,
                ...(execution.real ? { paper: false, network: execution.network, ...(execution.orderId ? { orderId: execution.orderId } : {}) } : {}),
              };
        if (trade) trades++;
        await ctx.runMutation(internal.strategy.record, {
          draftId,
          ruleId: rule.id,
          state: next,
          lastError: null,
          lastReason: decision.reason,
          lagMs,
          ...(execution.real ? { held: execution.held } : decision.type === "exit" ? { held: null } : {}),
          ...(order !== undefined ? { order } : {}),
          trade,
        });
      }
    }
    return { rules: rulesChecked, trades };
  },
});

/* ── The rule view: its market's candles, and its backtest (owner, 2026-10-03) ── */

/** One rule of a build conversation, with the draft's daily loss limit. */
export const ruleOf = internalQuery({
  args: { conversationKey: v.string(), ruleId: v.string() },
  handler: async (ctx, { conversationKey, ruleId }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    const rule = rulesOf(draft).find((candidate) => candidate.id === ruleId) ?? null;
    return rule ? { rule, dailyLossLimitUsd: draft?.dailyLossLimitUsd ?? null } : null;
  },
});

const BACKTEST_CANDLES = 1_500;

type ChartCandle = { t: number; o: number; h: number; l: number; c: number; v?: number };
const toChart = (candle: Candle): ChartCandle => ({
  t: candle.openTime,
  o: candle.open,
  h: candle.high,
  l: candle.low,
  c: candle.close,
  ...(candle.quoteVolume !== undefined && Number.isFinite(candle.quoteVolume) ? { v: candle.quoteVolume } : {}),
});

/**
 * Replays a rule over Binance's real history with the live engine's own decisions
 * (lib/strategy.ts simulate) - so a backtest cannot disagree with how the rule trades.
 */
export const backtestRule = action({
  args: { conversationKey: v.string(), ruleId: v.string() },
  handler: async (ctx, { conversationKey, ruleId }): Promise<{ candles: ChartCandle[]; result: SimResult; feeBps: number; market: string; timeframe: string } | { error: string }> => {
    const found = await ctx.runQuery(internal.strategy.ruleOf, { conversationKey, ruleId });
    if (!found) return { error: "That rule is gone." };
    const { rule, dailyLossLimitUsd } = found as { rule: Rule; dailyLossLimitUsd: number | null };
    let candles: Candle[];
    try {
      candles = await historyCandles(rule.venue, rule.market, rule.timeframe, BACKTEST_CANDLES);
    } catch (cause) {
      return { error: cause instanceof MarketDataError ? cause.message : "Binance's history did not answer. Try again." };
    }
    if (candles.length < 80) return { error: "Not enough history yet for this market and timeframe." };
    const feeBps = VENUE_FEE_BPS[rule.venue];
    const result = simulate(rule, candles, { feeBps, dailyLossLimitUsd });
    // A locked setup's backtest shows every trade and result, not the values its conditions saw.
    if (rule.locked) result.trades = result.trades.map((trade) => ({ ...trade, reason: redactReason(trade.reason) }));
    return { candles: candles.map(toChart), result, feeBps, market: rule.market, timeframe: rule.timeframe };
  },
});

/** A rule market's recent closed candles, for its live chart (the browser then streams the rest). */
export const marketCandles = action({
  args: { venue: v.string(), market: v.string(), timeframe: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<ChartCandle[] | { error: string }> => {
    const timeframe = (TIMEFRAMES as readonly string[]).includes(args.timeframe) ? (args.timeframe as Rule["timeframe"]) : "1h";
    const venue = args.venue === "binance-futures" ? "binance-futures" : "binance-spot";
    try {
      return (await closedCandles(venue, args.market, timeframe, Math.min(Math.max(args.limit ?? 200, 20), 1000))).map(toChart);
    } catch (cause) {
      return { error: cause instanceof MarketDataError ? cause.message : "Binance did not answer." };
    }
  },
});

/* ── Live: real orders from inside Dolphin (owner, 2026-10-03) ── */

type Execution =
  | { real: false }
  | { real: true; network: "testnet" | "live" | "bsc"; price: number; orderId: string | null; held: Held | null };

const STABLES = /(USDT|USDC|FDUSD|BUSD|U)$/;

/**
 * Carries out one decision. Paper unless the agent is in Live mode; then Binance (testnet or live,
 * with the owner's own key) or the Dolphin Wallet (its trade key). Every way this can refuse comes
 * back as a sentence that becomes the rule's "Paused:" or "Not traded:" line.
 */
async function execute(ctx: ActionCtx, draft: ArmedDraft, rule: Rule, decision: Exclude<ReturnType<typeof decide>, { type: "none" }>, held: Held | null): Promise<Execution | { error: string }> {
  if (!draft.live) return { real: false };
  // An exit of a position opened on paper (before the switch to Live) closes on paper.
  if (decision.type === "exit" && !held) return { real: false };

  if (rule.venue === "binance-spot" || rule.venue === "binance-futures") {
    const binance = draft.binance;
    if (!binance?.keyName || !binance.secretName) return { error: "Paused: connect your Binance key on the Binance block, or switch Trading mode back to Paper." };
    const network = binance.network ?? "testnet";
    if (network === "live" && !draft.acknowledged) return { error: "Paused: accept the real-money disclaimer (Trading mode → Live) before it trades real funds." };
    if (!draft.owner) return { error: "Paused: switch Autopilot off and on again, signed in, so Dolphin knows whose keys to use." };
    const [apiKey, secret] = await Promise.all([
      ctx.runAction(internal.envVars.reveal, { walletAddress: draft.owner, name: binance.keyName }),
      ctx.runAction(internal.envVars.reveal, { walletAddress: draft.owner, name: binance.secretName }),
    ]);
    if (!apiKey || !secret) return { error: `Paused: ${!apiKey ? binance.keyName : binance.secretName} is not in your Keys tab.` };
    try {
      if (decision.type === "enter") {
        const opened = await openPosition({ apiKey, secret }, network, rule, decision.side, decision.price);
        return { real: true, network, price: opened.fill.price, orderId: opened.fill.orderId, held: opened.held };
      }
      const fill = await closePosition({ apiKey, secret }, network, rule, decision.side, held as Held, decision.price);
      return { real: true, network, price: fill.price, orderId: fill.orderId, held: null };
    } catch (cause) {
      return { error: `Not traded: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
  }

  if (rule.venue === "dolphin-wallet") {
    if (!draft.acknowledged) return { error: "Paused: accept the real-money disclaimer (Trading mode → Live) before it trades real funds." };
    /*
     * THE KEY MUST OUTLIVE THE TRADE (owner, 2026-10-04: "the person's agent key expires... what
     * happens?"). Without its trade key the rule cannot sell, so it opens nothing it might not be
     * able to close: no entry when the key expires within four of the rule's candles (at least 2 h).
     */
    const tradeKey = await ctx.runQuery(internal.autotrade.activeKey, { draftId: draft.draftId });
    if (!tradeKey) {
      return {
        error:
          decision.type === "exit"
            ? "Can't sell: this agent's trade key has expired or was stopped. Renew it under Trading mode → Trade without asking, or sell from your Wallet."
            : "Paused: let this agent trade without asking (grant its trade key) to trade from the Dolphin Wallet.",
      };
    }
    const keyLeftMs = tradeKey.expiry * 1000 - Date.now();
    if (decision.type === "enter" && keyLeftMs < Math.max(2 * 3_600_000, 4 * TIMEFRAME_MS[rule.timeframe])) {
      return { error: `Not traded: the trade key expires in ${Math.max(0, Math.round(keyLeftMs / 60_000))} minutes - too soon to be sure it can sell what it buys. Renew it under Trading mode → Trade without asking.` };
    }
    const token = verifiedTokenBySymbol(rule.market.replace(STABLES, ""));
    const usdt = verifiedTokenBySymbol("USDT");
    if (!token || !usdt || token.symbol === "USDT") return { error: `Paused: the Dolphin Wallet trades verified tokens (BNB, CAKE, BTCB, ETH, XVS) against USDT; ${rule.market} is not one of them.` };
    const ticket =
      decision.type === "enter"
        ? { kind: "swap" as const, amountIn: String(rule.sizeUsd), tokenIn: usdt, tokenOut: token, safety: null }
        : { kind: "swap" as const, amountIn: (held as Held).qty, tokenIn: token, tokenOut: usdt, safety: null };
    const result = await ctx.runAction(internal.autotrade.executeTrade, { draftId: draft.draftId, agentName: draft.agentName, ticket });
    if (!result.attempted) return { error: "Paused: let this agent trade without asking (grant its trade key) to trade from the Dolphin Wallet." };
    if (!result.executed) return { error: result.text };
    const out = Number(result.amountOut ?? 0);
    if (decision.type === "enter") {
      // Sell slightly under the quote later: what arrives can be a little less than quoted.
      const qty = (Math.floor(out * 0.995 * 1e6) / 1e6).toString();
      return { real: true, network: "bsc", price: out > 0 ? rule.sizeUsd / out : decision.price, orderId: result.transactionHash ?? null, held: { qty, orderId: result.transactionHash ?? null, stopOrderId: null } };
    }
    const sold = Number((held as Held).qty);
    return { real: true, network: "bsc", price: sold > 0 ? out / sold : decision.price, orderId: result.transactionHash ?? null, held: null };
  }

  // The Binance Wallet (Agentic Wallet) signs through a CLI on the builder's own machine.
  return { real: false };
}

/** Checks the Binance block's saved key against Binance, for the block's own Check button. */
export const checkBinance = action({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }): Promise<ConnectionReport | { error: string }> => {
    const owned = await ctx.runQuery(internal.autotrade.ownedDraft, { sessionToken, conversationKey });
    const block = (owned.blocks as AgentBlock[]).find((candidate) => candidate.type === "binance");
    if (!block || block.type !== "binance") return { error: "Add a Binance block first." };
    const config = block.config;
    if (config.account !== "exchange") return { error: "The Binance Wallet runs on your own server; connect the Exchange to trade from Dolphin." };
    if (!config.keyName || !config.secretName) return { error: "Name your saved Binance key and secret on the block first." };
    const [apiKey, secret] = await Promise.all([
      ctx.runAction(internal.envVars.reveal, { walletAddress: owned.walletAddress, name: config.keyName }),
      ctx.runAction(internal.envVars.reveal, { walletAddress: owned.walletAddress, name: config.secretName }),
    ]);
    if (!apiKey || !secret) return { error: `${!apiKey ? config.keyName : config.secretName} is not in your Keys tab yet.` };
    return checkConnection({ apiKey, secret }, config.network ?? "testnet", config.futures);
  },
});

/* ── Phase 4: "Run it on your server" ── */

const MAX_RUNNER_REPORTS_PER_DAY = 500;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Everything the runner needs, as agent.json: the rules and a report token.
 * The token is stored only hashed; downloading again replaces it, so an old
 * file can no longer report. It can only add trade reports to this agent -
 * it reads nothing and moves nothing.
 */
export const exportForRunner = mutation({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    const rules = rulesOf(draft);
    if (!draft || rules.length === 0) throw new ConvexError("This agent has no trading rules to run yet.");
    // The runner file carries every condition: a copied setup's locked strategy runs on Dolphin only.
    if (rules.some((rule) => rule.locked)) throw new ConvexError("This agent includes a copied setup whose strategy is locked, so it runs on Dolphin only.");
    const token = randomToken();
    await ctx.db.patch(draft._id, { runnerTokenHash: await sha256Hex(token), updatedAt: Date.now() });
    return {
      version: 1,
      agent: { name: draft.name ?? "Dolphin agent" },
      rules,
      // Enforced by the runner itself against its own closed trades (same engine, lib/strategy.ts).
      limits: { dailyLossLimitUsd: draft.dailyLossLimitUsd ?? null },
      report: { url: `${apiBase()}/api/v1/runner/report`, token },
    };
  },
});

export const recordRunnerReport = internalMutation({
  args: { tokenHash: v.string(), report: v.any() },
  handler: async (ctx, { tokenHash, report }): Promise<{ ok: boolean; reason: string | null }> => {
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_runner_token", (q) => q.eq("runnerTokenHash", tokenHash))
      .unique();
    if (!draft) return { ok: false, reason: "That runner token is not current. Download agent.json again from the agent." };
    const r = (report ?? {}) as Record<string, unknown>;
    const rule = rulesOf(draft).find((candidate) => candidate.id === r.ruleId);
    if (!rule) return { ok: false, reason: "That rule is no longer in the agent." };
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const price = num(r.price);
    if ((r.kind !== "enter" && r.kind !== "exit") || (r.side !== "long" && r.side !== "short") || price === null || price <= 0) {
      return { ok: false, reason: "The report is not a trade." };
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = await ctx.db
      .query("strategyTrades")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id).gte("at", since))
      .take(MAX_RUNNER_REPORTS_PER_DAY + 1);
    if (recent.length > MAX_RUNNER_REPORTS_PER_DAY) return { ok: false, reason: "Too many reports today." };
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : null);
    await ctx.db.insert("strategyTrades", {
      draftId: draft._id,
      ruleId: rule.id,
      ruleName: rule.name,
      // The rule's own venue, market, size and leverage - what Dolphin knows - not what the report claims.
      venue: rule.venue,
      market: rule.market,
      side: r.side,
      kind: r.kind,
      price,
      sizeUsd: rule.sizeUsd,
      leverage: rule.leverage,
      paper: r.paper !== false,
      pnlPct: num(r.pnlPct),
      reason: text(r.reason, 300) ?? "",
      candleTime: num(r.candleTime) ?? 0,
      at: Date.now(),
      source: "runner",
      orderRef: text(r.orderRef, 80),
      txHash: typeof r.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? r.txHash : null,
      latencyMs: num(r.latencyMs),
    });
    return { ok: true, reason: null };
  },
});

/** The http route's helper: hash the bearer token here so it is never stored or compared in the clear. */
export async function runnerTokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}
