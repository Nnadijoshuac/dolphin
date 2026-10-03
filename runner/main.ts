/**
 * DOLPHIN RUNNER - an agent's trading rules, always on, on YOUR server.
 * (owner, 2026-10-03; Agent/PLAN-2026-10-03-fast-rules-binance-export.md, phase 4)
 *
 *   node dolphin-runner.mjs            paper: watches Binance, decides, trades nothing
 *   node dolphin-runner.mjs --live     real orders, with the keys in YOUR environment
 *
 * It keeps Binance's candle streams open and judges every rule the instant a
 * candle closes, with the same engine Dolphin runs (convex/lib/strategy.ts,
 * bundled in): no AI in the trade path. Keys never leave this machine:
 *   BINANCE_API_KEY / BINANCE_API_SECRET   Binance Exchange (spot / futures)
 *   `baw` signed in (Binance Agentic Wallet)  Binance Wallet - its session is local
 * Each trade is reported back to your agent on Dolphin, marked as reported by
 * this runner. Built by runner/build.mjs into web/public/runner/dolphin-runner.mjs.
 * Needs Node 20+ (Node 22+ uses live WebSocket streams; 20 polls every 2 s).
 */
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { afterCandle, decide, describeRule, EMPTY_STATE, resultPct, resultUsd, type Candle, type Decision, type Rule, type RuleState } from "../convex/lib/strategy";

const VERSION = "1.0.0";
const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const CONFIG = args[args.indexOf("--config") + 1] && args.includes("--config") ? args[args.indexOf("--config") + 1] : "agent.json";
const STATE_FILE = "runner-state.json";
const SPOT = "https://api.binance.com";
const FUTURES = "https://fapi.binance.com";

/*
 * Tokens the Binance Wallet may trade, by symbol - copied from Dolphin's
 * verified list (convex/lib/tradeTokens.ts, each checked there against its
 * official source). Native BNB is the 0xEeee... placeholder the Agentic Wallet uses.
 */
const BSC_TOKENS: Record<string, string> = {
  BNB: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  BTC: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  XVS: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63",
};
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

type AgentFile = {
  version: number;
  agent: { name: string };
  rules: Rule[];
  /** The daily loss limit across all rules (owner, 2026-10-03), enforced here with the same engine. */
  limits?: { dailyLossLimitUsd: number | null };
  report: { url: string; token: string } | null;
};
/** Per rule: the engine's state plus what this runner holds on the venue, so an exit sells exactly what was bought. */
type Held = { qty: string; orderRef: string | null; stopOrderId: number | null };
type Saved = Record<string, { state: RuleState; held: Held | null }> & { __loss?: { day: string; usd: number } };

/** Today's realized loss on this server, kept in runner-state.json so a restart does not reset it. */
function lossToday(saved: Saved): number {
  const day = new Date().toISOString().slice(0, 10);
  return saved.__loss?.day === day ? saved.__loss.usd : 0;
}

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...parts);

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/* ── Config and state ── */

function loadAgent(): AgentFile {
  if (!existsSync(CONFIG)) fail(`No ${CONFIG} here. Download it from your agent's page on Dolphin ("Run it on your server").`);
  const parsed = JSON.parse(readFileSync(CONFIG, "utf8")) as AgentFile;
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) fail(`${CONFIG} has no trading rules.`);
  return parsed;
}

function loadSaved(): Saved {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Saved;
  } catch {
    return {};
  }
}

function save(saved: Saved) {
  writeFileSync(STATE_FILE, JSON.stringify(saved, null, 2));
}

/* ── Binance: public candles ── */

function base(rule: Rule) {
  return rule.venue === "binance-futures" ? FUTURES : SPOT;
}

async function restCandles(rule: Rule, limit = 300): Promise<Candle[]> {
  const path = rule.venue === "binance-futures" ? "/fapi/v1/klines" : "/api/v3/klines";
  const response = await fetch(`${base(rule)}${path}?symbol=${rule.market}&interval=${rule.timeframe}&limit=${limit + 1}`);
  if (!response.ok) throw new Error(`Binance candles ${response.status}: ${(await response.text()).slice(0, 120)}`);
  const now = Date.now();
  return ((await response.json()) as unknown[][])
    .filter((row) => Number(row[6]) < now)
    .map((row) => ({ openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }));
}

/* ── Binance: signed requests (keys from YOUR environment only) ── */

async function signed(baseUrl: string, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | boolean>) {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be set in this server's environment.");
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: String(Date.now()), recvWindow: "5000" });
  query.set("signature", createHmac("sha256", secret).update(query.toString()).digest("hex"));
  const response = await fetch(`${baseUrl}${path}?${query}`, { method, headers: { "X-MBX-APIKEY": key } });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Binance ${response.status}: ${String(body.msg ?? JSON.stringify(body)).slice(0, 200)}`);
  return body;
}

const stepCache = new Map<string, { step: number; minQty: number }>();
async function lotSize(rule: Rule) {
  const key = `${rule.venue}:${rule.market}`;
  if (stepCache.has(key)) return stepCache.get(key)!;
  const path = rule.venue === "binance-futures" ? "/fapi/v1/exchangeInfo" : `/api/v3/exchangeInfo?symbol=${rule.market}`;
  const info = (await (await fetch(`${base(rule)}${path}`)).json()) as { symbols: { symbol: string; filters: { filterType: string; stepSize?: string; minQty?: string }[] }[] };
  const symbol = info.symbols.find((candidate) => candidate.symbol === rule.market);
  const filter = symbol?.filters.find((candidate) => candidate.filterType === (rule.venue === "binance-futures" ? "MARKET_LOT_SIZE" : "LOT_SIZE")) ?? symbol?.filters.find((f) => f.filterType === "LOT_SIZE");
  if (!filter?.stepSize) throw new Error(`Binance has no ${rule.market} market for this venue.`);
  const found = { step: Number(filter.stepSize), minQty: Number(filter.minQty ?? 0) };
  stepCache.set(key, found);
  return found;
}

function roundDown(qty: number, step: number): string {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return (Math.floor(qty / step) * step).toFixed(decimals);
}

/* ── Binance Wallet (Agentic Wallet) through YOUR signed-in `baw` CLI ── */

function baw(argv: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(process.env.BAW_BIN || "baw", [...argv, "--json"], { timeout: 60_000 }, (error, stdout) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
      if (error && !parsed.success) return reject(new Error(`baw: ${error.message.slice(0, 200)}`));
      if (parsed.success === false) return reject(new Error(`baw: ${JSON.stringify(parsed.error ?? parsed).slice(0, 200)}`));
      resolve(parsed);
    });
  });
}

async function walletBalance(token: string): Promise<number> {
  const result = await baw(["wallet", "balance", "--tokenAddress", token, "--binanceChainId", "56"]);
  const rows = (result.data ?? []) as { address?: string; balance?: string }[];
  return Number(rows.find((row) => (row.address ?? "").toLowerCase() === token.toLowerCase())?.balance ?? 0);
}

/** A swap is only done when it reaches FINISHED - the skill's own rule. */
async function walletSwap(fromToken: string, toToken: string, qty: string): Promise<{ orderId: string; txHash: string | null }> {
  const submitted = await baw(["market-order", "swap", "--fromTokenQty", qty, "--fromToken", fromToken, "--toToken", toToken, "--binanceChainId", "56"]);
  const orderId = String((submitted.data as { orderId?: string })?.orderId ?? "");
  if (!orderId) throw new Error("baw returned no orderId.");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    const listed = await baw(["market-order", "list", "--orderId", orderId]);
    const order = ((listed.data as { list?: { status?: string; txHash?: string | null }[] })?.list ?? [])[0];
    if (order?.status === "FINISHED") return { orderId, txHash: order.txHash ?? null };
    if (order?.status === "FAILED") throw new Error(`The swap failed on-chain (order ${orderId}).`);
  }
  throw new Error(`The swap is still processing after 60 s (order ${orderId}); check it with: baw market-order list --orderId ${orderId}`);
}

/* ── Executing a decision on the rule's venue ── */

async function execute(rule: Rule, decision: Exclude<Decision, { type: "none" }>, held: Held | null): Promise<{ held: Held | null; orderRef: string | null; txHash: string | null }> {
  if (!LIVE) return { held: decision.type === "enter" ? { qty: "paper", orderRef: null, stopOrderId: null } : null, orderRef: null, txHash: null };

  if (rule.venue === "dolphin-wallet") throw new Error("Dolphin Wallet rules run inside Dolphin, not on this runner.");

  if (rule.venue === "binance-wallet") {
    const symbol = rule.market.replace(/(USDT|USDC|FDUSD|BUSD|USD1)$/, "");
    const token = BSC_TOKENS[symbol];
    if (!token) throw new Error(`The Binance Wallet runner trades ${Object.keys(BSC_TOKENS).join(", ")} against USDT; ${rule.market} is not one of them.`);
    if (decision.type === "enter") {
      const before = await walletBalance(token);
      const swap = await walletSwap(BSC_USDT, token, String(rule.sizeUsd));
      const bought = (await walletBalance(token)) - before;
      if (!(bought > 0)) throw new Error("The swap finished but no tokens arrived; check the wallet.");
      return { held: { qty: String(bought), orderRef: swap.orderId, stopOrderId: null }, orderRef: swap.orderId, txHash: swap.txHash };
    }
    const swap = await walletSwap(token, BSC_USDT, held?.qty ?? "0");
    return { held: null, orderRef: swap.orderId, txHash: swap.txHash };
  }

  const { step, minQty } = await lotSize(rule);
  if (rule.venue === "binance-spot") {
    if (decision.type === "enter") {
      const order = await signed(SPOT, "POST", "/api/v3/order", { symbol: rule.market, side: "BUY", type: "MARKET", quoteOrderQty: rule.sizeUsd });
      // Fees taken in the coin bought leave a little less to sell later.
      const fees = ((order.fills ?? []) as { commission: string; commissionAsset: string }[])
        .filter((fill) => rule.market.startsWith(fill.commissionAsset))
        .reduce((sum, fill) => sum + Number(fill.commission), 0);
      const qty = roundDown(Number(order.executedQty) - fees, step);
      return { held: { qty, orderRef: String(order.orderId), stopOrderId: null }, orderRef: String(order.orderId), txHash: null };
    }
    const order = await signed(SPOT, "POST", "/api/v3/order", { symbol: rule.market, side: "SELL", type: "MARKET", quantity: held?.qty ?? "0" });
    return { held: null, orderRef: String(order.orderId), txHash: null };
  }

  // Futures.
  if (decision.type === "enter") {
    await signed(FUTURES, "POST", "/fapi/v1/leverage", { symbol: rule.market, leverage: rule.leverage });
    const qty = roundDown((rule.sizeUsd * rule.leverage) / decision.price, step);
    if (Number(qty) < minQty) throw new Error(`$${rule.sizeUsd} at ${rule.leverage}x is below Binance's minimum ${rule.market} order.`);
    const side = decision.side === "long" ? "BUY" : "SELL";
    const order = await signed(FUTURES, "POST", "/fapi/v1/order", { symbol: rule.market, side, type: "MARKET", quantity: qty });
    // The stop lives ON the exchange too, so it protects between candle closes and if this server stops.
    let stopOrderId: number | null = null;
    if (rule.stopLossPct !== null) {
      const stopPrice = decision.price * (decision.side === "long" ? 1 - rule.stopLossPct / 100 : 1 + rule.stopLossPct / 100);
      const stop = await signed(FUTURES, "POST", "/fapi/v1/order", {
        symbol: rule.market,
        side: side === "BUY" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        stopPrice: stopPrice.toFixed(2),
        closePosition: true,
        workingType: "MARK_PRICE",
      });
      stopOrderId = Number(stop.orderId);
    }
    return { held: { qty, orderRef: String(order.orderId), stopOrderId }, orderRef: String(order.orderId), txHash: null };
  }
  if (held?.stopOrderId) await signed(FUTURES, "DELETE", "/fapi/v1/order", { symbol: rule.market, orderId: held.stopOrderId }).catch(() => undefined);
  const order = await signed(FUTURES, "POST", "/fapi/v1/order", {
    symbol: rule.market,
    side: decision.side === "long" ? "SELL" : "BUY",
    type: "MARKET",
    quantity: held?.qty ?? "0",
    reduceOnly: true,
  });
  return { held: null, orderRef: String(order.orderId), txHash: null };
}

/* ── Reporting to the agent on Dolphin ── */

async function report(agent: AgentFile, payload: Record<string, unknown>) {
  if (!agent.report) return;
  try {
    const response = await fetch(agent.report.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: agent.report.token, runnerVersion: VERSION, ...payload }),
    });
    if (!response.ok) log("Dolphin did not take the report:", response.status, (await response.text()).slice(0, 120));
  } catch (cause) {
    log("Could not reach Dolphin to report:", cause instanceof Error ? cause.message : cause);
  }
}

/* ── The loop: one feed per market and timeframe, every rule judged on each close ── */

type Feed = { key: string; rule: Rule; rules: Rule[]; candles: Candle[] };

/** When the close arrived here, and how long after the candle closed Binance sent it (its own two timestamps). */
type Arrival = { receivedAt: number; exchangeLagMs: number | null };

async function onClosed(agent: AgentFile, feed: Feed, saved: Saved, arrival: Arrival) {
  for (const rule of feed.rules) {
    const entry = (saved[rule.id] as { state: RuleState; held: Held | null } | undefined) ?? { state: EMPTY_STATE, held: null };
    const judged = feed.candles[feed.candles.length - 1];
    // Starting up never trades on history: the first look only records where the market stands.
    if (entry.state.lastCandle === null) {
      saved[rule.id] = { ...entry, state: { ...entry.state, lastCandle: judged.openTime } };
      continue;
    }
    const decision = decide(rule, feed.candles, entry.state, Date.now(), { limitUsd: agent.limits?.dailyLossLimitUsd ?? null, lossTodayUsd: lossToday(saved) });
    if (decision.type === "none") {
      saved[rule.id] = { ...entry, state: afterCandle(entry.state, judged.openTime, decision, true, Date.now()) };
      continue;
    }
    const decidedMs = Date.now() - arrival.receivedAt;
    let executed = false;
    let result: Awaited<ReturnType<typeof execute>> = { held: entry.held, orderRef: null, txHash: null };
    try {
      result = await execute(rule, decision, entry.held);
      executed = true;
    } catch (cause) {
      log(`  ${rule.market} ${decision.type} NOT executed:`, cause instanceof Error ? cause.message : cause);
    }
    const pnlPct = decision.type === "exit" && entry.state.position ? resultPct(entry.state.position.side, entry.state.position.entryPrice, decision.price, rule.leverage) : null;
    saved[rule.id] = { state: afterCandle(entry.state, judged.openTime, decision, executed, Date.now()), held: executed ? result.held : entry.held };
    if (executed && pnlPct !== null && resultUsd(pnlPct, rule.sizeUsd) < 0) {
      saved.__loss = { day: new Date().toISOString().slice(0, 10), usd: Math.round((lossToday(saved) - resultUsd(pnlPct, rule.sizeUsd)) * 100) / 100 };
      if (agent.limits?.dailyLossLimitUsd && saved.__loss.usd >= agent.limits.dailyLossLimitUsd) {
        log(`Daily loss limit reached ($${saved.__loss.usd} of $${agent.limits.dailyLossLimitUsd}): no new trades until midnight UTC. Exits still run.`);
      }
    }
    save(saved);
    if (!executed) continue;
    log(
      `${LIVE ? "LIVE" : "paper"} ${decision.type === "enter" ? (decision.side === "short" ? "SHORT" : "BUY") : "EXIT"} ${rule.market} @ ${decision.price}` +
        `${pnlPct !== null ? ` (${pnlPct > 0 ? "+" : ""}${pnlPct}%)` : ""} · decided in ${decidedMs} ms` +
        `${arrival.exchangeLagMs !== null ? ` (Binance sent the close ${arrival.exchangeLagMs} ms after it)` : ""} · ${decision.reason}`,
    );
    await report(agent, {
      ruleId: rule.id,
      kind: decision.type,
      side: decision.side,
      price: decision.price,
      sizeUsd: rule.sizeUsd,
      leverage: rule.leverage,
      pnlPct,
      reason: decision.reason,
      candleTime: judged.openTime,
      paper: !LIVE,
      venue: rule.venue,
      market: rule.market,
      orderRef: result.orderRef,
      txHash: result.txHash,
      latencyMs: decidedMs,
      exchangeLagMs: arrival.exchangeLagMs,
    });
  }
  save(saved);
}

function pushCandle(feed: Feed, candle: Candle): boolean {
  const last = feed.candles[feed.candles.length - 1];
  if (last && candle.openTime <= last.openTime) return false;
  feed.candles.push(candle);
  if (feed.candles.length > 500) feed.candles.shift();
  return true;
}

function stream(agent: AgentFile, feed: Feed, saved: Saved) {
  /*
   * Futures market data moved to /market/ws: the old fstream /ws address stopped
   * sending data on 2026-04-23 (Binance's WebSocket upgrade notice) - it still
   * accepts the connection, then stays silent. Found by running it, 2026-10-03.
   */
  const host = feed.rule.venue === "binance-futures" ? "wss://fstream.binance.com/market/ws" : "wss://stream.binance.com:9443/ws";
  const url = `${host}/${feed.rule.market.toLowerCase()}@kline_${feed.rule.timeframe}`;
  const WS = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
  if (!WS) {
    // Node 20: poll for each new closed candle every 2 s.
    setInterval(async () => {
      try {
        const latest = (await restCandles(feed.rule, 3)).at(-1);
        if (latest && pushCandle(feed, latest)) await onClosed(agent, feed, saved, { receivedAt: Date.now(), exchangeLagMs: null });
      } catch (cause) {
        log("poll:", cause instanceof Error ? cause.message : cause);
      }
    }, 2_000);
    return;
  }
  const connect = (delay: number) => {
    const socket = new WS(url);
    socket.onopen = () => log(`streaming ${feed.key}`);
    socket.onmessage = async (event: MessageEvent) => {
      const receivedAt = Date.now();
      const message = JSON.parse(String(event.data)) as { E?: number; k?: { t: number; T: number; o: string; h: string; l: string; c: string; x: boolean } };
      const k = message.k;
      if (!k?.x) return; // only CLOSED candles
      const arrival = { receivedAt, exchangeLagMs: typeof message.E === "number" ? Math.max(0, message.E - k.T) : null };
      if (pushCandle(feed, { openTime: k.t, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c) })) await onClosed(agent, feed, saved, arrival);
    };
    socket.onclose = () => {
      log(`stream ${feed.key} closed; reconnecting in ${Math.round(delay / 1000)} s`);
      setTimeout(() => connect(Math.min(delay * 2, 60_000)), delay);
    };
    socket.onerror = () => socket.close();
  };
  connect(1_000);
}

async function main() {
  const agent = loadAgent();
  const saved = loadSaved();
  console.log(`\n  Dolphin runner ${VERSION} · ${agent.agent.name} · ${LIVE ? "LIVE - real orders" : "paper - no orders (add --live for real ones)"}\n`);
  for (const rule of agent.rules) console.log(`  • ${describeRule(rule)} [${rule.venue}]`);
  if (agent.limits?.dailyLossLimitUsd) console.log(`  • Daily loss limit: $${agent.limits.dailyLossLimitUsd} across all rules (today so far: $${lossToday(saved)})`);
  console.log("");
  if (LIVE && agent.rules.some((rule) => rule.venue === "binance-spot" || rule.venue === "binance-futures") && !(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET)) {
    fail("Live Exchange rules need BINANCE_API_KEY and BINANCE_API_SECRET in this server's environment (withdrawals off, IP-restricted to this server).");
  }
  if (LIVE && agent.rules.some((rule) => rule.venue === "dolphin-wallet")) log("Dolphin Wallet rules are skipped here: they run inside Dolphin.");
  const feeds = new Map<string, Feed>();
  for (const rule of agent.rules.filter((candidate) => candidate.venue !== "dolphin-wallet" || !LIVE)) {
    const key = `${rule.venue === "binance-futures" ? "futures" : "spot"}:${rule.market}:${rule.timeframe}`;
    const feed = feeds.get(key) ?? { key, rule, rules: [], candles: [] };
    feed.rules.push(rule);
    feeds.set(key, feed);
  }
  for (const feed of feeds.values()) {
    feed.candles = await restCandles(feed.rule);
    log(`loaded ${feed.candles.length} closed candles for ${feed.key}`);
    await onClosed(agent, feed, saved, { receivedAt: Date.now(), exchangeLagMs: null });
    stream(agent, feed, saved);
  }
}

main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
