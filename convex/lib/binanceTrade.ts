/**
 * BINANCE ORDERS FROM INSIDE DOLPHIN (owner, 2026-10-03: "allow it to go through completely ...
 * if they carry their key and put it here, it's on them").
 *
 * The builder saves their own Binance API key and secret in the Keys tab (encrypted,
 * lib/secretBox.ts); the Binance block names them and picks TESTNET or LIVE. This module signs
 * and sends orders with them. It is the runner's order code (runner/main.ts execute) ported to
 * Convex: HMAC-SHA256 through crypto.subtle instead of node:crypto, and every base URL chosen
 * by network.
 *
 * Guardrails, enforced in `checkConnection` before a key is ever used for live orders:
 *   - LIVE keys must NOT be able to withdraw (GET /sapi/v1/account/apiRestrictions). A key that
 *     can only trade cannot move money off the account even if Dolphin were breached.
 *   - Spot trading must be enabled; futures only when the block trades futures.
 * Testnet has no apiRestrictions endpoint and no real money, so it is only checked to answer.
 */

export type BinanceNetwork = "testnet" | "live";
export type BinanceKeys = { apiKey: string; secret: string };

const BASES: Record<BinanceNetwork, { spot: string; futures: string }> = {
  live: { spot: "https://api.binance.com", futures: "https://fapi.binance.com" },
  testnet: { spot: "https://testnet.binance.vision", futures: "https://testnet.binancefuture.com" },
};

export class BinanceError extends Error {}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A signed request. Binance's own sentence comes back in the error; never the key. */
export async function signed(
  keys: BinanceKeys,
  baseUrl: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(Date.now()),
    recvWindow: "10000",
  });
  query.set("signature", await hmacHex(keys.secret, query.toString()));
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}?${query}`, { method, headers: { "X-MBX-APIKEY": keys.apiKey }, signal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    throw new BinanceError(`Binance did not answer: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new BinanceError(`Binance refused (${response.status}): ${String(body.msg ?? JSON.stringify(body)).slice(0, 200)}`);
  return body;
}

export type ConnectionReport = {
  ok: boolean;
  network: BinanceNetwork;
  /** Free USDT on spot and in futures, read from the account. Null when that side was not read. */
  spotUsdt: number | null;
  futuresUsdt: number | null;
  canTradeSpot: boolean | null;
  canTradeFutures: boolean | null;
  canWithdraw: boolean | null;
  problem: string | null;
};

/** Reads the account and, on LIVE, the key's own permissions. A key that can withdraw is refused. */
export async function checkConnection(keys: BinanceKeys, network: BinanceNetwork, futures: boolean): Promise<ConnectionReport> {
  const base = BASES[network];
  const report: ConnectionReport = { ok: false, network, spotUsdt: null, futuresUsdt: null, canTradeSpot: null, canTradeFutures: null, canWithdraw: null, problem: null };
  try {
    const account = await signed(keys, base.spot, "GET", "/api/v3/account", { omitZeroBalances: true });
    const balances = (account.balances ?? []) as { asset: string; free: string }[];
    report.spotUsdt = Number(balances.find((row) => row.asset === "USDT")?.free ?? 0);
    report.canTradeSpot = account.canTrade === true;
  } catch (cause) {
    report.problem = cause instanceof Error ? cause.message : String(cause);
    return report;
  }
  if (network === "live") {
    try {
      const restrictions = await signed(keys, base.spot, "GET", "/sapi/v1/account/apiRestrictions");
      report.canWithdraw = restrictions.enableWithdrawals === true;
      report.canTradeSpot = restrictions.enableSpotAndMarginTrading === true;
      report.canTradeFutures = restrictions.enableFutures === true;
    } catch (cause) {
      report.problem = `Could not read this key's permissions: ${cause instanceof Error ? cause.message : String(cause)}`;
      return report;
    }
    if (report.canWithdraw) {
      report.problem = "This key can withdraw. Dolphin refuses live keys that can move money off your account: edit it on Binance and switch Withdrawals off.";
      return report;
    }
  }
  if (futures) {
    try {
      const balances = (await signed(keys, base.futures, "GET", "/fapi/v2/balance")) as unknown as { asset: string; availableBalance: string }[];
      report.futuresUsdt = Number(balances.find((row) => row.asset === "USDT")?.availableBalance ?? 0);
      if (network === "testnet") report.canTradeFutures = true;
    } catch (cause) {
      report.problem = `Futures did not answer for this key: ${cause instanceof Error ? cause.message : String(cause)}`;
      return report;
    }
  }
  if (!report.canTradeSpot) {
    report.problem = "This key cannot trade spot. Edit it on Binance and enable Spot & Margin Trading.";
    return report;
  }
  if (futures && report.canTradeFutures === false) {
    report.problem = "This key cannot trade futures. Enable Futures on the key, or switch futures off on the block.";
    return report;
  }
  report.ok = true;
  return report;
}

/* ── Orders ── */

type Filters = { step: number; minQty: number; tick: number };
const filterCache = new Map<string, Filters>();

async function filters(network: BinanceNetwork, futures: boolean, symbol: string): Promise<Filters> {
  const cacheKey = `${network}:${futures ? "f" : "s"}:${symbol}`;
  const hit = filterCache.get(cacheKey);
  if (hit) return hit;
  const base = futures ? BASES[network].futures : BASES[network].spot;
  const path = futures ? "/fapi/v1/exchangeInfo" : `/api/v3/exchangeInfo?symbol=${symbol}`;
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new BinanceError(`Binance has no ${symbol} market here (${response.status}).`);
  const info = (await response.json()) as { symbols: { symbol: string; filters: { filterType: string; stepSize?: string; minQty?: string; tickSize?: string }[] }[] };
  const row = info.symbols.find((candidate) => candidate.symbol === symbol);
  if (!row) throw new BinanceError(`Binance has no ${futures ? "futures" : "spot"} market ${symbol}${network === "testnet" ? " on the testnet" : ""}.`);
  const lot = row.filters.find((f) => f.filterType === (futures ? "MARKET_LOT_SIZE" : "LOT_SIZE")) ?? row.filters.find((f) => f.filterType === "LOT_SIZE");
  const price = row.filters.find((f) => f.filterType === "PRICE_FILTER");
  const found = { step: Number(lot?.stepSize ?? 0), minQty: Number(lot?.minQty ?? 0), tick: Number(price?.tickSize ?? 0.01) };
  if (!(found.step > 0)) throw new BinanceError(`Binance gave no lot size for ${symbol}.`);
  filterCache.set(cacheKey, found);
  return found;
}

function roundDown(value: number, step: number): string {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return (Math.floor(value / step + 1e-9) * step).toFixed(decimals);
}

/** What Dolphin holds on the venue for one rule, so an exit closes exactly what was opened. */
export type Held = { qty: string; orderId: string | null; stopOrderId: string | null };

export type Fill = { orderId: string; price: number; qty: string };

/** Opens a position for a rule's entry. Returns the fill and what is now held. */
export async function openPosition(
  keys: BinanceKeys,
  network: BinanceNetwork,
  rule: { venue: string; market: string; sizeUsd: number; leverage: number; stopLossPct: number | null },
  side: "long" | "short",
  refPrice: number,
): Promise<{ fill: Fill; held: Held }> {
  const futures = rule.venue === "binance-futures";
  const { step, minQty, tick } = await filters(network, futures, rule.market);
  if (!futures) {
    if (side !== "long") throw new BinanceError("Spot can only buy; shorting needs futures.");
    const order = await signed(keys, BASES[network].spot, "POST", "/api/v3/order", { symbol: rule.market, side: "BUY", type: "MARKET", quoteOrderQty: rule.sizeUsd });
    const fills = (order.fills ?? []) as { price: string; qty: string; commission: string; commissionAsset: string }[];
    // A fee taken in the coin bought leaves a little less to sell later.
    const fees = fills.filter((f) => rule.market.startsWith(f.commissionAsset)).reduce((sum, f) => sum + Number(f.commission), 0);
    const executed = Number(order.executedQty);
    const quote = Number(order.cummulativeQuoteQty);
    const qty = roundDown(executed - fees, step);
    return {
      fill: { orderId: String(order.orderId), price: executed > 0 ? quote / executed : refPrice, qty: String(executed) },
      held: { qty, orderId: String(order.orderId), stopOrderId: null },
    };
  }
  const base = BASES[network].futures;
  /*
   * ISOLATED MARGIN, ALWAYS (owner, 2026-10-04): on cross margin a liquidation can draw on the whole
   * futures balance; isolated, a position can lose only its own margin. "No need to change margin
   * type" means it already is. Any other refusal (e.g. an open cross position on this symbol) stops
   * the trade rather than opening it on cross.
   */
  try {
    await signed(keys, base, "POST", "/fapi/v1/marginType", { symbol: rule.market, marginType: "ISOLATED" });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/no need to change margin type|-4046/i.test(message)) throw new BinanceError(`Could not set isolated margin on ${rule.market}, so nothing was opened: ${message.slice(0, 160)}`);
  }
  await signed(keys, base, "POST", "/fapi/v1/leverage", { symbol: rule.market, leverage: rule.leverage });
  const qty = roundDown((rule.sizeUsd * rule.leverage) / refPrice, step);
  if (Number(qty) < minQty || Number(qty) <= 0) throw new BinanceError(`$${rule.sizeUsd} at ${rule.leverage}x is below Binance's smallest ${rule.market} order.`);
  const orderSide = side === "long" ? "BUY" : "SELL";
  const order = await signed(keys, base, "POST", "/fapi/v1/order", { symbol: rule.market, side: orderSide, type: "MARKET", quantity: qty, newOrderRespType: "RESULT" });
  const avg = Number(order.avgPrice) || refPrice;
  // The stop also lives ON Binance, so it protects between candle closes and if Dolphin is down.
  let stopOrderId: string | null = null;
  if (rule.stopLossPct !== null) {
    const stopPrice = avg * (side === "long" ? 1 - rule.stopLossPct / 100 : 1 + rule.stopLossPct / 100);
    try {
      const stop = await signed(keys, base, "POST", "/fapi/v1/order", {
        symbol: rule.market,
        side: orderSide === "BUY" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        stopPrice: roundDown(stopPrice, tick),
        closePosition: true,
        workingType: "MARK_PRICE",
      });
      stopOrderId = String(stop.orderId);
    } catch {
      // The position stands; the engine's own stop on each closed candle still applies.
      stopOrderId = null;
    }
  }
  return { fill: { orderId: String(order.orderId), price: avg, qty }, held: { qty, orderId: String(order.orderId), stopOrderId } };
}

/** Closes what a rule holds. */
export async function closePosition(
  keys: BinanceKeys,
  network: BinanceNetwork,
  rule: { venue: string; market: string },
  side: "long" | "short",
  held: Held,
  refPrice: number,
): Promise<Fill> {
  if (rule.venue !== "binance-futures") {
    const order = await signed(keys, BASES[network].spot, "POST", "/api/v3/order", { symbol: rule.market, side: "SELL", type: "MARKET", quantity: held.qty });
    const executed = Number(order.executedQty);
    const quote = Number(order.cummulativeQuoteQty);
    return { orderId: String(order.orderId), price: executed > 0 ? quote / executed : refPrice, qty: String(executed) };
  }
  const base = BASES[network].futures;
  if (held.stopOrderId) await signed(keys, base, "DELETE", "/fapi/v1/order", { symbol: rule.market, orderId: held.stopOrderId }).catch(() => undefined);
  const order = await signed(keys, base, "POST", "/fapi/v1/order", {
    symbol: rule.market,
    side: side === "long" ? "SELL" : "BUY",
    type: "MARKET",
    quantity: held.qty,
    reduceOnly: true,
    newOrderRespType: "RESULT",
  });
  return { orderId: String(order.orderId), price: Number(order.avgPrice) || refPrice, qty: held.qty };
}
