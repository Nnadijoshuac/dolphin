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

export type BalanceIntent = {
  /** The token asked about, as typed; null means "everything I hold". */
  token: string | null;
};

/** Words that sit where a token would, but mean "everything". */
const EVERYTHING = new Set([
  "do", "did", "does", "money", "crypto", "tokens", "token", "coins", "coin",
  "funds", "assets", "i", "is", "in", "of", "on", "stuff",
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

  // what's in my wallet / what do i have / what do i hold
  if (/^(?:what(?:'?s| is) in my wallet|what do i (?:have|hold|own))$/.test(cleaned)) return { token: null };

  return null;
}
