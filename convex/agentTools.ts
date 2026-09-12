import { v } from "convex/values";

import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { callMcpTool, openMcpSession } from "./lib/mcpClient";
import { AgentPlanRejected, parseAgentTransactionPlan } from "./lib/agentTransaction";
import { readExecutionCapability } from "./lib/toolCapability";

/**
 * Asking an agent to BUILD a transaction the user will sign.
 *
 * ===========================================================================
 * WHAT THIS IS, AND THE LINE IT DOES NOT CROSS
 * ===========================================================================
 * Same posture as convex/agentPayments.ts and for the same reason: this is a
 * RELAY, not a signer. It calls a tool over MCP on the client's behalf (the
 * browser often cannot - these endpoints are third-party and CORS varies),
 * validates what comes back, and returns it. It holds no key, signs nothing,
 * and cannot move a token.
 *
 * The signature happens in the browser, by the user's own passkey, against a
 * plan they have seen every call of.
 *
 * ===========================================================================
 * ONLY CALLDATA BUILDERS. NEVER A DIRECT WRITE.
 * ===========================================================================
 * The gate below is the whole safety argument, so it is worth stating plainly.
 * `readExecutionCapability` splits an agent's tools into ones that PERFORM an
 * action and ones that RETURN an unsigned transaction. This action will only
 * invoke the second kind, checked against the agent's own published tool list
 * rather than against the name the caller sent.
 *
 * A direct write tool - `supply`, `borrow`, `liquidationCall` - would have to
 * execute using whatever authority the AGENT holds, which is not the user's and
 * not knowable from here. Those stay filtered, exactly as decisionTools.ts
 * filters them from the model.
 */

const TOOL_ARGUMENT_LIMIT = 32;

/** What this action returns. Named so the handler can be annotated - see below. */
type BuiltAgentTransaction = {
  agentName: string;
  toolName: string;
  plan: {
    chainId: number;
    calls: { to: string; data: string; value: string; label: string | null }[];
    atomicRequired: boolean;
    payer: string | null;
    summary: Record<string, string>;
    raw: string;
  };
};

/**
 * The slice of the public agent record this action reads.
 *
 * Annotated rather than inferred for the same reason the return type below is:
 * `ctx.runQuery(api.agents.get, …)` resolves through the generated `api`, which
 * includes THIS module, so inferring it needs this module's type, which needs
 * this inference. TS7022. Naming the shape breaks the cycle without widening
 * anything - every field below is one this handler actually uses.
 */
type CallableAgent = {
  name: string;
  protocol: "a2a" | "mcp";
  skills: { name: string }[];
  services: { endpoint: string }[];
};

export const buildAgentTransaction = action({
  args: {
    agentKey: v.string(),
    toolName: v.string(),
    /**
     * Flat scalars only. The MCP schemas in this catalog take strings, numbers
     * and string arrays; accepting arbitrary nesting would mean forwarding a
     * structure Dolphin has not inspected into a stranger's tool.
     */
    toolArguments: v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean(), v.array(v.string())),
    ),
  },
  // Return type annotated explicitly: TS7023, same cycle recordJobPayment
  // documents in agentPayments.ts.
  handler: async (ctx, { agentKey, toolName, toolArguments }): Promise<BuiltAgentTransaction> => {
    const agent = (await ctx.runQuery(api.agents.get, {
      reference: agentKey,
    })) as CallableAgent | null;
    if (!agent) {
      throw new Error(`buildAgentTransaction: agent ${agentKey} is not in Dolphin's catalog.`);
    }
    if (agent.protocol !== "mcp") {
      throw new Error(
        `${agent.name} is an A2A agent. Those are commissioned over ERC-8183 escrow and deliver a ` +
          "result; they publish no callable tools. Hire it instead.",
      );
    }

    const capability = readExecutionCapability(
      agent.skills.map((skill) => ({ name: skill.name })),
      "mcp",
    );
    if (!capability.calldataTools.includes(toolName)) {
      /*
       * Deliberately specific about WHY, because the two refusals mean
       * different things: a tool that does not exist is a client bug, and a
       * tool that exists but executes is a boundary Dolphin is holding.
       */
      const isKnownWrite = capability.writeTools.includes(toolName);
      throw new Error(
        isKnownWrite
          ? `${toolName} performs an on-chain action itself rather than returning a transaction ` +
            "to sign. Dolphin will not call it: acting through it would use the agent's own " +
            "authority, not yours. Only transaction-building tools are callable here."
          : `${agent.name} publishes no transaction-building tool called ${toolName}.`,
      );
    }

    if (Object.keys(toolArguments).length > TOOL_ARGUMENT_LIMIT) {
      throw new Error("Too many arguments for one tool call.");
    }

    const endpoint = agent.services[0]?.endpoint;
    if (!endpoint) {
      throw new Error(`${agent.name} publishes no MCP endpoint to call.`);
    }

    const session = await openMcpSession(endpoint);
    try {
      const result = await callMcpTool(session, toolName, toolArguments);
      if (result.isError) {
        throw new Error(
          `${agent.name} refused to build this transaction. It said: ${result.text.slice(0, 400)}`,
        );
      }

      try {
        const plan = parseAgentTransactionPlan(result.text, BSC_CHAIN_ID);
        return {
          agentName: agent.name,
          toolName,
          plan: {
            chainId: plan.chainId,
            calls: plan.calls.map((call) => ({ ...call })),
            atomicRequired: plan.atomicRequired,
            payer: plan.payer,
            summary: plan.summary,
            raw: plan.raw.slice(0, 8_000),
          },
        };
      } catch (cause) {
        if (cause instanceof AgentPlanRejected) {
          // The agent's own words travel with the refusal - it often declined
          // for a real reason (no route, no balance) and that is the answer.
          throw new Error(`${cause.message}\n\n${agent.name} said: ${result.text.slice(0, 400)}`);
        }
        throw cause;
      }
    } finally {
      /*
       * No close call: mcpClient exposes none, and the transport is
       * stateless per request beyond the session header. The endpoint
       * expires its own sessions.
       */
    }
  },
});
