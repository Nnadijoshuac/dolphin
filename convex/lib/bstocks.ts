import type { Address } from "viem";

/**
 * bSTOCKS - BINANCE'S TOKENIZED US STOCKS ON BNB CHAIN (owner, 2026-10-26: "an agent that can trade
 * bStock for you").
 *
 * HOW EACH ADDRESS WAS VERIFIED (AGENTS.md SS9), 2026-10-26:
 *   1. Trust Wallet's own bStocks article lists the five contracts (trustwallet.com/blog/company/
 *      access-bstocks-on-trust-wallet-tokenized-shares-on-chain, full addresses in its BscScan links).
 *   2. Each contract was read on BNB Chain the same day: name(), symbol(), decimals() all match -
 *      "Tesla, Inc." TSLAB, "NVIDIA Corp" NVDAB, "Circle Internet Group Inc." CRCLB, "Micron Technology Inc"
 *      MUB, "Sandisk Corporation" SNDKB, every one 18 decimals with a live supply.
 *   3. Binance lists each as a spot pair against USDT (TSLABUSDT, NVDABUSDT, CRCLBUSDT, MUBUSDT, SNDKBUSDT),
 *      which is what a rule's candles are read from.
 * Confidence: high. A new bStock goes in only after the same three checks.
 *
 * Who may hold them is Binance's call, not Dolphin's: bStocks are not offered to people in the United
 * States, the United Kingdom or the European Union. They trade around the clock while the real shares do
 * not, so a price outside US market hours can move with no trade on the exchange behind it.
 */
export const BSTOCKS: ReadonlyArray<{ symbol: string; address: Address; company: string; aliases: readonly string[] }> = [
  { symbol: "TSLAB", address: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", company: "Tesla", aliases: ["tslab", "tsla", "tesla"] },
  { symbol: "NVDAB", address: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", company: "Nvidia", aliases: ["nvdab", "nvda", "nvidia"] },
  { symbol: "CRCLB", address: "0x80f3D493EBCe97e343c53D29a137942416B4ffC0", company: "Circle", aliases: ["crclb", "crcl", "circle"] },
  { symbol: "MUB", address: "0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699", company: "Micron", aliases: ["mub", "micron"] },
  { symbol: "SNDKB", address: "0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb", company: "Sandisk", aliases: ["sndkb", "sndk", "sandisk"] },
];

export const BSTOCK_SYMBOLS: ReadonlySet<string> = new Set(BSTOCKS.map((stock) => stock.symbol));

/** The bStock a Binance market trades ("TSLABUSDT" -> TSLAB), or null. */
export function bstockOfMarket(market: string): (typeof BSTOCKS)[number] | null {
  const base = market.toUpperCase().replace(/(USDT|USDC|FDUSD|USD1)$/, "");
  return BSTOCKS.find((stock) => stock.symbol === base) ?? null;
}

/** Said once wherever a bStock rule is made: who may hold them, and the 24/7 caveat. */
export const BSTOCK_WARNING =
  "bStocks are tokenized US shares from Binance. They are not offered to people in the US, UK or EU, and they trade around the clock while the real shares do not, so a price outside US market hours can move without the stock itself trading.";
