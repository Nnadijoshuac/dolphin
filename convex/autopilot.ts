/**
 * AUTOPILOT: an agent's triggers, armed, running it on its builder's key.
 * (2026-09-28, owner: schedule and price triggers, and wallet watching for KOLs)
 *
 * A draft with a Brain and at least one trigger block can be armed by the
 * wallet whose key its Brain uses - nobody else can make it spend that key.
 * Arming writes one agentTriggers row per trigger; a cron every minute reads
 * only the rows that are due, checks each, and when one fires, runs the agent
 * into its autopilot conversation (a try conversation, so the builder watches
 * the run live on the canvas, as it happens).
 *
 *   schedule     fires every N minutes (15 minutes at the fastest).
 *   price        fires when the Market token's price CROSSES the level -
 *                once per crossing, never on every check while it stays over.
 *   walletWatch  fires when a watched wallet moves an ERC-20 token, read from
 *                BNB Chain's own Transfer logs.
 *
 * Every trigger is quiet on its first check: it records where things stand
 * (the price side, the latest block) and fires only on what changes after.
 * A draft runs at most MAX_RUNS_PER_DAY times a day, whatever its triggers
 * say, so a noisy trigger cannot drain its builder's key.
 *
 * I/O: an idle deployment costs one empty index range a minute (by_next_run).
 */

import { conditionMet, describeCondition, type SignalCondition } from "./lib/indicators";
import { ConvexError, v } from "convex/values";
import { createPublicClient, getAddress, http, parseAbi, parseAbiItem, type Address } from "viem";
import { bsc } from "viem/chains";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { activeBlocks, bscPairFor, poolCandles, TRIGGER_TYPES, type AgentBlock, type MarketConfig } from "./lib/agentBlocks";
import { verifiedTokens } from "./lib/tradeTokens";
import { bscPublicClient } from "./lib/bscClient";
import { syncTriggers } from "./lib/triggerSync";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

export const MAX_RUNS_PER_DAY = 48;
const PRICE_CHECK_MS = 2 * 60_000;
const WALLET_CHECK_MS = 60_000;
/** A Signal is judged on closed candles; checking every 5 minutes catches each close. */
const SIGNAL_CHECK_MS = 5 * 60_000;
/** At ~0.45 s a block, about 11 minutes. A wider gap after downtime is skipped, not replayed. */
const MAX_BLOCK_RANGE = 1_500n;
const TICK_BATCH = 20;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ERC20_META = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

/*
 * WHY TWO SIGNALS, AND THIS NODE (measured 2026-09-28). No free public BNB Chain
 * node answers "which tokens did this wallet move": bsc-dataseed refuses any
 * address-less eth_getLogs ("limit exceeded", even over 10 blocks),
 * publicnode requires the token contract's address, and drpc rate-limits at
 * once. So a watched wallet is read two ways:
 *   - its transaction count (nonce): one call each, and it moves on ANY
 *     transaction - a brand-new memecoin included;
 *   - Transfer logs for the tokens we can name (the Market token and Dolphin's
 *     verified list), from publicnode, which says exactly what moved.
 * publicnode answered 1,500 blocks of address-filtered logs in under a second.
 */
const logsClient = createPublicClient({
  chain: bsc,
  transport: http(process.env.BSC_LOGS_RPC_URL?.trim() || "https://bsc-rpc.publicnode.com"),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── arming ─────────────────────────────────────────────────────────────────── */

export const setAutopilot = mutation({
  args: { conversationKey: v.string(), sessionToken: v.string(), on: v.boolean() },
  handler: async (ctx, { conversationKey, sessionToken, on }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Autopilot");
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation || (conversation.mode ?? "chat") !== "build") throw new ConvexError("That is not an agent draft.");
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .unique();
    if (!draft) throw new ConvexError("That draft is empty.");

    // Only triggers still plugged in on the canvas are armed.
    const blocks = activeBlocks((draft.blocks ?? []) as AgentBlock[], draft.detached);
    if (!on) {
      await syncTriggers(ctx, draft._id, blocks, false);
      if (draft.autopilot) await ctx.db.patch(draft._id, { autopilot: { ...draft.autopilot, on: false } });
      return { on: false, triggers: 0 };
    }

    if (!draft.brain) throw new ConvexError("Give the agent a brain first: your own model key, on the Brain block.");
    if (draft.brain.walletAddress !== walletAddress) {
      throw new ConvexError("Only the wallet whose key this agent's brain uses can switch its autopilot on.");
    }
    if (!draft.name || !draft.instructions) throw new ConvexError("The agent needs a name and a strategy first.");
    if (!blocks.some((block) => TRIGGER_TYPES.includes(block.type))) {
      throw new ConvexError("Add a trigger first: a schedule, a price, or a wallet to watch.");
    }

    let runKey = draft.autopilot?.conversationKey;
    if (!runKey) {
      runKey = randomHex(32);
      const now = Date.now();
      await ctx.db.insert("dolphinConversations", {
        conversationKey: runKey,
        ownerAddress: walletAddress,
        title: `Autopilot · ${draft.name}`,
        seedAgentKey: null,
        mode: "try",
        draftId: draft._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(draft._id, {
      autopilot: {
        on: true,
        conversationKey: runKey,
        walletAddress,
        runsDay: draft.autopilot?.runsDay ?? today(),
        runs: draft.autopilot?.runs ?? 0,
      },
    });
    const triggers = await syncTriggers(ctx, draft._id, blocks, true);
    return { on: true, triggers, conversationKey: runKey };
  },
});

/* ── the scheduler ──────────────────────────────────────────────────────────── */

export const dueTriggers = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("agentTriggers")
      .withIndex("by_next_run", (q) => q.lte("nextRunAt", now))
      .take(TICK_BATCH);
    const out = [];
    for (const row of rows) {
      const draft = await ctx.db.get(row.draftId);
      const market = ((draft?.blocks ?? []) as AgentBlock[]).find((block) => block.type === "market");
      out.push({ ...row, market: market ? (market.config as MarketConfig) : null, name: draft?.name ?? null });
    }
    return out;
  },
});

export const saveTrigger = internalMutation({
  args: { triggerId: v.id("agentTriggers"), nextRunAt: v.number(), state: v.any() },
  handler: async (ctx, { triggerId, nextRunAt, state }) => {
    if (await ctx.db.get(triggerId)) await ctx.db.patch(triggerId, { nextRunAt, state });
  },
});

/** Counts a run against the day's cap and starts it. False when the cap is reached or autopilot is off. */
export const fire = internalMutation({
  args: { draftId: v.id("agentDrafts"), text: v.string() },
  handler: async (ctx, { draftId, text }): Promise<boolean> => {
    const draft = await ctx.db.get(draftId);
    const autopilot = draft?.autopilot;
    if (!draft || !autopilot?.on) return false;
    const runs = autopilot.runsDay === today() ? autopilot.runs : 0;
    if (runs >= MAX_RUNS_PER_DAY) return false;
    await ctx.db.patch(draftId, { autopilot: { ...autopilot, runsDay: today(), runs: runs + 1 } });
    await ctx.scheduler.runAfter(0, internal.agentBuilder.runTriggeredTurn, {
      conversationKey: autopilot.conversationKey,
      text,
    });
    return true;
  },
});

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmt(value: number): string {
  return value >= 1 ? value.toLocaleString("en", { maximumFractionDigits: 4 }) : value.toPrecision(4);
}

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; fired: number }> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.autopilot.dueTriggers, { now });
    let fired = 0;

    for (const trigger of due) {
      let nextRunAt = now + 60_000;
      let state: unknown = trigger.state;
      let message: string | null = null;

      try {
        if (trigger.type === "schedule") {
          const every = Number((trigger.config as { everyMinutes: number }).everyMinutes) || 60;
          nextRunAt = now + every * 60_000;
          message = `Scheduled run (every ${every} minutes). Check the market and act on your strategy.`;
        } else if (trigger.type === "price") {
          nextRunAt = now + PRICE_CHECK_MS;
          const config = trigger.config as { direction: "above" | "below"; priceUsd: number };
          const pair = trigger.market ? await bscPairFor(trigger.market.tokenAddress) : null;
          if (pair?.priceUsd) {
            const side = pair.priceUsd >= config.priceUsd ? "above" : "below";
            const previous = (trigger.state as { side?: string } | null)?.side;
            if (previous && previous !== side && side === config.direction) {
              message = `Price trigger: ${trigger.market!.symbol} crossed ${config.direction} $${fmt(config.priceUsd)} and is now $${fmt(pair.priceUsd)}.`;
            }
            state = { side };
          }
        } else if (trigger.type === "signal") {
          /*
           * SIGNAL (2026-09-29): fires once when its condition turns true on a
           * NEWLY CLOSED candle - never on a candle still forming, and never
           * twice for the same candle.
           */
          nextRunAt = now + SIGNAL_CHECK_MS;
          const config = trigger.config as { condition: SignalCondition; level: number | null; timeframe: "1h" | "4h" | "1d" };
          if (trigger.market) {
            const pool = trigger.market.poolAddress ?? (await bscPairFor(trigger.market.tokenAddress))?.pairAddress;
            const frame = config.timeframe === "1d" ? "day" : config.timeframe === "4h" ? "4h" : "hour";
            const candles = pool ? await poolCandles(pool, trigger.market.tokenAddress, frame, 120) : [];
            const lastClosed = candles.at(-1)?.[0] ?? null;
            const previous = (trigger.state ?? {}) as { lastCandle?: number };
            if (lastClosed !== null && lastClosed !== previous.lastCandle) {
              const closes = candles.map((candle) => candle[4]);
              // The first look only records where it stands, so arming never fires on history.
              if (previous.lastCandle !== undefined && conditionMet(closes, config.condition, config.level)) {
                message = `Signal: ${trigger.market.symbol} - ${describeCondition(config.condition, config.level)} on the ${config.timeframe} candle that closed ${new Date(lastClosed * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC (close $${fmt(closes[closes.length - 1])}).`;
              }
              state = { lastCandle: lastClosed };
            }
          }
        } else if (trigger.type === "walletWatch") {
          nextRunAt = now + WALLET_CHECK_MS;
          const config = trigger.config as { addresses: string[]; label: string | null };
          const watched = config.addresses.map((address) => getAddress(address) as Address);
          const previous = (trigger.state ?? {}) as { lastBlock?: string; nonces?: Record<string, number> };
          const [latest, nonceList] = await Promise.all([
            logsClient.getBlockNumber(),
            Promise.all(watched.map((address) => bscPublicClient.getTransactionCount({ address }))),
          ]);
          const nonces = Object.fromEntries(watched.map((address, i) => [address, nonceList[i]]));
          const lines: string[] = [];

          if (previous.lastBlock && previous.nonces) {
            for (const address of watched) {
              const before = previous.nonces[address];
              if (before !== undefined && nonces[address] > before) {
                lines.push(`${short(address)} sent ${nonces[address] - before} new transaction(s)`);
              }
            }
            const from = BigInt(previous.lastBlock) + 1n;
            const start = latest - from > MAX_BLOCK_RANGE ? latest - MAX_BLOCK_RANGE : from;
            if (start <= latest) {
              const tracked = [
                ...(trigger.market ? [trigger.market.tokenAddress] : []),
                ...verifiedTokens().flatMap((token) => (token.address ? [token.address] : [])),
              ].map((address) => getAddress(address) as Address);
              const tokens = [...new Set(tracked)];
              const [sent, received] = await Promise.all([
                logsClient.getLogs({ address: tokens, event: TRANSFER, args: { from: watched }, fromBlock: start, toBlock: latest }),
                logsClient.getLogs({ address: tokens, event: TRANSFER, args: { to: watched }, fromBlock: start, toBlock: latest }),
              ]);
              const moves = [
                ...sent.map((log) => ({ wallet: log.args.from!, token: log.address, value: log.args.value ?? 0n, way: "sent" })),
                ...received.map((log) => ({ wallet: log.args.to!, token: log.address, value: log.args.value ?? 0n, way: "received" })),
              ].slice(0, 12);
              const meta = new Map<string, { symbol: string; decimals: number }>();
              await Promise.all(
                [...new Set(moves.map((move) => move.token))].slice(0, 6).map(async (token) => {
                  try {
                    const [symbol, decimals] = await Promise.all([
                      bscPublicClient.readContract({ address: token, abi: ERC20_META, functionName: "symbol" }),
                      bscPublicClient.readContract({ address: token, abi: ERC20_META, functionName: "decimals" }),
                    ]);
                    meta.set(token.toLowerCase(), { symbol, decimals });
                  } catch {
                    /* An odd token: named by address below. */
                  }
                }),
              );
              for (const move of moves) {
                const info = meta.get(move.token.toLowerCase());
                const amount = info ? fmt(Number(move.value) / 10 ** info.decimals) : move.value.toString();
                lines.push(`${short(move.wallet)} ${move.way} ${amount} ${info?.symbol ?? short(move.token)} (token ${move.token})`);
              }
            }
          }
          if (lines.length > 0) {
            message = `Wallet watch${config.label ? ` (${config.label})` : ""}: ${lines.join("; ")}. Up to block ${latest}.`;
          }
          state = { lastBlock: latest.toString(), nonces };
        }
      } catch (cause) {
        // A source that did not answer: try again next time, keeping the old memory.
        console.warn("[autopilot] trigger check failed:", trigger.type, cause instanceof Error ? cause.message : cause);
      }

      await ctx.runMutation(internal.autopilot.saveTrigger, { triggerId: trigger._id, nextRunAt, state });
      if (message && (await ctx.runMutation(internal.autopilot.fire, { draftId: trigger.draftId as Id<"agentDrafts">, text: message }))) {
        fired++;
      }
    }
    return { checked: due.length, fired };
  },
});
