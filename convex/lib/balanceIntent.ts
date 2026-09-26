/**
 * "How much BNB do I have?" -> a balance Dolphin reads from the chain.
 * (2026-09-26)
 *
 * The owner asked "How much bnb dom i have?" on a day the free model's calls
 * were spent, and got "out of answers". A balance is a number the chain
 * already holds; it needs no model, so it is recognised here, in code, like a
 * trade (lib/tradeIntent.ts), and answered even when the model is out.
 *
 * Narrow on purpose. A question about a position ("how much do I have in
 * Venus") or a cost ("how much BNB do I need") is not a wallet balance, and
 * falls through to the chat.
 */

import { verifiedTokenBySymbol } from "./tradeTokens";

export type BalanceIntent = {
  /** The token asked about, as typed; null means "everything I hold". */
  token: string | null;
};

/** Words that sit where a token would, but mean "everything". */
const EVERYTHING = new Set([
  "do", "did", "does", "money", "crypto", "tokens", "token", "coins", "coin",
  "funds", "assets", "i", "is", "in", "of", "on", "stuff", "wallet", "total", "account",
]);

/** Positions, costs and plans: questions about something other than the wallet's balance. */
const NOT_A_BALANCE = /\b(venus|aave|lend|lending|borrow|pool|position|staked|stake|farm|vault|need|cost|costs|earn|fee|fees|price|worth of|hire)\b/;

export function parseBalanceIntent(text: string): BalanceIntent | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 80) return null;
  if (NOT_A_BALANCE.test(cleaned)) return null;

  const token = (word: string | undefined): string | null => {
    if (!word) return null;
    const bare = word.replace(/^\$/, "");
    return EVERYTHING.has(bare) ? null : bare;
  };

  // how much BNB do i have / how many CAKE do I hold / how much do i have
  const howMuch = cleaned.match(/^how (?:much|many) (\$?[a-z0-9]{1,12})\b.*\b(?:have|hold|got|own|left)\b/);
  if (howMuch) return { token: token(howMuch[1]) };

  // my balance / bnb balance / my bnb balance / balances / what's my balance / check my balance
  const balance = cleaned.match(
    /^(?:(?:what(?:'?s| is)|show(?: me)?|check|see|tell me)\s+)?(?:my\s+)?(?:(\$?[a-z0-9]{1,12})\s+)?(?:balance|balances|holdings)$/,
  );
  if (balance) return { token: token(balance[1] === "my" ? undefined : balance[1]) };

  /*
   * THE GENERAL CASE. (2026-09-26) The owner's next question was "how much is
   * in the wallet", which none of the shapes above matched. Chasing phrasings
   * one at a time loses, so this reads the idea instead: a QUANTITY question
   * ("how much", "balance", "what's in", "what do I have") about the WALLET or
   * what the person holds. The token, if any, is any verified name in the
   * sentence. "what can I do with my wallet" asks no quantity and falls
   * through; "what agents do I have" is about agents and falls through.
   */
  const asksQuantity =
    /\b(?:how much|how many|balance|balances|holdings|what(?:'?s| is) in|what do i (?:have|hold|own)|show my wallet|check my wallet)\b/.test(cleaned);
  const aboutHoldings = /\b(?:wallet|wallets|balance|balances|holdings|i have|i hold|i own|i got|have i got|do i have|left)\b/.test(cleaned);
  if (asksQuantity && aboutHoldings && !/\b(?:agents?|hired?|hires)\b/.test(cleaned)) {
    return { token: tokenNamedIn(text) };
  }

  return null;
}

/**
 * The first verified token named anywhere in the text, or null for "all".
 * "u" only counts written as a capital U or $U: as a lowercase word it is far
 * more often "you" ("can u show my balance").
 */
function tokenNamedIn(text: string): string | null {
  for (const raw of text.split(/[^A-Za-z0-9$]+/)) {
    if (!raw) continue;
    const word = raw.replace(/^\$/, "");
    if (word.toLowerCase() === "u" && !(raw === "U" || raw.toLowerCase() === "$u")) continue;
    if (verifiedTokenBySymbol(word)) return word.toLowerCase();
  }
  return null;
}
