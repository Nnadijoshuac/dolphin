import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { apiBase } from "./builtAgents";
import { ensureDraft } from "./knowledge";
import { activeBlocks, validateBlocks, type AgentBlock, type BinanceConfig } from "./lib/agentBlocks";
import { closedCandles, MarketDataError } from "./lib/binanceMarket";
import { afterCandle, cleanRule, decide, describeRule, EMPTY_STATE, resultPct, resultUsd, venueProblem, type Candle, type LossGuard, type Rule, type RuleState } from "./lib/strategy";

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
    const misfit = venueProblem(made.rule, binanceOf(draft));
    if (misfit) throw new ConvexError(`That change does not fit: ${misfit}.`);
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

export const armed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drafts = await ctx.db.query("agentDrafts").collect();
    const out: { draftId: Id<"agentDrafts">; rules: Rule[]; states: Record<string, RuleState>; misfits: Record<string, string>; guard: LossGuard }[] = [];
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
      // The block may have changed since the rule was written: a rule that no longer fits is held, with the reason.
      const binance = binanceOf(draft);
      const misfits: Record<string, string> = {};
      for (const rule of rules) {
        const misfit = venueProblem(rule, binance);
        if (misfit) misfits[rule.id] = misfit;
      }
      out.push({ draftId: draft._id, rules, states, misfits, guard: { limitUsd: draft.dailyLossLimitUsd ?? null, lossTodayUsd: await lossTodayUsd(ctx, draft._id, "dolphin") } });
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
    if (trade) await ctx.db.insert("strategyTrades", { draftId, ruleId, ...trade, paper: true, at: now, source: "dolphin" });
  },
});

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ rules: number; trades: number }> => {
    const now = Date.now();
    const armedDrafts: { draftId: Id<"agentDrafts">; rules: Rule[]; states: Record<string, RuleState>; misfits: Record<string, string>; guard: LossGuard }[] = await ctx.runQuery(
      internal.strategy.armed,
      {},
    );
    // One fetch per market per run, however many rules read it.
    const cache = new Map<string, Promise<Candle[]>>();
    let rulesChecked = 0;
    let trades = 0;
    for (const { draftId, rules, states, misfits, guard } of armedDrafts) {
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
        const judged = candles[candles.length - 1];
        if (!judged) continue;
        // Arming never trades on history: the first look only records where the market stands.
        if (state.lastCandle === null) {
          await ctx.runMutation(internal.strategy.record, { draftId, ruleId: rule.id, state: { ...state, lastCandle: judged.openTime }, lastError: null, trade: null });
          continue;
        }
        if (judged.openTime <= state.lastCandle) continue;
        const decision = decide(rule, candles, state, now, guard);
        // A loss closed in this run counts at once toward the next rule's check.
        if (decision.type === "exit" && state.position) {
          const usd = resultUsd(resultPct(state.position.side, state.position.entryPrice, decision.price, rule.leverage), rule.sizeUsd);
          if (usd < 0) guard.lossTodayUsd = Math.round((guard.lossTodayUsd - usd) * 100) / 100;
        }
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
