/**
 * WHAT AN AGENT'S TOOLS ACTUALLY DO, as opposed to what its name says.
 *
 * ===========================================================================
 * WHY THIS EXISTS (2026-09-12)
 * ===========================================================================
 * Measured against the live catalog, the marketplace was describing itself
 * backwards:
 *
 *   - The "trading" category held six agents. Every one of them publishes only
 *     `explain_strategy`, `list_agents`, `get_hire_link` or `top_traders`. Not
 *     one can trade. "Trading Agent 1" is a name.
 *
 *   - Meanwhile five agents filed under health-factor, yield, rebalancing and
 *     payments publish real Aave V3 and PancakeSwap V3 WRITE operations -
 *     `borrow`, `supply`, `repay`, `liquidationCall`, `createPosition`,
 *     `increaseLiquidity`, `claimCLMRewards`.
 *
 * So the one thing a person most wants to know about an agent - can it DO
 * something, or only tell me something - existed in the data and was visible
 * nowhere. `isMutating` already knew, but it lived inside decisionTools.ts and
 * was used for exactly one purpose: hiding those tools from the model. A safety
 * filter was the only thing in the codebase that understood capability, and it
 * only ever subtracted.
 *
 * This module is that same knowledge, stated once and readable by anything.
 * `decisionTools.ts` imports `isMutating` from here rather than defining its
 * own, so the brain's safety filter and the catalog's capability badge can
 * never disagree about what a write tool is.
 *
 * ===========================================================================
 * THE DISTINCTION THAT MATTERS: EXECUTES vs BUILDS
 * ===========================================================================
 * Not every write-shaped tool needs custody, and collapsing them loses the most
 * useful fact in the catalog.
 *
 *   DIRECT   `supply`, `borrow`, `deposit`, `withdraw` - a tool that performs
 *            the action. For an agent to use one ON YOUR BEHALF it needs
 *            signing authority, which Dolphin does not grant and cannot
 *            currently grant safely (FEATURE_SESSION_EXECUTION is off, and
 *            altana-policy.ts records why).
 *
 *   CALLDATA `topaz_build_swap_calldata`, `topaz_build_vote_calldata` - a tool
 *            that RETURNS AN UNSIGNED TRANSACTION. The agent never touches a
 *            key; the user signs from their own wallet. This is the pattern
 *            that makes agent-driven execution safe today, and Topaz shipped it
 *            into this registry without anyone here noticing.
 *
 * A catalog that cannot tell those apart either overstates what is safe or
 * understates what is possible. This one tells them apart.
 */

/**
 * Verbs that make a tool a write, wherever they appear in the name.
 *
 * Moved here from decisionTools.ts unchanged - including the note that
 * `setEModeCategory` and `setUsageAsCollateral` both survived an earlier
 * substring-only list, which is why the prefix list below is separate.
 */
const MUTATING_TOOL_PATTERNS = [
  "borrow", "supply", "withdraw", "repay", "liquidat", "swap", "transfer",
  "approve", "execute", "send", "buy", "sell", "stake", "claim", "mint",
  "burn", "deposit", "bridge", "sign", "rebalance", "cancel", "pause",
  "resume", "close", "open_position", "set_", "set-", "act", "trade",
  "allocate", "migrate", "route",
];

/**
 * Verbs that are only mutating when they START the name.
 *
 * Kept separate because as substrings they are everywhere and harmless -
 * "asset" contains "set", "budget" contains "get", "created_at" contains
 * "create".
 */
const MUTATING_PREFIXES = [
  "set", "add", "remove", "update", "create", "delete", "enable", "disable",
  "toggle", "start", "stop", "run",
];

/**
 * A tool that hands back an unsigned transaction instead of sending one.
 *
 * Matched on the name because that is all a tool listing gives us, and the
 * convention is consistent where it appears: `build_<action>_calldata`. A
 * false positive here would call a direct executor "safe", so the match
 * deliberately requires BOTH a build verb and the calldata noun rather than
 * either alone.
 */
function isCalldataBuilder(name: string): boolean {
  const lower = name.toLowerCase();
  const buildsSomething = lower.includes("build") || lower.includes("prepare");
  const namesCalldata =
    lower.includes("calldata") || lower.includes("_tx") || lower.endsWith("transaction");
  return buildsSomething && namesCalldata;
}

/** True when calling this tool would change on-chain state. */
export function isMutating(toolName: string): boolean {
  const name = toolName.toLowerCase();
  if (MUTATING_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  // camelCase and snake_case both appear in this catalog, so match on the raw
  // lowercased string rather than tokenizing.
  return MUTATING_TOOL_PATTERNS.some((pattern) => name.includes(pattern));
}

/**
 * What an agent can do, derived from the tools it actually publishes.
 *
 * `none` is not a criticism. Most good agents in this catalog read and explain,
 * and a read-only agent is the only kind that can be hired with no trust at all.
 */
export type ExecutionKind =
  /** Reads and reports only. Nothing it offers changes state. */
  | "none"
  /** Returns unsigned transactions for the user to sign. Safe without custody. */
  | "calldata"
  /** Publishes tools that perform the action. Needs authority Dolphin withholds. */
  | "direct";

export type ExecutionCapability = Readonly<{
  kind: ExecutionKind;
  /** Write-shaped tool names, for showing the evidence rather than a claim. */
  writeTools: readonly string[];
  /** The subset that builds unsigned transactions. */
  calldataTools: readonly string[];
}>;

/* ---------------------------------------------------------------------------
 * A SECOND, ACCURATE LIST — and why it cannot be the denylist above.
 * ---------------------------------------------------------------------------
 * `isMutating` fails CLOSED on purpose: if in doubt, hide the tool from the
 * model. Over-matching costs nothing there. Run over the live catalog it flags
 * 54 of 261 tool names, and most are reads - `getMaximumBorrowsAmount`,
 * `getUserBorrowingPower`, `previewDepositCLM`, `swap_quote`, `top_traders`,
 * `bobai_circulating_supply`, `pancakeswap_best_route`,
 * `estimateRangesForSellingUsdSingleSide`.
 *
 * A BADGE fails the other way. "Can act on-chain" on an agent that only reads
 * is a false claim about a stranger's software, shown to someone deciding
 * whether to trust it. So the badge gets its own matching, checked against the
 * real 261 names rather than inherited.
 *
 * It also misses in the other direction: `collectFees`, `increaseLiquidity` and
 * `decreaseLiquidity` are real PancakeSwap V3 writes that the denylist does not
 * catch at all, because nothing in it says "collect" or "increase". Defence in
 * depth covers that (Dolphin holds no key), but a capability read must not.
 * ------------------------------------------------------------------------ */

/** A read, whatever else the name contains. Checked first, and it wins. */
const READ_MARKERS = [
  "quote", "preview", "estimate", "simulate", "compare", "recommend",
  "overview", "summary", "ranking", "history", "stats", "status", "info",
  "balance", "price", "circulating", "burned", "activity", "tokenomics",
  "guide", "links", "census", "employment", "route", "fee_tier", "plan",
  "eligibility", "health", "portfolio", "pnl", "supported", "uptime",
];

const READ_PREFIXES = [
  "get", "list", "read", "fetch", "query", "show", "view", "top", "find",
  "search", "check", "describe", "explain", "validate", "verify", "analyse",
  "analyze", "report", "state", "watch", "vault_", "is", "has",
];

/** Verbs the safety denylist does not carry, verified as writes in this catalog. */
const EXTRA_WRITE_PREFIXES = ["collect", "increase", "decrease", "confirm", "register"];

function looksRead(name: string): boolean {
  const lower = name.toLowerCase();
  if (READ_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return READ_MARKERS.some((marker) => lower.includes(marker));
}

function isWriteTool(name: string): boolean {
  if (looksRead(name)) return false;
  const lower = name.toLowerCase();
  if (EXTRA_WRITE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return isMutating(name);
}

/**
 * DERIVED, NEVER STORED.
 *
 * AGENTS.md §9: persist decisions that cost a network round trip, re-derive the
 * ones that cost microseconds. This is string work over a list the probe
 * already stored, so a column for it would be a second copy of the truth that
 * can go stale - and the 251,922-row ledger that file warns about is what
 * storing cheap derivations looks like at scale.
 *
 * `protocol` is required, and A2A short-circuits to `none`. An A2A agent's
 * "skills" are PROSE - "Notify the seller a job is funded", "Which PancakeSwap
 * fee tier is actually paying its liquidity providers" - not callable tool
 * names, so identifier matching over them is meaningless (it was matching the
 * words "seller", "act" and "factor"). More to the point it is the wrong
 * question: an A2A agent is commissioned over escrow and delivers a
 * deliverable. It exposes nothing to call and executes nothing for anybody.
 */
export function readExecutionCapability(
  skills: readonly { name: string }[],
  protocol: "a2a" | "mcp",
): ExecutionCapability {
  if (protocol === "a2a") {
    return { kind: "none", writeTools: [], calldataTools: [] };
  }

  const writeTools: string[] = [];
  const calldataTools: string[] = [];

  for (const skill of skills) {
    const name = skill.name;
    if (!name) continue;
    if (isCalldataBuilder(name)) {
      calldataTools.push(name);
      writeTools.push(name);
      continue;
    }
    if (isWriteTool(name)) writeTools.push(name);
  }

  if (writeTools.length === 0) {
    return { kind: "none", writeTools: [], calldataTools: [] };
  }
  /*
   * An agent offering BOTH is reported as `calldata`, deliberately.
   *
   * The question this answers is "what is the safest way to use this agent",
   * and if any path returns an unsigned transaction then a user can get value
   * from it without granting anything. Reporting `direct` because a riskier
   * tool also exists would hide the safe path behind the dangerous one.
   */
  if (calldataTools.length > 0) {
    return { kind: "calldata", writeTools, calldataTools };
  }
  return { kind: "direct", writeTools, calldataTools: [] };
}

/** One line a person can read, for the catalog badge. */
export function executionCopy(capability: ExecutionCapability): {
  label: string;
  detail: string;
} {
  switch (capability.kind) {
    case "calldata":
      return {
        label: "Builds transactions",
        detail:
          `This agent returns unsigned transactions you sign from your own wallet — it never ` +
          `holds a key and cannot move anything by itself. ${capability.calldataTools.length} of its ` +
          `tools work this way.`,
      };
    case "direct":
      return {
        label: "Can act on-chain",
        detail:
          `This agent publishes ${capability.writeTools.length} tools that change on-chain state. ` +
          `Dolphin does not call them: acting on your behalf would need signing authority it does ` +
          `not grant. What it reads and reports is available today.`,
      };
    case "none":
      return {
        label: "Reads and reports",
        detail:
          "Every tool this agent publishes is a read. It can tell you things; it cannot change " +
          "anything, which is why hiring it costs no trust beyond the fee.",
      };
  }
}
