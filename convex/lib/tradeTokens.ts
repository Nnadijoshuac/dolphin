import { getAddress, isAddress, parseAbi, type Address } from "viem";

import { bscPublicClient } from "./bscClient";

/**
 * WHICH TOKEN A TRADER MEANT. (2026-09-26)
 *
 * ---------------------------------------------------------------------------
 * A SYMBOL IS RESOLVED ONLY AGAINST THIS LIST - NEVER A PUBLIC TOKEN LIST
 * ---------------------------------------------------------------------------
 * PancakeSwap's own "Extended" list (fetched 2026-09-21 timestamp) carries TWO
 * tokens with the symbol "U": 0xcE24…6666 (United Stables, the ERC-8183
 * payment token this repo already verified) and 0xba5e…a5ed. Resolving "U" by
 * symbol from any public list would buy whichever came first. Anyone can
 * deploy a token called anything, so the only safe symbol lookup is a short
 * list where every entry was checked by hand. Any other token is traded by
 * pasting its address, and the ticket says it is not on this list.
 *
 * ---------------------------------------------------------------------------
 * HOW EACH ADDRESS WAS VERIFIED (AGENTS.md §9), 2026-09-26, block 124,212,449
 * ---------------------------------------------------------------------------
 * Source 1: PancakeSwap's official token list,
 *   https://tokens.pancakeswap.finance/pancakeswap-extended.json
 * Source 2: the contract itself on BSC mainnet: symbol(), decimals() and
 *   name() read through bsc-dataseed.bnbchain.org, matching the list.
 * WBNB, U and USDT were already verified in this repo (web/src/wallet/
 * pancakeswap-bnb-swap.ts, SESSION-LOG-2026-08-31-payments.md §0.6,
 * web/src/wallet/token-usd.ts) and re-read here.
 * Confidence: high for all nine. The name the chain returned is in each row.
 */
export type TradeToken = {
  /** Null for native BNB, which is not a contract. */
  address: Address | null;
  symbol: string;
  decimals: number;
  /** On the hand-verified list above. False for a pasted address. */
  verified: boolean;
};

export const WBNB: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const VERIFIED: ReadonlyArray<TradeToken & { aliases: readonly string[] }> = [
  { address: null, symbol: "BNB", decimals: 18, verified: true, aliases: ["bnb", "binance", "bnbcoin"] },
  /* "Wrapped BNB" */
  { address: WBNB, symbol: "WBNB", decimals: 18, verified: true, aliases: ["wbnb"] },
  /* "United Stables" - NOT 0xba5e…a5ed, see the header. */
  { address: "0xcE24439F2D9C6a2289F741120FE202248B666666", symbol: "U", decimals: 18, verified: true, aliases: ["u", "unitedstables"] },
  /* "Tether USD" (BSC-USD) */
  { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18, verified: true, aliases: ["usdt", "tether"] },
  /* "USD Coin" */
  { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18, verified: true, aliases: ["usdc", "usdcoin"] },
  /* "PancakeSwap Token" - symbol() returns "Cake" */
  { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "CAKE", decimals: 18, verified: true, aliases: ["cake", "pancake", "pancakeswap"] },
  /* "BTCB Token" */
  { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB", decimals: 18, verified: true, aliases: ["btcb", "btc", "bitcoin"] },
  /* "Ethereum Token" */
  { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH", decimals: 18, verified: true, aliases: ["eth", "ethereum", "ether"] },
  /* "Venus" */
  { address: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", symbol: "XVS", decimals: 18, verified: true, aliases: ["xvs", "venus"] },
  /* "First Digital USD" */
  { address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", symbol: "FDUSD", decimals: 18, verified: true, aliases: ["fdusd"] },
];

/** The verified symbols, for telling a person what they can type. */
export const VERIFIED_SYMBOLS = VERIFIED.map((token) => token.symbol);

/** Every verified token, for reading a wallet's holdings. */
export function verifiedTokens(): TradeToken[] {
  return VERIFIED.map(({ aliases: _aliases, ...token }) => token);
}

/** A symbol on the verified list, or null. Never guesses. */
export function verifiedTokenBySymbol(symbol: string): TradeToken | null {
  const key = symbol.trim().replace(/^\$/, "").toLowerCase();
  const found = VERIFIED.find((token) => token.aliases.includes(key));
  if (!found) return null;
  const { aliases: _aliases, ...token } = found;
  return token;
}

const ERC20_META = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export type ResolvedToken =
  | { ok: true; token: TradeToken }
  | {
      ok: false;
      reason: string;
      /** A verified symbol one typo away, for the person to CONFIRM. Never traded on unconfirmed. */
      suggestion: string | null;
    };

/**
 * What the person typed, as a token Dolphin can trade.
 *
 * An address is read from the chain: a contract with no `decimals()` is not a
 * token Dolphin can price, and it says so rather than assuming 18.
 */
export async function resolveTradeToken(typed: string): Promise<ResolvedToken> {
  const value = typed.trim();

  if (isAddress(value)) {
    const address = getAddress(value);
    const listed = VERIFIED.find((token) => token.address === address);
    if (listed) {
      const { aliases: _aliases, ...token } = listed;
      return { ok: true, token };
    }
    try {
      const [symbol, decimals] = await Promise.all([
        bscPublicClient.readContract({ address, abi: ERC20_META, functionName: "symbol" }),
        bscPublicClient.readContract({ address, abi: ERC20_META, functionName: "decimals" }),
      ]);
      return {
        ok: true,
        token: { address, symbol: symbol.slice(0, 24) || "?", decimals: Number(decimals), verified: false },
      };
    } catch {
      return {
        ok: false,
        reason: `${address} did not answer as a token on BNB Chain (no symbol or decimals), so Dolphin can't price it. Check the address.`,
        suggestion: null,
      };
    }
  }

  const token = verifiedTokenBySymbol(value);
  if (token) return { ok: true, token };

  const word = value.replace(/^\$/, "");
  const close = closestVerified(word);
  return {
    ok: false,
    suggestion: close,
    reason: close
      ? `Did you mean ${close}?`
      : `I don't know a token called "${word}". I trade ${VERIFIED_SYMBOLS.join(", ")} by name, ` +
        `or any other token if you paste its contract address (0x…).`,
  };
}

/**
 * A verified symbol one typo away ("bnn", "usdtt", "cak"), to SUGGEST. Never
 * traded on: a near-miss is exactly how someone ends up buying the wrong
 * token, so the person confirms it with one tap (convex/trade.ts).
 */
function closestVerified(typed: string): string | null {
  const word = typed.toLowerCase();
  if (word.length < 3) return null;
  for (const token of VERIFIED) {
    for (const alias of token.aliases) {
      if (alias.length >= 3 && editDistanceAtMostOne(word, alias)) return token.symbol;
    }
  }
  return null;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
