import type { Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { McpError, callMcpTool, openMcpSession } from "./lib/mcpClient";
import { parseTradeIntent } from "./lib/tradeIntent";
import { resolveTradeToken, verifiedTokenBySymbol, type TradeToken } from "./lib/tradeTokens";
import type { tradeTokenValidator } from "./schema";

/**
 * TRADE TICKETS IN THE CHAT. (2026-09-26)
 *
 * "buy 50 U of CAKE" is answered with a ticket, not prose: the two tokens, the
 * amount, and what an independent safety agent says about the token being
 * traded. The browser quotes PancakeSwap live on the ticket and signs from the
 * Dolphin Wallet (web/src/wallet/pancakeswap-trade.ts). No model is involved -
 * see lib/tradeIntent.ts for why.
 *
 * WHICH AGENT CHECKS, AND WHY ONLY ONE. BNB Chain Token Safety (`analyse`)
 * answered for CAKE in 1.6 s on 2026-09-26, free. SwapGod, the other quote
 * agent, answered the same day with HTTP-402-style x402 terms (0.01 U per
 * call), which Dolphin has no rail to pay, so the ticket's price is Dolphin's
 * own read of PancakeSwap's quoter rather than a second opinion.
 */

/** BNB Chain Token Safety, by identity. Its endpoint is read from its catalog row every time. */
const TOKEN_SAFETY_AGENT_KEY = "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338481";

type TicketToken = Infer<typeof tradeTokenValidator>;

type Safety = {
  agentKey: string;
  agentName: string;
  token: string;
  symbol: string;
  verdict: string | null;
  headline: string | null;
  reason: string | null;
  unavailable: string | null;
  checkedAt: number;
};

export const safetyAgent = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("agents")
      .withIndex("by_key", (q) => q.eq("agentKey", TOKEN_SAFETY_AGENT_KEY))
      .unique();
    return row ? { name: row.name, endpoint: row.endpoint, live: row.status === "live" && row.protocol === "mcp" } : null;
  },
});

function toTicketToken(token: TradeToken): TicketToken {
  return { address: token.address, symbol: token.symbol, decimals: token.decimals, verified: token.verified };
}

/**
 * Which side the safety agent reads. An unlisted token is the risk, whichever
 * side it is on; with both listed, the token being bought. Native BNB is not a
 * contract and has nothing to read.
 */
function tokenToCheck(tokenIn: TicketToken, tokenOut: TicketToken): TicketToken | null {
  const contracts = [tokenOut, tokenIn].filter((token) => token.address !== null);
  return contracts.find((token) => !token.verified) ?? (tokenOut.address ? tokenOut : null);
}

async function checkSafety(
  ctx: ActionCtx,
  input: { conversationId: Id<"dolphinConversations">; messageId: Id<"dolphinMessages">; token: TicketToken },
): Promise<Safety> {
  const address = input.token.address as string;
  const base = {
    agentKey: TOKEN_SAFETY_AGENT_KEY,
    agentName: "BNB Chain Token Safety",
    token: address,
    symbol: input.token.symbol,
    verdict: null,
    headline: null,
    reason: null,
    checkedAt: Date.now(),
  };

  const agent = await ctx.runQuery(internal.trade.safetyAgent, {});
  if (!agent || !agent.live) {
    return { ...base, unavailable: "The safety agent is not listed right now, so this token was not checked." };
  }
  const named = { ...base, agentName: agent.name };
  const args = { token: address, chainId: 56 };

  /* Recorded before the call, like every other call Dolphin makes. */
  const toolCallId = await ctx.runMutation(internal.dolphin.recordToolCall, {
    conversationId: input.conversationId,
    messageId: input.messageId,
    agentKey: TOKEN_SAFETY_AGENT_KEY,
    agentName: agent.name,
    toolName: "analyse",
    argumentsJson: JSON.stringify(args),
  });
  const startedAt = Date.now();

  try {
    const session = await openMcpSession(agent.endpoint);
    const result = await callMcpTool(session, "analyse", args);
    await ctx.runMutation(internal.dolphin.completeToolCall, {
      toolCallId,
      resultText: result.text.slice(0, 4_000),
      isError: result.isError,
      transportError: null,
      latencyMs: Date.now() - startedAt,
    });

    let decision: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(result.text) as { decision?: Record<string, unknown> };
      decision = parsed.decision ?? null;
    } catch {
      decision = null;
    }
    if (result.isError || !decision) {
      return { ...named, checkedAt: Date.now(), unavailable: `${agent.name} answered, but without a verdict for this token.` };
    }
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 600) : null);
    return {
      ...named,
      checkedAt: Date.now(),
      verdict: text(decision.verdict),
      headline: text(decision.headline),
      reason: text(decision.recommendationReason),
      unavailable: null,
    };
  } catch (cause) {
    const detail = cause instanceof McpError ? cause.message : String(cause);
    await ctx.runMutation(internal.dolphin.completeToolCall, {
      toolCallId,
      resultText: null,
      isError: true,
      transportError: detail.slice(0, 500),
      latencyMs: Date.now() - startedAt,
    });
    return { ...named, checkedAt: Date.now(), unavailable: `${agent.name} could not be reached just now.` };
  }
}

/**
 * The person's own words with each typo'd token swapped for its verified
 * symbol: "buy 0.01 bnn of u" -> "buy 0.01 BNB of u". Their phrasing is kept so
 * the button reads as what they meant to type.
 */
export function correctRequest(text: string, fixes: ReadonlyArray<{ typed: string; suggestion: string }>): string {
  let corrected = text.trim();
  for (const fix of fixes) {
    const escaped = fix.typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    corrected = corrected.replace(new RegExp(`\\$?\\b${escaped}\\b`, "i"), fix.suggestion);
  }
  return corrected;
}

/**
 * Answers the turn if it is a trade, and returns true. Returns false when the
 * text only looked like one ("get started"), so the chat answers it instead.
 */
export async function answerTradeTurn(
  ctx: ActionCtx,
  input: {
    text: string;
    conversationId: Id<"dolphinConversations">;
    messageId: Id<"dolphinMessages">;
  },
): Promise<boolean> {
  const intent = parseTradeIntent(input.text);
  if (!intent) return false;

  const reply = async (content: string, ticket?: unknown, suggestedPrompt?: string) => {
    await ctx.runMutation(internal.dolphin.setMessageStatus, {
      messageId: input.messageId,
      status: "complete",
      content,
      /* No model wrote this; null also keeps it out of answer reuse. */
      model: null,
      ...(ticket !== undefined ? { ticket } : {}),
      ...(suggestedPrompt !== undefined ? { suggestedPrompt } : {}),
    });
  };

  if (intent.kind === "incomplete") {
    const known = intent.token === null || verifiedTokenBySymbol(intent.token) !== null || /^0x[0-9a-fA-F]{40}$/.test(intent.token);
    if (!known) return false;
    await reply(intent.question);
    return true;
  }

  const [tokenIn, tokenOut] = await Promise.all([
    resolveTradeToken(intent.tokenIn),
    resolveTradeToken(intent.tokenOut),
  ]);
  if (!tokenIn.ok || !tokenOut.ok) {
    /*
     * A TYPO IS CONFIRMED, NOT GUESSED. (2026-09-26, the owner: typos should
     * be confirmed.) When every unknown side is one typo from a verified
     * symbol, the reply offers the corrected request as a one-tap button.
     * Tapping sends it as a new turn, which resolves exactly like a typed
     * one. Nothing is traded on the guess.
     */
    const failed = [
      { typed: intent.tokenIn, resolved: tokenIn },
      { typed: intent.tokenOut, resolved: tokenOut },
    ].flatMap((side) => (side.resolved.ok ? [] : [{ typed: side.typed, reason: side.resolved.reason, suggestion: side.resolved.suggestion }]));

    if (failed.every((side) => side.suggestion !== null)) {
      const corrected = correctRequest(input.text, failed as Array<{ typed: string; suggestion: string }>);
      const named = failed.map((side) => `"${side.typed}" as ${side.suggestion}`).join(" and ");
      await reply(`Did you mean ${named}? Tap to confirm, and I'll make the ticket.`, undefined, corrected);
      return true;
    }
    await reply(failed.map((side) => side.reason).join("\n\n"));
    return true;
  }
  const from = toTicketToken(tokenIn.token);
  const to = toTicketToken(tokenOut.token);

  if ((from.address ?? "bnb") === (to.address ?? "bnb")) {
    await reply(`Both sides are ${from.symbol}. Which token do you want to end up with?`);
    return true;
  }

  await ctx.runMutation(internal.dolphin.setMessageStatus, { messageId: input.messageId, status: "consulting" });
  const target = tokenToCheck(from, to);
  const safety = target
    ? await checkSafety(ctx, { conversationId: input.conversationId, messageId: input.messageId, token: target })
    : null;

  await reply(
    `Here's the trade: ${intent.amount} ${from.symbol} for ${to.symbol}. The price below is quoted live on PancakeSwap, and nothing moves until you sign.`,
    { kind: "swap", amountIn: intent.amount, tokenIn: from, tokenOut: to, safety },
  );
  return true;
}
