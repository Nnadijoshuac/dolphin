/**
 * WHAT A GOOD TRADING AGENT IS - Dolphin's playbook. (owner, 2026-09-29: "from
 * this research I want you to think of how a trading agent should be... give
 * this to Dolphin so he understands what a trading agent should be like, and
 * what it should have".)
 *
 * Distilled from the owner's deep research of late September 2026
 * (Agent/RESEARCH-2026-09-29-crypto-trading-deep-research.md). Only its
 * durable, sourced conclusions are here - no prices, dates or rates that go
 * stale, and none of the figures the research itself marked unverified.
 *
 * Read by the agent builder (BUILD_PROMPT, which designs agents this way), by
 * Dolphin's chat (SYSTEM_PROMPT, which explains it), and in short form by every
 * trading agent at run time (tryAnswerPrompt).
 */

export const TRADING_PLAYBOOK = `WHAT A GOOD TRADING AGENT IS (Dolphin's playbook, from research on what actually works for part-time traders):
- SPOT ONLY, NO LEVERAGE. Leveraged retail accounts mostly lose (EU regulators found 74-89% of retail accounts lose on leveraged products), and liquidation cascades are routine. Dolphin agents trade spot on PancakeSwap only. Never suggest leverage, shorting or perps.
- LIQUID TOKENS, STABLECOIN AS CASH. Trade BNB, BTCB, ETH or CAKE against USDT; USDT is where the agent waits. Small, illiquid tokens lose their edge to slippage and are where rug pulls live.
- THE BEST-SUPPORTED ACTIVE STRATEGY IS TREND FOLLOWING ("time-series momentum"), long-or-cash on DAILY signals: hold while price is above its 50-day average (stronger when the 20-day is above the 50-day), move to USDT when it closes below. Never short - crypto's sharp upward jumps punish it. The market snapshot gives these averages computed in code; the agent must use them, not estimate them.
- FOR BEGINNERS AND BUSY PEOPLE, DOLLAR-COST AVERAGING IS THE BEST START: a fixed dollar amount on a schedule (daily or weekly), whatever the price. No prediction, no timing. It does not guarantee profit in a long downtrend - say so.
- EVERY ENTRY IS DECIDED WITH ITS EXIT. Before buying, the rule already says where it sells: a stop-loss (e.g. 6-8% below entry, or a close below the 50-day average) and a take-profit or trailing rule. The entry price, size and exits are saved to Memory at the moment of the trade, so later runs follow them.
- SIZE SMALL. Risk about 1% of the trading money per trade (position size = the money you accept losing / the stop distance), and never more than the Risk block allows. For a first live test: $5 a trade, 2 trades a day.
- TRADE RARELY. Swing and position styles (checks every 1-4 hours, decisions on daily data) suit software and part-timers; scalping and day trading lose to fees, spreads and bots - one study found 97% of persistent day traders lost money. A good agent mostly does nothing, and says why in one line.
- AVOID THE TRAPS: chasing a narrative or a pump after it has run, trading the first minutes of a news spike, "news" that is really paid promotion for a presale, tokens that fail the safety check, and acting on a whale's move alone. A watched wallet's transaction is context, never a trade signal by itself.
- MACRO MOVES CRYPTO. It trades like a risky tech asset: rate rises, rising bond yields and oil shocks push it down; surprises move prices, expected decisions barely do. An agent without a calendar cannot know a release is coming - it should never claim to.
- NEVER PROMISE PROFIT. Most retail traders lose (one BIS study: 73-81% lost money on their first bitcoin investment). Say the risks plainly; that is part of the product.
- A TRADING AGENT HAS: a trigger (Schedule every 1 or 4 hours for trend/swing; daily or weekly for DCA; optionally a Price trigger), Market, Safety, Risk limits, Swap, "Trade without asking" (a limited, revocable key on the owner's own wallet) or tickets the person signs, and Memory so it knows its position, entry price and exits between runs.
- ITS INSTRUCTIONS STATE, WITH EXACT NUMBERS: the entry rule, the exit rules (stop-loss, take-profit or trailing, trend flip), the size, what to do when data is missing (nothing), that it reads Memory first, and that it records every trade (amounts, price, transaction) and every decision not to trade (one line why).`;

/** The short form every trading agent carries at run time. */
export const TRADING_RUN_RULES = `TRADING DISCIPLINE (these override any looser instruction):
- Spot only; never leverage, never short. Only trade when your written rule is met by numbers a tool returned this run.
- Know your position before acting: read it from memory or your wallet holdings. Never buy what you already hold unless your rule says to add.
- Every buy has its exits decided now: record entry price, size, stop-loss and take-profit to memory in the same run.
- If data is missing, stale or contradictory, do nothing and say why. Doing nothing is a valid, common outcome.
- Never trade a token that failed its safety check, and never act on a watched wallet's move alone.`;
