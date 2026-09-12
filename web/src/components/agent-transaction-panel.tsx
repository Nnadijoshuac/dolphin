"use client";

import { useAction } from "convex/react";
import { useState } from "react";

import { agentToolsApi, type AgentTransactionPlan } from "@/convex/api";
import type { Agent } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * AN AGENT BUILDS IT. THE USER SIGNS IT. NOBODY HOLDS A KEY.
 *
 * ===========================================================================
 * WHY THIS SCREEN EXISTS (2026-09-12)
 * ===========================================================================
 * Dolphin has never let an agent act, and the reason was sound: acting needs a
 * signer, and the options were handing a session key to a stranger's server or
 * asking the user to approve every step. altana-policy.ts records that
 * stalemate and FEATURE_SESSION_EXECUTION has been off since.
 *
 * Topaz was already shipping the third option into this registry. Its
 * `*_build_*_calldata` tools return UNSIGNED transactions - the agent computes
 * the route, the amounts and the approvals, and the user's own wallet signs.
 * Nothing is granted to the agent. Measured live, a swap comes back as five
 * ordered calls with `atomicRequired: true`, which the Dolphin Wallet's relay
 * executes as one intent.
 *
 * ===========================================================================
 * WHAT THIS PANEL REFUSES TO DO
 * ===========================================================================
 * It does not summarise the calls and hide them. Every call is listed with its
 * destination, its label and its value BEFORE the button is pressed, because
 * `to` is an address a stranger chose and `data` is a function Dolphin did not
 * write. Validation upstream proves the batch is well-formed; nothing proves it
 * is benign, and pretending otherwise is the failure this whole codebase keeps
 * guarding against.
 *
 * The agent's own numbers - expected output, slippage, route - are shown as
 * ITS claims, attributed, never restated as Dolphin's. mcpClient.ts records why:
 * a `collectFees` tool in this catalog once reported success for something that
 * never happened.
 */

type PanelState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "ready"; plan: AgentTransactionPlan; agentName: string }
  | { kind: "signing"; plan: AgentTransactionPlan; agentName: string }
  | { kind: "signed"; reference: string }
  | { kind: "error"; message: string };

/** Argument names these tools take that Dolphin can fill in for the user. */
const TAKER_KEYS = ["taker", "wallet", "account", "address", "userAddress"];

export function AgentTransactionPanel({ agent }: { agent: Agent }) {
  const wallet = useAltanaWallet();
  const buildTransaction = useAction(agentToolsApi.agentTools.buildAgentTransaction);

  const [tool, setTool] = useState(agent.execution.calldataTools[0] ?? "");
  const [args, setArgs] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  // Only an agent that BUILDS transactions reaches this panel. A direct-write
  // agent is deliberately not offered here - see convex/agentTools.ts.
  if (agent.execution.kind !== "calldata") return null;

  async function build() {
    setState({ kind: "building" });
    try {
      let parsed: Record<string, string | number | boolean | string[]> = {};
      if (args.trim().length > 0) {
        parsed = JSON.parse(args) as typeof parsed;
      }
      /*
       * The wallet address is filled in rather than typed. Every builder in
       * this catalog takes one, it must be the signing account for the
       * approvals inside the calldata to mean anything, and a user pasting the
       * wrong address gets a batch that spends from somewhere they do not
       * control.
       */
      if (wallet.address) {
        for (const key of TAKER_KEYS) {
          if (key in parsed) parsed[key] = wallet.address;
        }
        if (!TAKER_KEYS.some((key) => key in parsed)) parsed.taker = wallet.address;
      }

      const result = await buildTransaction({
        agentKey: agent.agentKey,
        toolName: tool,
        toolArguments: parsed,
      });
      setState({ kind: "ready", plan: result.plan, agentName: result.agentName });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(
          cause,
          "This agent could not build that transaction. Nothing was signed.",
        ),
      });
    }
  }

  async function sign(plan: AgentTransactionPlan, agentName: string) {
    setState({ kind: "signing", plan, agentName });
    try {
      const reference = await wallet.executeAgentPlan(plan);
      setState({ kind: "signed", reference });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(cause, "That transaction could not be signed."),
      });
    }
  }

  const plan = state.kind === "ready" || state.kind === "signing" ? state.plan : null;

  return (
    <div className="surface-raised mt-6 p-5 sm:p-6">
      <p className="eyebrow">Act on-chain</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
        Let this agent build a transaction
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        {agent.name} returns an unsigned transaction that you sign from your own Dolphin
        Wallet. It never holds a key and is never granted an allowance &mdash; it does the
        work, you approve the result.
      </p>

      <label className="mt-5 block text-xs font-medium text-muted" htmlFor="agent-tool">
        Which tool
      </label>
      <select
        className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink"
        disabled={state.kind === "building" || state.kind === "signing"}
        id="agent-tool"
        onChange={(event) => setTool(event.target.value)}
        value={tool}
      >
        {agent.execution.calldataTools.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <label className="mt-4 block text-xs font-medium text-muted" htmlFor="agent-args">
        Arguments (JSON)
      </label>
      <textarea
        className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs text-ink"
        disabled={state.kind === "building" || state.kind === "signing"}
        id="agent-args"
        onChange={(event) => setArgs(event.target.value)}
        placeholder={'{ "sellToken": "USDT", "buyToken": "BNB", "sellAmount": "1" }'}
        rows={3}
        value={args}
      />
      <p className="mt-1 text-[0.68rem] leading-5 text-faint">
        Your wallet address is filled in automatically &mdash; the approvals inside the
        calldata only mean anything if the signer owns them.
      </p>

      <button
        className="wallet-action-btn wallet-action-btn--accent interactive mt-4"
        disabled={!tool || state.kind === "building" || state.kind === "signing" || wallet.isBusy}
        onClick={() => void build()}
        type="button"
      >
        {state.kind === "building" ? "Asking the agent…" : "Build transaction"}
      </button>

      {plan && (
        <div className="mt-5 border-t border-line pt-4">
          {/* The agent's own claims, labelled as such. */}
          {Object.keys(plan.summary).length > 0 && (
            <>
              <p className="text-xs font-semibold text-ink">
                What {state.kind === "ready" ? state.agentName : "the agent"} says this does
              </p>
              <dl className="mt-2 text-xs">
                {Object.entries(plan.summary).map(([key, value]) => (
                  <div
                    className="flex items-start justify-between gap-4 border-b border-line py-2"
                    key={key}
                  >
                    <dt className="text-muted">{key}</dt>
                    <dd className="break-all text-right font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <p className="mt-4 text-xs font-semibold text-ink">
            {plan.calls.length} call{plan.calls.length === 1 ? "" : "s"} you are about to sign
            {plan.atomicRequired ? " — all together, or none" : ""}
          </p>
          <ol className="mt-2 space-y-2">
            {plan.calls.map((call, index) => (
              <li className="rounded-xl border border-line p-3 text-xs" key={`${call.to}-${index}`}>
                <p className="font-medium text-ink">
                  {index + 1}. {call.label ?? "Unlabelled call"}
                </p>
                <p className="mt-1 break-all font-mono text-[0.64rem] text-muted">to {call.to}</p>
                <p className="mt-0.5 break-all font-mono text-[0.64rem] text-faint">
                  {call.data.slice(0, 74)}
                  {call.data.length > 74 ? "…" : ""}
                </p>
                {call.value !== "0" && (
                  <p className="mt-0.5 font-mono text-[0.64rem] text-ink-soft">
                    sends {call.value} wei
                  </p>
                )}
              </li>
            ))}
          </ol>

          <p className="mt-3 text-[0.68rem] leading-5 text-faint">
            Dolphin checked this batch is well-formed and built for your wallet. It cannot
            check what these contracts do &mdash; read the destinations before you sign.
          </p>

          <button
            className="wallet-action-btn wallet-action-btn--accent interactive mt-3"
            disabled={state.kind === "signing" || wallet.isBusy}
            onClick={() => void sign(plan, state.kind === "ready" ? state.agentName : agent.name)}
            type="button"
          >
            {state.kind === "signing" ? "Confirm with passkey…" : "Sign and send"}
          </button>
        </div>
      )}

      {state.kind === "signed" && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs leading-5 text-success">Signed and submitted.</p>
          <a
            className="interactive mt-1 inline-block break-all font-mono text-[0.64rem] text-muted hover:text-ink"
            href={`https://bscscan.com/tx/${state.reference}`}
            rel="noreferrer"
            target="_blank"
          >
            {state.reference} ↗
          </a>
        </div>
      )}

      {state.kind === "error" && (
        <p className="mt-4 whitespace-pre-line text-xs leading-5 text-danger" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
