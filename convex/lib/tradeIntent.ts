/**
 * "buy 50 U of CAKE" -> a swap Dolphin can put on a ticket. (2026-09-26)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS CODE AND NOT THE MODEL
 * ---------------------------------------------------------------------------
 * The owner typed "buy 50 U of CAKE" into the chat and got the catalog
 * fallback: the free model did not answer, and nothing else knew what a trade
 * was. A trade is the one request where a model that takes ten seconds and
 * fails one time in three is the wrong tool - and where a model that guesses
 * an amount or a token is dangerous. The phrasings people use for a swap are
 * few, so they are matched here, deterministically, and anything that does
 * not match falls through to the ordinary chat.
 *
 * Only EXACT-INPUT swaps: the person says how much they spend. "buy 100 CAKE"
 * (an exact output) is answered with a question rather than a guess at what
 * to pay with.
 *
 * Tokens come back exactly as typed. Resolving a symbol to an address is
 * lib/tradeTokens.ts's job, against a verified list only - see the note there
 * on why a symbol is never looked up in a public token list.
 */

export type TradeIntent =
  | {
      kind: "swap";
      /** Human units, as typed ("50", "0.25"). Never converted here. */
      amount: string;
      tokenIn: string;
      tokenOut: string;
    }
  | {
      /** Clearly a trade, but missing something only the person can supply. */
      kind: "incomplete";
      question: string;
      /**
       * The token the request named, when it named one. The caller answers an
       * incomplete intent only when this is a token it knows: "get started"
       * matches the same shape as "buy CAKE" and must reach the chat instead.
       */
      token: string | null;
    };

const TOKEN = String.raw`(0x[0-9a-fA-F]{40}|\$?[a-zA-Z][a-zA-Z0-9]{0,11})`;
const AMOUNT = String.raw`(\d+(?:[.,]\d+)?|\.\d+)`;

/** Words that sit in front of a request without changing it. */
const PREFIX = /^(?:please\s+|pls\s+|can you\s+|could you\s+|i want to\s+|i'd like to\s+|i would like to\s+|let me\s+|help me\s+)+/i;

const PATTERNS: Array<{ re: RegExp; map: (m: RegExpMatchArray) => TradeIntent }> = [
  // buy 50 U of CAKE / buy 50 U worth of CAKE / get 0.1 BNB of CAKE
  {
    re: new RegExp(String.raw`^(?:buy|get|ape)\s+${AMOUNT}\s*${TOKEN}\s+(?:worth\s+of|of|in|into)\s+${TOKEN}$`, "i"),
    map: (m) => ({ kind: "swap", amount: m[1], tokenIn: m[2], tokenOut: m[3] }),
  },
  // buy CAKE with 50 U / buy CAKE using 0.1 BNB / buy CAKE for 50 U
  {
    re: new RegExp(String.raw`^(?:buy|get|ape)\s+${TOKEN}\s+(?:with|using|for)\s+${AMOUNT}\s*${TOKEN}$`, "i"),
    map: (m) => ({ kind: "swap", amount: m[2], tokenIn: m[3], tokenOut: m[1] }),
  },
  // sell 100 CAKE for U / sell 100 CAKE to BNB
  {
    re: new RegExp(String.raw`^(?:sell|dump)\s+${AMOUNT}\s*${TOKEN}\s+(?:for|to|into)\s+${TOKEN}$`, "i"),
    map: (m) => ({ kind: "swap", amount: m[1], tokenIn: m[2], tokenOut: m[3] }),
  },
  // swap 50 U to CAKE / convert 0.1 BNB into U / trade 5 CAKE -> BNB
  {
    re: new RegExp(
      String.raw`^(?:swap|convert|trade|exchange|change)\s+${AMOUNT}\s*${TOKEN}\s+(?:to|for|into|->|→|=>)\s+${TOKEN}$`,
      "i",
    ),
    map: (m) => ({ kind: "swap", amount: m[1], tokenIn: m[2], tokenOut: m[3] }),
  },
  // sell 100 CAKE  (no destination)
  {
    re: new RegExp(String.raw`^(?:sell|dump)\s+${AMOUNT}\s*${TOKEN}$`, "i"),
    map: (m) => ({
      kind: "incomplete",
      token: bare(m[2]),
      question: `What do you want for your ${bare(m[2])}? For example: "sell ${m[1]} ${bare(m[2])} for U" or "sell ${m[1]} ${bare(m[2])} for BNB".`,
    }),
  },
  // buy 100 CAKE / buy CAKE  (nothing said about what to pay with)
  {
    re: new RegExp(String.raw`^(?:buy|get|ape)\s+(?:${AMOUNT}\s*)?${TOKEN}$`, "i"),
    map: (m) => ({
      kind: "incomplete",
      token: bare(m[2]),
      question: `How much do you want to spend on ${bare(m[2])}, and in what? For example: "buy 50 U of ${bare(m[2])}" or "buy 0.1 BNB of ${bare(m[2])}".`,
    }),
  },
];

function bare(token: string): string {
  return token.replace(/^\$/, "");
}

/** Words that look like a token in these patterns but are English. */
const NOT_TOKENS = new Set([
  "a", "an", "the", "some", "it", "this", "that", "them", "me", "my", "more", "now",
  "agent", "agents", "one", "token", "tokens", "coin", "coins", "crypto",
]);

/**
 * The trade in `text`, or null when this is not a trade request and the
 * ordinary chat should answer it.
 */
export function parseTradeIntent(text: string): TradeIntent | null {
  const cleaned = text
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(PREFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 160) return null;

  for (const { re, map } of PATTERNS) {
    const match = cleaned.match(re);
    if (!match) continue;
    const intent = map(match);
    if (intent.kind === "swap") {
      const tokenIn = bare(intent.tokenIn);
      const tokenOut = bare(intent.tokenOut);
      if (NOT_TOKENS.has(tokenIn.toLowerCase()) || NOT_TOKENS.has(tokenOut.toLowerCase())) return null;
      const amount = intent.amount.replace(",", ".");
      if (!(Number(amount) > 0)) {
        return { kind: "incomplete", token: null, question: "How much do you want to trade? The amount has to be more than zero." };
      }
      if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
        return { kind: "incomplete", token: null, question: `You named ${tokenIn} on both sides. Which token do you want to end up with?` };
      }
      return { kind: "swap", amount, tokenIn, tokenOut };
    }
    /* "buy the agent", "get some" and the like are English, not trades. */
    const named = match.slice(1).filter(Boolean).pop() ?? "";
    if (NOT_TOKENS.has(bare(named).toLowerCase())) return null;
    return intent;
  }
  return null;
}
