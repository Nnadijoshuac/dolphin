import { LIMITS, TIMEFRAMES } from "./strategy";

/**
 * WHAT DOLPHIN'S BUILD CHAT CAN TURN INTO A WORKING AGENT - for an assistant writing that chat's prompt
 * (owner, 2026-10-19: "most people using this prod will be getting their agent builder prompt from Claude,
 * so we can't mess this up"). Measured the same day: a Claude-written prompt asked for a 50%-of-capital
 * size, a capital floor that pauses and notifies, approval of every buy, a backtest against holding and a
 * BTC control - none of which the build chat can do. It made a rule anyway and quietly swapped "my
 * approval" for Jev, an AI check. A prompt that only asks for what exists gets exactly what it asked for.
 *
 * Built from the engine's own LIMITS and TIMEFRAMES so the numbers cannot drift from what cleanRule accepts.
 */
export const BUILDER_GUIDE = {
  where: "Paste the prompt into the build chat at https://www.dolphinamp.xyz/dolphin (Build). It turns the prompt into trading rules that run with no model call, judged on every closed Binance candle.",
  canDo: [
    "Trading rules. Each rule: a market, a timeframe, entry conditions, exits, a size, a daily cap. An agent can have several rules; each trades on its own.",
    "venue: dolphin-wallet (default - swaps on PancakeSwap from the person's Dolphin Wallet on BNB Chain; BNBUSDT, ETHUSDT and BTCUSDT are proven there), binance-spot, binance-futures (the only venue that shorts or uses leverage), binance-wallet (the person's Binance Agentic Wallet). Binance venues need the Binance block on the canvas.",
    `timeframe: ${TIMEFRAMES.join(", ")}.`,
    `Entry: up to ${LIMITS.maxConditions} conditions, ALL must hold on the same closed candle. Kinds: RSI above/below a level (any period, 14 by default); price above/below a moving average (SMA or EMA, any length); a moving-average cross up/down (fast, slow); a MACD cross up/down (12/26/9); a trend of N higher or lower closes in a row (N up to ${LIMITS.maxTrendCandles}); price above/below a fixed level; % change over N candles; near/above/below a Fibonacci level of the last N-candle swing.`,
    `Exits, whichever comes first: a stop-loss %, a take-profit %, and/or exit conditions (same kinds, up to ${LIMITS.maxConditions}, ALL must hold). So "sell when RSI rises above 55, or at a 3% loss" works.`,
    "One position per rule: a rule never buys again while it holds. Do not write 'only if no position is open' - it is built in.",
    `Size: a fixed dollar amount per trade ($1 to $${LIMITS.maxSizeUsd.toLocaleString("en")}).`,
    `Daily cap: 1 to ${LIMITS.maxTradesPerDay} trades a day (2 if unsaid). Cooldown: minutes to wait after a trade (0 if unsaid).`,
    `Leverage: 1x to ${LIMITS.maxLeverage}x, binance-futures only (a warning above ${LIMITS.comfortableLeverage}x).`,
    "Optional AI check: Jev (TypeSafe's decision model) approves each buy at a minimum confidence, on the person's own Jev key. Only when they want an AI to double-check entries.",
    "Every decision is logged with the indicator values behind it, and every trade links to its transaction. This needs no prompt.",
    "Every agent starts on PAPER (pretend money, live prices). It trades real money only after the person switches it to Live in the agent panel, and for the Dolphin Wallet grants a limited trade key.",
  ],
  cannotDo: [
    "Size as a % of capital ('50% per trade') -> give dollars: 50% of $20 is $10.",
    "Pause when the balance falls below $X -> a stop-loss on each rule, plus a daily loss limit the person sets themselves in the Draft tab.",
    "Ask the person to approve each buy -> rules trade by themselves once Live. Leave it on Paper until they trust it, or ask for the Jev check (an AI, not the person).",
    "Notify, email or message anyone -> it cannot. The agent's page shows every decision.",
    "Backtest, compare with holding, or run a control coin inside the chat -> run backtest_rule (this MCP) on each rule BEFORE writing the prompt, and show the person the results.",
    "'Do not trade until I confirm' -> unnecessary: it stays on Paper until the person switches it to Live.",
    "OR between entry conditions -> write each alternative as its own rule.",
    "Bollinger bands or volume in a rule -> not in the rule language; use the condition kinds above.",
    "Stablecoins or tokens Binance does not list -> a market must be a Binance pair.",
    "Profit guarantees -> never promise one.",
  ],
  howToWrite: [
    "Check and backtest each rule here first (check_rule, then backtest_rule), so the prompt carries numbers that tested well.",
    "Keep it short: the agent's name, then one sentence per rule with every number in it - market, timeframe, entry, exits, dollars per trade, trades per day, venue.",
    "Leave out everything in cannotDo, and every goal or explanation the rules cannot act on: the build chat reads numbers, not intentions.",
  ],
  example:
    "Make a trading agent called BNB Dip Guard with one rule on the Dolphin Wallet: on BNBUSDT 4-hour candles, buy $10 when RSI(14) is below 30 and the price is above the 200 SMA. Sell when RSI(14) rises above 55, or at a 3% loss. At most 1 trade a day.",
} as const;

export const BUILDER_GUIDE_TOOL = {
  name: "builder_guide",
  title: "What Dolphin's agent builder can build",
  description:
    "Read this BEFORE writing a prompt for Dolphin's build chat (dolphinamp.xyz/dolphin). Returns exactly what the builder can turn into a working trading agent, what it cannot (each with the closest thing it can do), how to word the prompt, and an example. A prompt that asks only for what exists gets exactly that.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
} as const;
