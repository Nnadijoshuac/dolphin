import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { closedCandles, MarketDataError } from "./lib/binanceMarket";
import { afterCandle, cleanRule, decide, describeRule, EMPTY_STATE, resultPct, type Candle, type Rule, type RuleState } from "./lib/strategy";

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
  handler: async (ctx, { conversationId, rules }): Promise<{ added: string[]; problems: string[]; warnings: string[] }> => {
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .unique();
    if (!draft) return { added: [], problems: ["the draft does not exist yet - describe the agent first"], warnings: [] };
    let current = rulesOf(draft);
    const added: string[] = [];
    const problems: string[] = [];
    const warnings: string[] = [];
    for (const raw of rules.slice(0, MAX_RULES)) {
      const same = current.find(
        (rule) => rule.market === String((raw as { market?: unknown }).market ?? "").trim() && rule.timeframe === (raw as { timeframe?: unknown }).timeframe && rule.action === (raw as { action?: unknown }).action,
      );
      const made = cleanRule(raw, same?.id ?? newRuleId());
      if ("problems" in made) {
        problems.push(`a rule (${made.problems.join("; ")})`);
        // What the model actually wrote, for whoever tunes the prompt or the checker.
        console.warn("[strategy] rule refused:", made.problems, JSON.stringify(raw).slice(0, 1_500));
        continue;
      }
      if (!same && current.length >= MAX_RULES) {
        problems.push(`a rule (an agent holds at most ${MAX_RULES})`);
        continue;
      }
      current = same ? current.map((rule) => (rule.id === same.id ? made.rule : rule)) : [...current, made.rule];
      added.push(made.rule.name);
      warnings.push(...made.warnings);
    }
    if (added.length > 0) await ctx.db.patch(draft._id, { rules: current, updatedAt: Date.now() });
    return { added, problems, warnings };
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
    const made = cleanRule({ ...rule, ...change }, rule.id);
    if ("problems" in made) throw new ConvexError(`That change does not fit the rule: ${made.problems.join("; ")}.`);
    await ctx.db.patch(draft._id, { rules: rules.map((candidate) => (candidate.id === ruleId ? { ...made.rule, name: rule.name } : candidate)), updatedAt: Date.now() });
    return { warnings: made.warnings };
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

/** The draft panel's view: each rule in words, its warnings, whether it holds a position, and its recent trades. */
export const forConversation = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const draft = await draftOfKey(ctx, conversationKey);
    if (!draft) return { rules: [], trades: [], running: false };
    const rules = rulesOf(draft);
    const views = [];
    for (const rule of rules) {
      const run = await ctx.db
        .query("strategyRuns")
        .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
        .unique();
      const made = cleanRule(rule, rule.id);
      views.push({
        id: rule.id,
        words: describeRule(rule),
        venue: rule.venue,
        market: rule.market,
        action: rule.action,
        sizeUsd: rule.sizeUsd,
        leverage: rule.leverage,
        stopLossPct: rule.stopLossPct,
        warnings: "warnings" in made ? made.warnings : [],
        position: ((run?.state as RuleState | undefined)?.position ?? null) as RuleState["position"],
        lastCheckedAt: run?.lastCheckedAt ?? null,
        lastError: run?.lastError ?? null,
      });
    }
    const trades = await ctx.db
      .query("strategyTrades")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .take(20);
    return { rules: views, trades, running: Boolean(draft.autopilot?.on) };
  },
});

/* ── The run: every minute, with no model call ── */

export const armed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drafts = await ctx.db.query("agentDrafts").collect();
    const out: { draftId: Id<"agentDrafts">; rules: Rule[]; states: Record<string, RuleState> }[] = [];
    for (const draft of drafts) {
      const rules = rulesOf(draft);
      if (!draft.autopilot?.on || rules.length === 0) continue;
      const states: Record<string, RuleState> = {};
      for (const rule of rules) {
        const run = await ctx.db
          .query("strategyRuns")
          .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
          .unique();
        states[rule.id] = (run?.state as RuleState | undefined) ?? EMPTY_STATE;
      }
      out.push({ draftId: draft._id, rules, states });
    }
    return out;
  },
});

export const record = internalMutation({
  args: {
    draftId: v.id("agentDrafts"),
    ruleId: v.string(),
    state: v.any(),
    lastError: v.union(v.string(), v.null()),
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
      }),
    ),
  },
  handler: async (ctx, { draftId, ruleId, state, lastError, trade }) => {
    const now = Date.now();
    const run = await ctx.db
      .query("strategyRuns")
      .withIndex("by_draft_rule", (q) => q.eq("draftId", draftId).eq("ruleId", ruleId))
      .unique();
    if (run) await ctx.db.patch(run._id, { state, lastCheckedAt: now, lastError });
    else await ctx.db.insert("strategyRuns", { draftId, ruleId, state, lastCheckedAt: now, lastError });
    if (trade) await ctx.db.insert("strategyTrades", { draftId, ruleId, ...trade, paper: true, at: now });
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ rules: number; trades: number }> => {
    const now = Date.now();
    const armedDrafts: { draftId: Id<"agentDrafts">; rules: Rule[]; states: Record<string, RuleState> }[] = await ctx.runQuery(internal.strategy.armed, {});
    // One fetch per market per run, however many rules read it.
    const cache = new Map<string, Promise<Candle[]>>();
    let rulesChecked = 0;
    let trades = 0;
    for (const { draftId, rules, states } of armedDrafts) {
      for (const rule of rules) {
        rulesChecked++;
        const state = states[rule.id] ?? EMPTY_STATE;
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
        const judged = candles[candles.length - 1];
        if (!judged) continue;
        // Arming never trades on history: the first look only records where the market stands.
        if (state.lastCandle === null) {
          await ctx.runMutation(internal.strategy.record, { draftId, ruleId: rule.id, state: { ...state, lastCandle: judged.openTime }, lastError: null, trade: null });
          continue;
        }
        if (judged.openTime <= state.lastCandle) continue;
        const decision = decide(rule, candles, state, now);
        // Paper inside Dolphin: every decision "executes" at the closed candle's price.
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
              };
        if (trade) trades++;
        await ctx.runMutation(internal.strategy.record, { draftId, ruleId: rule.id, state: next, lastError: null, trade });
      }
    }
    return { rules: rulesChecked, trades };
  },
});
