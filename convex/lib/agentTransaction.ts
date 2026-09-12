import { getAddress, isAddress } from "viem";

/**
 * AGENT-BUILT TRANSACTIONS: the one way an agent can act without holding a key.
 *
 * ===========================================================================
 * WHY THIS IS THE SAFE SHAPE (2026-09-12)
 * ===========================================================================
 * Dolphin has refused to let agents execute, and the refusal was correct: for
 * an agent to act on your behalf something must sign, and the options were a
 * session key delivered to a stranger's server (custody leaves the device) or
 * the user co-signing every action (not autonomous). altana-policy.ts records
 * that stalemate and FEATURE_SESSION_EXECUTION has been off ever since.
 *
 * There is a third option and it was already in this registry. Topaz publishes
 * `topaz_build_swap_calldata` and five siblings: tools that BUILD an unsigned
 * transaction and hand it back. The agent computes the route, the amounts and
 * the approvals; the user's own wallet signs. No key is shared, no allowance is
 * granted to the agent, and nothing is autonomous in the dangerous sense - but
 * the agent did the work, which is the whole point of hiring it.
 *
 * Measured live against agents.topazdex.com, a swap returns five ordered calls
 * (clear legacy allowance, reset to Permit2, approve, Permit2 approve, swap),
 * each with a human label, plus `atomicRequired: true`.
 *
 * THAT FLAG IS WHY THIS WORKS HERE AND NOT IN A NORMAL WALLET. Five calls that
 * must land together are not something an EOA can promise - a user could sign
 * three and stop, leaving a live approval and no swap. The Dolphin Wallet is an
 * EIP-7702 smart account whose relay executes `calls[]` as ONE intent, so
 * atomicity is native. The capability Dolphin already had for its own escrow
 * batching is exactly the capability this needs.
 *
 * ===========================================================================
 * EVERYTHING BELOW IS PARSING A STRANGER'S JSON
 * ===========================================================================
 * This output is publisher-controlled and ends up in front of a signer, so it
 * is validated rather than trusted: addresses must be addresses, calldata must
 * be hex, values must be integers. A malformed plan is refused with a reason,
 * never partially executed - half a swap batch is worse than none.
 *
 * What this canNOT check is INTENT. A validated call is well-formed, not
 * benign: `to` could be any contract and `data` any function. That is why the
 * UI shows every call and its label before anything is signed, and why the
 * user's own wallet is what approves it. Dolphin relays and renders; it does
 * not vouch.
 */

/** One call in an agent-built batch, after validation. */
export type AgentCall = Readonly<{
  to: string;
  data: string;
  /** Decimal wei string. "0" for a pure contract call. */
  value: string;
  /** The agent's own words for this step. Shown verbatim, attributed. */
  label: string | null;
}>;

export type AgentTransactionPlan = Readonly<{
  chainId: number;
  calls: readonly AgentCall[];
  /** Must every call land together? Refused unless the executor guarantees it. */
  atomicRequired: boolean;
  /** The account the agent built this for. Checked against the caller's wallet. */
  payer: string | null;
  /**
   * The agent's own description of the outcome - route, expected output,
   * slippage, deadline. Rendered as the AGENT'S CLAIM, never as Dolphin's
   * promise, for the reason recorded in mcpClient.ts: an agent's prose is a
   * claim by that agent and a `collectFees` tool in this catalog has already
   * reported success for something that did not happen.
   */
  summary: Readonly<Record<string, string>>;
  /** The untouched tool output, so a disagreement is settleable by looking. */
  raw: string;
}>;

export class AgentPlanRejected extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Hex calldata: 0x, even length, hex digits only. Empty `0x` is a plain send. */
function parseCalldata(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) return null;
  return value;
}

/** Decimal wei. Accepts a number only when it is a safe integer. */
function parseValue(value: unknown): string | null {
  if (value === undefined || value === null) return "0";
  if (typeof value === "string") {
    if (/^[0-9]+$/.test(value)) return value;
    if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value).toString();
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

/** Scalars from the agent's summary, stringified for display. Objects dropped. */
function collectSummary(record: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "transactions" || key === "calls") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = String(value);
    }
  }
  return summary;
}

/**
 * Turns a calldata tool's text output into a plan, or throws with a reason.
 *
 * Throwing beats returning a partial plan for the same reason normalizeQuote
 * throws on a half-understood price: a batch we could not fully read is one we
 * must not put a signature behind.
 */
export function parseAgentTransactionPlan(
  toolText: string,
  expectedChainId: number,
): AgentTransactionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolText);
  } catch {
    throw new AgentPlanRejected(
      "This agent answered with something that is not JSON, so Dolphin could not read a " +
        "transaction out of it. Nothing was signed.",
    );
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new AgentPlanRejected("This agent's answer was not a JSON object.");
  }

  const rawCalls = Array.isArray(record.transactions)
    ? record.transactions
    : Array.isArray(record.calls)
      ? record.calls
      : null;
  if (!rawCalls || rawCalls.length === 0) {
    throw new AgentPlanRejected(
      "This agent returned no transactions to sign. It may have declined the request — its own " +
        "answer is shown below.",
    );
  }

  /*
   * The chain is checked before anything else about the calls. A batch built
   * for another chain is not merely wrong, it is calldata aimed at whatever
   * happens to live at those addresses on THIS one.
   */
  const chainId =
    typeof record.chainId === "number" ? record.chainId : expectedChainId;
  if (chainId !== expectedChainId) {
    throw new AgentPlanRejected(
      `This agent built a transaction for chain ${chainId}, but your Dolphin Wallet is on chain ` +
        `${expectedChainId}. Refusing to sign calldata meant for a different chain.`,
    );
  }

  const calls: AgentCall[] = [];
  for (const [index, entry] of rawCalls.entries()) {
    const call = asRecord(entry);
    const to = call && typeof call.to === "string" && isAddress(call.to) ? getAddress(call.to) : null;
    const data = call ? parseCalldata(call.data ?? "0x") : null;
    const value = call ? parseValue(call.value) : null;

    if (!to || data === null || value === null) {
      throw new AgentPlanRejected(
        `Step ${index + 1} of this agent's transaction is malformed — Dolphin could not read a ` +
          "valid destination, calldata and value from it. Refusing the whole batch rather than " +
          "signing part of one.",
      );
    }

    calls.push({
      to,
      data,
      value,
      label: call && typeof call.label === "string" ? call.label : null,
    });
  }

  return {
    chainId,
    calls,
    atomicRequired: record.atomicRequired === true,
    payer:
      typeof record.payer === "string" && isAddress(record.payer)
        ? getAddress(record.payer)
        : null,
    summary: collectSummary(record),
    raw: toolText,
  };
}
