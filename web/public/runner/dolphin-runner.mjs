// Dolphin runner - built from github.com/Nnadijoshuac/dolphin runner/main.ts. Your keys never leave this machine.

// runner/main.ts
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// convex/lib/indicators.ts
function smaSeries(values, length) {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    let sum = 0;
    for (let i = index - length + 1; i <= index; i++) sum += values[i];
    return sum / length;
  });
}
function emaSeries(values, length) {
  const k = 2 / (length + 1);
  const out = [];
  let ema = null;
  values.forEach((value, index) => {
    if (index + 1 < length) {
      out.push(null);
      return;
    }
    if (ema === null) {
      ema = values.slice(index - length + 1, index + 1).reduce((sum, v) => sum + v, 0) / length;
    } else {
      ema = value * k + ema * (1 - k);
    }
    out.push(ema);
  });
  return out;
}
function rsiSeries(closes, period = 14) {
  const out = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
function macdSeries(closes) {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i] - slow[i] : null);
  const defined = line.filter((value) => value !== null);
  const signalDefined = emaSeries(defined, 9);
  const offset = line.length - defined.length;
  const signal = line.map((_, i) => i < offset ? null : signalDefined[i - offset]);
  return { line, signal, histogram: line.map((value, i) => value !== null && signal[i] !== null ? value - signal[i] : null) };
}

// convex/lib/strategy.ts
var EMPTY_STATE = { position: null, lastCandle: null, tradesToday: 0, tradesDay: null, lastTradeAt: null };
var LIMITS = {
  maxConditions: 6,
  maxSizeUsd: 1e5,
  maxLeverage: 5,
  /** Owner, 2026-10-03: 1-3x is the normal range; up to 5x is allowed, with a warning. */
  comfortableLeverage: 3,
  maxTradesPerDay: 50,
  maxCooldownMinutes: 7 * 24 * 60,
  maxLength: 400,
  maxTrendCandles: 20
};
function last(series) {
  return series.length ? series[series.length - 1] : null;
}
function holds(condition, candles) {
  const closes = candles.map((candle) => candle.close);
  const n = closes.length;
  if (n === 0) return false;
  const close = closes[n - 1];
  switch (condition.kind) {
    case "price":
      return condition.op === "above" ? close > condition.value : close < condition.value;
    case "rsi": {
      const rsi = last(rsiSeries(closes, condition.period ?? 14));
      if (rsi === null) return false;
      return condition.op === "above" ? rsi > condition.value : rsi < condition.value;
    }
    case "price_vs_ma": {
      const ma = last(condition.ma === "ema" ? emaSeries(closes, condition.length) : smaSeries(closes, condition.length));
      if (ma === null) return false;
      return condition.op === "above" ? close > ma : close < ma;
    }
    case "ma_cross": {
      const series = (length) => condition.ma === "ema" ? emaSeries(closes, length) : smaSeries(closes, length);
      const fast = series(condition.fast);
      const slow = series(condition.slow);
      if (n < 2 || fast[n - 2] === null || slow[n - 2] === null || fast[n - 1] === null || slow[n - 1] === null) return false;
      const before = fast[n - 2] - slow[n - 2];
      const now = fast[n - 1] - slow[n - 1];
      return condition.direction === "up" ? before <= 0 && now > 0 : before >= 0 && now < 0;
    }
    case "macd_cross": {
      const { histogram } = macdSeries(closes);
      if (n < 2 || histogram[n - 2] === null || histogram[n - 1] === null) return false;
      return condition.direction === "up" ? histogram[n - 2] <= 0 && histogram[n - 1] > 0 : histogram[n - 2] >= 0 && histogram[n - 1] < 0;
    }
    case "trend": {
      if (n < condition.candles + 1) return false;
      for (let i = n - condition.candles; i < n; i++) {
        if (condition.direction === "down" ? !(closes[i] < closes[i - 1]) : !(closes[i] > closes[i - 1])) return false;
      }
      return true;
    }
    case "change_pct": {
      if (n < condition.candles + 1) return false;
      const from = closes[n - 1 - condition.candles];
      if (!(from > 0)) return false;
      const change = (close - from) / from * 100;
      return condition.op === "above" ? change > condition.value : change < condition.value;
    }
  }
}
function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function decide(rule, candles, state, now) {
  const judged = candles[candles.length - 1];
  if (!judged) return { type: "none", reason: "No closed candle yet." };
  if (state.lastCandle !== null && judged.openTime <= state.lastCandle) return { type: "none", reason: "Already judged this candle." };
  const price = judged.close;
  if (state.position) {
    const { side: side2, entryPrice } = state.position;
    const movePct = (price - entryPrice) / entryPrice * 100 * (side2 === "long" ? 1 : -1);
    if (rule.stopLossPct !== null && movePct <= -rule.stopLossPct) {
      return { type: "exit", side: side2, price, reason: `Stop-loss: ${movePct.toFixed(2)}% against the position.` };
    }
    if (rule.takeProfitPct !== null && movePct >= rule.takeProfitPct) {
      return { type: "exit", side: side2, price, reason: `Take-profit: ${movePct.toFixed(2)}% in favour.` };
    }
    if (rule.until.length > 0 && rule.until.every((condition) => holds(condition, candles))) {
      return { type: "exit", side: side2, price, reason: `Exit rule met: ${rule.until.map(describe).join(" and ")}.` };
    }
    return { type: "none", reason: "Holding." };
  }
  if (rule.when.length === 0 || !rule.when.every((condition) => holds(condition, candles))) {
    return { type: "none", reason: "Entry conditions not met." };
  }
  const today = utcDay(now);
  if (state.tradesDay === today && state.tradesToday >= rule.maxTradesPerDay) {
    return { type: "none", reason: `Daily cap of ${rule.maxTradesPerDay} trades reached.` };
  }
  if (state.lastTradeAt !== null && now - state.lastTradeAt < rule.cooldownMinutes * 6e4) {
    return { type: "none", reason: "Cooling down after the last trade." };
  }
  const side = rule.action === "short" ? "short" : "long";
  if (side === "short" && rule.venue !== "binance-futures") {
    return { type: "none", reason: "Shorting needs Binance Futures; this venue only buys." };
  }
  return { type: "enter", side, action: rule.action, price, reason: `Entry rule met: ${rule.when.map(describe).join(" and ")}.` };
}
function afterCandle(state, candleOpenTime, decision, executed, now) {
  const today = utcDay(now);
  const tradesToday = state.tradesDay === today ? state.tradesToday : 0;
  const next = { ...state, lastCandle: candleOpenTime, tradesDay: today, tradesToday };
  if (!executed || decision.type === "none") return next;
  if (decision.type === "enter") {
    return { ...next, position: { side: decision.side, entryPrice: decision.price, openedAt: now }, tradesToday: tradesToday + 1, lastTradeAt: now };
  }
  return { ...next, position: null, lastTradeAt: now };
}
function resultPct(side, entry, exit, leverage) {
  const move = (exit - entry) / entry * 100 * (side === "long" ? 1 : -1);
  return Math.round(move * leverage * 100) / 100 + 0;
}
function describe(condition) {
  switch (condition.kind) {
    case "price":
      return `the price is ${condition.op} $${condition.value}`;
    case "rsi":
      return `RSI${condition.period && condition.period !== 14 ? `(${condition.period})` : ""} is ${condition.op} ${condition.value}`;
    case "price_vs_ma":
      return `the price is ${condition.op} the ${condition.length} ${condition.ma.toUpperCase()}`;
    case "ma_cross":
      return `the ${condition.fast} crosses ${condition.direction === "up" ? "above" : "below"} the ${condition.slow}${condition.ma === "ema" ? " EMA" : ""}`;
    case "macd_cross":
      return `MACD crosses ${condition.direction === "up" ? "above" : "below"} its signal`;
    case "trend":
      return `${condition.candles} candles in a row close ${condition.direction === "down" ? "lower" : "higher"}`;
    case "change_pct":
      return `the price moves ${condition.op} ${condition.value}% over ${condition.candles} candles`;
  }
}
function describeRule(rule) {
  const verb = rule.action === "short" ? "short" : "buy";
  const exits = [
    ...rule.until.length ? [`when ${rule.until.map(describe).join(" and ")}`] : [],
    ...rule.stopLossPct !== null ? [`at a ${rule.stopLossPct}% loss`] : [],
    ...rule.takeProfitPct !== null ? [`at a ${rule.takeProfitPct}% gain`] : []
  ];
  return `On ${rule.market} ${rule.timeframe} candles: when ${rule.when.map(describe).join(" and ")}, ${verb} $${rule.sizeUsd}` + (rule.leverage > 1 ? ` at ${rule.leverage}x` : "") + (exits.length ? `; get out ${exits.join(", or ")}` : "") + `. At most ${rule.maxTradesPerDay} a day.`;
}

// runner/main.ts
var VERSION = "1.0.0";
var args = process.argv.slice(2);
var LIVE = args.includes("--live");
var CONFIG = args[args.indexOf("--config") + 1] && args.includes("--config") ? args[args.indexOf("--config") + 1] : "agent.json";
var STATE_FILE = "runner-state.json";
var SPOT = "https://api.binance.com";
var FUTURES = "https://fapi.binance.com";
var BSC_TOKENS = {
  BNB: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  BTC: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  XVS: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63"
};
var BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
var log = (...parts) => console.log((/* @__PURE__ */ new Date()).toISOString().slice(11, 23), ...parts);
function fail(message) {
  console.error(`
  ${message}
`);
  process.exit(1);
}
function loadAgent() {
  if (!existsSync(CONFIG)) fail(`No ${CONFIG} here. Download it from your agent's page on Dolphin ("Run it on your server").`);
  const parsed = JSON.parse(readFileSync(CONFIG, "utf8"));
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) fail(`${CONFIG} has no trading rules.`);
  return parsed;
}
function loadSaved() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function save(saved) {
  writeFileSync(STATE_FILE, JSON.stringify(saved, null, 2));
}
function base(rule) {
  return rule.venue === "binance-futures" ? FUTURES : SPOT;
}
async function restCandles(rule, limit = 300) {
  const path = rule.venue === "binance-futures" ? "/fapi/v1/klines" : "/api/v3/klines";
  const response = await fetch(`${base(rule)}${path}?symbol=${rule.market}&interval=${rule.timeframe}&limit=${limit + 1}`);
  if (!response.ok) throw new Error(`Binance candles ${response.status}: ${(await response.text()).slice(0, 120)}`);
  const now = Date.now();
  return (await response.json()).filter((row) => Number(row[6]) < now).map((row) => ({ openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }));
}
async function signed(baseUrl, method, path, params) {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be set in this server's environment.");
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), timestamp: String(Date.now()), recvWindow: "5000" });
  query.set("signature", createHmac("sha256", secret).update(query.toString()).digest("hex"));
  const response = await fetch(`${baseUrl}${path}?${query}`, { method, headers: { "X-MBX-APIKEY": key } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Binance ${response.status}: ${String(body.msg ?? JSON.stringify(body)).slice(0, 200)}`);
  return body;
}
var stepCache = /* @__PURE__ */ new Map();
async function lotSize(rule) {
  const key = `${rule.venue}:${rule.market}`;
  if (stepCache.has(key)) return stepCache.get(key);
  const path = rule.venue === "binance-futures" ? "/fapi/v1/exchangeInfo" : `/api/v3/exchangeInfo?symbol=${rule.market}`;
  const info = await (await fetch(`${base(rule)}${path}`)).json();
  const symbol = info.symbols.find((candidate) => candidate.symbol === rule.market);
  const filter = symbol?.filters.find((candidate) => candidate.filterType === (rule.venue === "binance-futures" ? "MARKET_LOT_SIZE" : "LOT_SIZE")) ?? symbol?.filters.find((f) => f.filterType === "LOT_SIZE");
  if (!filter?.stepSize) throw new Error(`Binance has no ${rule.market} market for this venue.`);
  const found = { step: Number(filter.stepSize), minQty: Number(filter.minQty ?? 0) };
  stepCache.set(key, found);
  return found;
}
function roundDown(qty, step) {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return (Math.floor(qty / step) * step).toFixed(decimals);
}
function baw(argv) {
  return new Promise((resolve, reject) => {
    execFile(process.env.BAW_BIN || "baw", [...argv, "--json"], { timeout: 6e4 }, (error, stdout) => {
      let parsed = {};
      try {
        parsed = JSON.parse(stdout);
      } catch {
      }
      if (error && !parsed.success) return reject(new Error(`baw: ${error.message.slice(0, 200)}`));
      if (parsed.success === false) return reject(new Error(`baw: ${JSON.stringify(parsed.error ?? parsed).slice(0, 200)}`));
      resolve(parsed);
    });
  });
}
async function walletBalance(token) {
  const result = await baw(["wallet", "balance", "--tokenAddress", token, "--binanceChainId", "56"]);
  const rows = result.data ?? [];
  return Number(rows.find((row) => (row.address ?? "").toLowerCase() === token.toLowerCase())?.balance ?? 0);
}
async function walletSwap(fromToken, toToken, qty) {
  const submitted = await baw(["market-order", "swap", "--fromTokenQty", qty, "--fromToken", fromToken, "--toToken", toToken, "--binanceChainId", "56"]);
  const orderId = String(submitted.data?.orderId ?? "");
  if (!orderId) throw new Error("baw returned no orderId.");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2e3));
    const listed = await baw(["market-order", "list", "--orderId", orderId]);
    const order = (listed.data?.list ?? [])[0];
    if (order?.status === "FINISHED") return { orderId, txHash: order.txHash ?? null };
    if (order?.status === "FAILED") throw new Error(`The swap failed on-chain (order ${orderId}).`);
  }
  throw new Error(`The swap is still processing after 60 s (order ${orderId}); check it with: baw market-order list --orderId ${orderId}`);
}
async function execute(rule, decision, held) {
  if (!LIVE) return { held: decision.type === "enter" ? { qty: "paper", orderRef: null, stopOrderId: null } : null, orderRef: null, txHash: null };
  if (rule.venue === "dolphin-wallet") throw new Error("Dolphin Wallet rules run inside Dolphin, not on this runner.");
  if (rule.venue === "binance-wallet") {
    const symbol = rule.market.replace(/(USDT|USDC|FDUSD|BUSD|USD1)$/, "");
    const token = BSC_TOKENS[symbol];
    if (!token) throw new Error(`The Binance Wallet runner trades ${Object.keys(BSC_TOKENS).join(", ")} against USDT; ${rule.market} is not one of them.`);
    if (decision.type === "enter") {
      const before = await walletBalance(token);
      const swap2 = await walletSwap(BSC_USDT, token, String(rule.sizeUsd));
      const bought = await walletBalance(token) - before;
      if (!(bought > 0)) throw new Error("The swap finished but no tokens arrived; check the wallet.");
      return { held: { qty: String(bought), orderRef: swap2.orderId, stopOrderId: null }, orderRef: swap2.orderId, txHash: swap2.txHash };
    }
    const swap = await walletSwap(token, BSC_USDT, held?.qty ?? "0");
    return { held: null, orderRef: swap.orderId, txHash: swap.txHash };
  }
  const { step, minQty } = await lotSize(rule);
  if (rule.venue === "binance-spot") {
    if (decision.type === "enter") {
      const order3 = await signed(SPOT, "POST", "/api/v3/order", { symbol: rule.market, side: "BUY", type: "MARKET", quoteOrderQty: rule.sizeUsd });
      const fees = (order3.fills ?? []).filter((fill) => rule.market.startsWith(fill.commissionAsset)).reduce((sum, fill) => sum + Number(fill.commission), 0);
      const qty = roundDown(Number(order3.executedQty) - fees, step);
      return { held: { qty, orderRef: String(order3.orderId), stopOrderId: null }, orderRef: String(order3.orderId), txHash: null };
    }
    const order2 = await signed(SPOT, "POST", "/api/v3/order", { symbol: rule.market, side: "SELL", type: "MARKET", quantity: held?.qty ?? "0" });
    return { held: null, orderRef: String(order2.orderId), txHash: null };
  }
  if (decision.type === "enter") {
    await signed(FUTURES, "POST", "/fapi/v1/leverage", { symbol: rule.market, leverage: rule.leverage });
    const qty = roundDown(rule.sizeUsd * rule.leverage / decision.price, step);
    if (Number(qty) < minQty) throw new Error(`$${rule.sizeUsd} at ${rule.leverage}x is below Binance's minimum ${rule.market} order.`);
    const side = decision.side === "long" ? "BUY" : "SELL";
    const order2 = await signed(FUTURES, "POST", "/fapi/v1/order", { symbol: rule.market, side, type: "MARKET", quantity: qty });
    let stopOrderId = null;
    if (rule.stopLossPct !== null) {
      const stopPrice = decision.price * (decision.side === "long" ? 1 - rule.stopLossPct / 100 : 1 + rule.stopLossPct / 100);
      const stop = await signed(FUTURES, "POST", "/fapi/v1/order", {
        symbol: rule.market,
        side: side === "BUY" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        stopPrice: stopPrice.toFixed(2),
        closePosition: true,
        workingType: "MARK_PRICE"
      });
      stopOrderId = Number(stop.orderId);
    }
    return { held: { qty, orderRef: String(order2.orderId), stopOrderId }, orderRef: String(order2.orderId), txHash: null };
  }
  if (held?.stopOrderId) await signed(FUTURES, "DELETE", "/fapi/v1/order", { symbol: rule.market, orderId: held.stopOrderId }).catch(() => void 0);
  const order = await signed(FUTURES, "POST", "/fapi/v1/order", {
    symbol: rule.market,
    side: decision.side === "long" ? "SELL" : "BUY",
    type: "MARKET",
    quantity: held?.qty ?? "0",
    reduceOnly: true
  });
  return { held: null, orderRef: String(order.orderId), txHash: null };
}
async function report(agent, payload) {
  if (!agent.report) return;
  try {
    const response = await fetch(agent.report.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: agent.report.token, runnerVersion: VERSION, ...payload })
    });
    if (!response.ok) log("Dolphin did not take the report:", response.status, (await response.text()).slice(0, 120));
  } catch (cause) {
    log("Could not reach Dolphin to report:", cause instanceof Error ? cause.message : cause);
  }
}
async function onClosed(agent, feed, saved, arrival) {
  for (const rule of feed.rules) {
    const entry = saved[rule.id] ?? { state: EMPTY_STATE, held: null };
    const judged = feed.candles[feed.candles.length - 1];
    if (entry.state.lastCandle === null) {
      saved[rule.id] = { ...entry, state: { ...entry.state, lastCandle: judged.openTime } };
      continue;
    }
    const decision = decide(rule, feed.candles, entry.state, Date.now());
    if (decision.type === "none") {
      saved[rule.id] = { ...entry, state: afterCandle(entry.state, judged.openTime, decision, true, Date.now()) };
      continue;
    }
    const decidedMs = Date.now() - arrival.receivedAt;
    let executed = false;
    let result = { held: entry.held, orderRef: null, txHash: null };
    try {
      result = await execute(rule, decision, entry.held);
      executed = true;
    } catch (cause) {
      log(`  ${rule.market} ${decision.type} NOT executed:`, cause instanceof Error ? cause.message : cause);
    }
    const pnlPct = decision.type === "exit" && entry.state.position ? resultPct(entry.state.position.side, entry.state.position.entryPrice, decision.price, rule.leverage) : null;
    saved[rule.id] = { state: afterCandle(entry.state, judged.openTime, decision, executed, Date.now()), held: executed ? result.held : entry.held };
    save(saved);
    if (!executed) continue;
    log(
      `${LIVE ? "LIVE" : "paper"} ${decision.type === "enter" ? decision.side === "short" ? "SHORT" : "BUY" : "EXIT"} ${rule.market} @ ${decision.price}${pnlPct !== null ? ` (${pnlPct > 0 ? "+" : ""}${pnlPct}%)` : ""} \xB7 decided in ${decidedMs} ms${arrival.exchangeLagMs !== null ? ` (Binance sent the close ${arrival.exchangeLagMs} ms after it)` : ""} \xB7 ${decision.reason}`
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
      exchangeLagMs: arrival.exchangeLagMs
    });
  }
  save(saved);
}
function pushCandle(feed, candle) {
  const last2 = feed.candles[feed.candles.length - 1];
  if (last2 && candle.openTime <= last2.openTime) return false;
  feed.candles.push(candle);
  if (feed.candles.length > 500) feed.candles.shift();
  return true;
}
function stream(agent, feed, saved) {
  const host = feed.rule.venue === "binance-futures" ? "wss://fstream.binance.com/market/ws" : "wss://stream.binance.com:9443/ws";
  const url = `${host}/${feed.rule.market.toLowerCase()}@kline_${feed.rule.timeframe}`;
  const WS = globalThis.WebSocket;
  if (!WS) {
    setInterval(async () => {
      try {
        const latest = (await restCandles(feed.rule, 3)).at(-1);
        if (latest && pushCandle(feed, latest)) await onClosed(agent, feed, saved, { receivedAt: Date.now(), exchangeLagMs: null });
      } catch (cause) {
        log("poll:", cause instanceof Error ? cause.message : cause);
      }
    }, 2e3);
    return;
  }
  const connect = (delay) => {
    const socket = new WS(url);
    socket.onopen = () => log(`streaming ${feed.key}`);
    socket.onmessage = async (event) => {
      const receivedAt = Date.now();
      const message = JSON.parse(String(event.data));
      const k = message.k;
      if (!k?.x) return;
      const arrival = { receivedAt, exchangeLagMs: typeof message.E === "number" ? Math.max(0, message.E - k.T) : null };
      if (pushCandle(feed, { openTime: k.t, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c) })) await onClosed(agent, feed, saved, arrival);
    };
    socket.onclose = () => {
      log(`stream ${feed.key} closed; reconnecting in ${Math.round(delay / 1e3)} s`);
      setTimeout(() => connect(Math.min(delay * 2, 6e4)), delay);
    };
    socket.onerror = () => socket.close();
  };
  connect(1e3);
}
async function main() {
  const agent = loadAgent();
  const saved = loadSaved();
  console.log(`
  Dolphin runner ${VERSION} \xB7 ${agent.agent.name} \xB7 ${LIVE ? "LIVE - real orders" : "paper - no orders (add --live for real ones)"}
`);
  for (const rule of agent.rules) console.log(`  \u2022 ${describeRule(rule)} [${rule.venue}]`);
  console.log("");
  if (LIVE && agent.rules.some((rule) => rule.venue === "binance-spot" || rule.venue === "binance-futures") && !(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET)) {
    fail("Live Exchange rules need BINANCE_API_KEY and BINANCE_API_SECRET in this server's environment (withdrawals off, IP-restricted to this server).");
  }
  if (LIVE && agent.rules.some((rule) => rule.venue === "dolphin-wallet")) log("Dolphin Wallet rules are skipped here: they run inside Dolphin.");
  const feeds = /* @__PURE__ */ new Map();
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
