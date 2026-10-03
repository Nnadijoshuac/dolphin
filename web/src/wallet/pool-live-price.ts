import { getAddress, parseAbi, type Address, type PublicClient } from "viem";

import { AGGREGATOR_V3_ABI } from "@/wallet/bnb-price";
import { FEE_TIERS, PANCAKE_V3_FACTORY, rateFromPool, USDT_BSC, USDT_USD_FEED, WBNB_BSC } from "@/wallet/token-usd";

/**
 * A TOKEN'S PRICE, READ FROM ITS POOL ON BNB CHAIN EVERY FEW SECONDS - for the live candle on the
 * canvas chart (components/trading-chart.tsx; owner, 2026-10-03: "the market is almost never
 * still").
 *
 * Measured 2026-10-03 from a network that blocks Binance: the WBNB/USDT pool's price, read once a
 * second from BNB Chain's public node, changed 18 times in 20 reads at ~220 ms a read. Public price
 * APIs refresh far slower (DexScreener ~30 s, GeckoTerminal ~60 s). This is also the very price the
 * Dolphin Wallet swaps at. It runs in the browser: no Convex call.
 *
 * DOLLARS ARE READ, NEVER ASSUMED (wallet/token-usd.ts):
 *   - the pool quotes USDT: token -> USDT (pool) x USDT -> USD (Chainlink feed);
 *   - the pool quotes WBNB: token -> WBNB (pool) x WBNB -> USDT (the deepest V3 pool, found through
 *     the verified PancakeSwap factory, never a pasted address) x USDT -> USD (feed);
 *   - anything else: no live price. The chart keeps its history without a live candle rather than
 *     guess what the quote token is worth.
 * Every address used is verified in wallet/token-usd.ts; none is new here.
 *
 * A pool's spot price is one block's price and can be pushed by a large trade. That is fine for a
 * chart a person reads; nothing here decides what is paid.
 */

const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint32, bool)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function liquidity() view returns (uint128)",
]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)"]);
const FACTORY_ABI = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);

type Leg = { pool: Address; kind: "v2" | "v3"; tokenIsToken0: boolean; tokenDecimals: number; otherDecimals: number };

export type LivePricer = { read: () => Promise<number | null> };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** How a pool is read and which way up it is, or null when it is neither a V2 nor a V3 pool. */
async function describe(client: PublicClient, pool: Address, token: Address): Promise<(Leg & { other: Address }) | null> {
  const [token0, token1] = await Promise.all([
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "token0" }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "token1" }),
  ]);
  if (!same(token0, token) && !same(token1, token)) return null;
  const tokenIsToken0 = same(token0, token);
  const other = tokenIsToken0 ? token1 : token0;
  let kind: "v2" | "v3" = "v3";
  try {
    await client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" });
  } catch {
    try {
      await client.readContract({ address: pool, abi: POOL_ABI, functionName: "getReserves" });
      kind = "v2";
    } catch {
      return null;
    }
  }
  const [tokenDecimals, otherDecimals] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address: other, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { pool, kind, tokenIsToken0, tokenDecimals, otherDecimals, other: getAddress(other) };
}

/** WBNB's deepest V3 pool against USDT, through the factory: the tier with the most liquidity. */
async function wbnbUsdtLeg(client: PublicClient): Promise<Leg | null> {
  let best: { pool: Address; liquidity: bigint } | null = null;
  for (const fee of FEE_TIERS) {
    const pool = await client.readContract({ address: PANCAKE_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [WBNB_BSC, USDT_BSC, fee] });
    if (/^0x0+$/.test(pool)) continue;
    const liquidity = await client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity" });
    if (liquidity > BigInt(0) && (!best || liquidity > best.liquidity)) best = { pool, liquidity };
  }
  if (!best) return null;
  const described = await describe(client, best.pool, WBNB_BSC);
  return described && described.kind === "v3" ? described : null;
}

/** One whole token's price in the other token, from one read of the pool. */
function priceFrom(leg: Leg, result: unknown): number | null {
  if (leg.kind === "v3") {
    const [sqrtPriceX96] = result as readonly [bigint, ...unknown[]];
    if (sqrtPriceX96 === BigInt(0)) return null;
    const rate = rateFromPool({ sqrtPriceX96, tokenIsToken0: leg.tokenIsToken0, tokenDecimals: leg.tokenDecimals, stableDecimals: leg.otherDecimals });
    return Number(rate.num) / Number(rate.den);
  }
  const [reserve0, reserve1] = result as readonly [bigint, bigint, number];
  const token = Number(leg.tokenIsToken0 ? reserve0 : reserve1) / 10 ** leg.tokenDecimals;
  const other = Number(leg.tokenIsToken0 ? reserve1 : reserve0) / 10 ** leg.otherDecimals;
  return token > 0 ? other / token : null;
}

const readCall = (leg: Leg) =>
  leg.kind === "v3"
    ? ({ address: leg.pool, abi: POOL_ABI, functionName: "slot0" } as const)
    : ({ address: leg.pool, abi: POOL_ABI, functionName: "getReserves" } as const);

/**
 * A reader for one token's live USD price through one pool, or null when that pool cannot be priced
 * in dollars from verified sources. Each `read` is one batched request to BNB Chain.
 */
export async function livePricer(client: PublicClient, pool: Address, token: Address): Promise<LivePricer | null> {
  const leg = await describe(client, getAddress(pool), getAddress(token)).catch(() => null);
  if (!leg) return null;
  const viaWbnb = same(leg.other, WBNB_BSC);
  if (!viaWbnb && !same(leg.other, USDT_BSC)) return null;
  const bridge = viaWbnb ? await wbnbUsdtLeg(client).catch(() => null) : null;
  if (viaWbnb && !bridge) return null;

  // USDT -> USD moves slowly (Chainlink's heartbeat); read it at most once a minute.
  let usdt: { usd: number; at: number } | null = null;
  return {
    read: async () => {
      const readUsdt = !usdt || Date.now() - usdt.at > 60_000;
      const calls = [readCall(leg), ...(bridge ? [readCall(bridge)] : []), ...(readUsdt ? [{ address: USDT_USD_FEED, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" } as const] : [])];
      const results = await client.multicall({ contracts: calls, allowFailure: true });
      if (readUsdt) {
        const round = results[results.length - 1];
        if (round.status === "success") {
          const [, answer] = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
          // The USDT/USD feed has 8 decimals (verified in wallet/token-usd.ts).
          if (answer > BigInt(0)) usdt = { usd: Number(answer) / 1e8, at: Date.now() };
        }
      }
      if (!usdt || results[0].status !== "success") return null;
      const inOther = priceFrom(leg, results[0].result);
      if (inOther === null) return null;
      if (!bridge) return inOther * usdt.usd;
      if (results[1].status !== "success") return null;
      const wbnbInUsdt = priceFrom(bridge, results[1].result);
      return wbnbInUsdt === null ? null : inOther * wbnbInUsdt * usdt.usd;
    },
  };
}
