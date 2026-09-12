"use client";

import { useAction } from "convex/react";
import { useState } from "react";

import { agentTrialsApi, type AgentTrialOutcome } from "@/convex/api";
import { track } from "@/lib/analytics";
import type { Agent } from "@/types/agent";

/**
 * ===========================================================================
 * SHOW THE AGENT WORKING, BEFORE ASKING FOR ANYTHING
 * ===========================================================================
 * A listing could describe an agent and never demonstrate one. To get anything
 * back a visitor had to connect a wallet, sign, and record a hire — and a hire
 * writes a database row, so the honest answer to "what do I actually get" was
 * "nothing you can see". Every cost came before the payoff and the payoff was
 * absent.
 *
 * This runs one of the agent's own read-only tools on its own server and puts
 * the reply on the page. No wallet, no signature, no payment, no account.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS IS CAREFUL ABOUT
 * ---------------------------------------------------------------------------
 * 1. THE OUTPUT IS THE AGENT'S WORDS, NOT DOLPHIN'S. It is rendered in a
 *    quoted block, attributed by name, in monospace — visually a transcript,
 *    never a Dolphin metric. convex/lib/mcpClient.ts records a `collectFees`
 *    tool in this catalog that reported success having collected nothing; an
 *    agent's prose is a claim by that agent and restating it as fact is how
 *    this product would launder one.
 * 2. A CACHED ANSWER SAYS SO. The backend serves a recent result rather than
 *    re-calling a stranger's server, which is a real freshness caveat and gets
 *    the same treatment every other value on this page gets: the age is shown.
 *
 * Offered for any agent running an MCP server Dolphin has reached - which is
 * NOT the same as `protocol === "mcp"`, because an agent can speak both and
 * `protocol` names only the primary transport. A pure A2A agent is
 * commissioned over escrow and publishes nothing to call, and a write tool is
 * refused by the backend regardless of what this renders.
 */

function relativeAge(calledAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - calledAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** How many tool chips to offer. A listing is a preview, not a console. */
const MAX_OFFERED = 4;

export function AgentTrialPanel({ agent }: { agent: Agent }) {
  const run = useAction(agentTrialsApi.agentTrials.tryAgentTool);

  const [outcome, setOutcome] = useState<AgentTrialOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  /*
   * Keyed on the MCP SURFACE, not the primary protocol. An A2A-primary agent
   * can still run an MCP server, and `protocol !== "mcp"` would hide its tools
   * - the same collapse the probe used to make before 2026-09-12.
   */
  if (!agent.mcpEndpoint) return null;

  /*
   * `previewableTools` is the agent's OWN schema saying a tool needs no
   * argument (convex/lib/publicAgent.ts). Offering anything else would be
   * offering a button that errors — measured on the live catalog, every read
   * tool on Aave-powered-by-HeyAnon wants at least `chainName`, so a panel
   * that guessed from tool names would have shown four chips and failed on
   * all four.
   *
   * Write tools are excluded a second time here. They are already absent from
   * previewableTools and already refused by the backend against the agent's
   * published list; this is belt-and-braces on the one control a visitor can
   * actually press.
   */
  const writeTools = new Set(agent.execution.writeTools);
  const readTools = agent.previewableTools
    .filter((name) => !writeTools.has(name))
    .slice(0, MAX_OFFERED);

  if (readTools.length === 0) return null;

  async function onRun(toolName: string) {
    if (running !== null) return;
    setRunning(toolName);
    setFailure(null);

    track("agent_tool_previewed", {
      agentKey: agent.agentKey,
      category: agent.category,
    });

    try {
      setOutcome(await run({ agentKey: agent.agentKey, toolName }));
    } catch (cause) {
      setOutcome(null);
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="surface-raised p-5" aria-labelledby="trial-heading">
      <p className="eyebrow">Try it</p>
      <h2 className="section-title mt-2 text-lg" id="trial-heading">
        Run this agent now
      </h2>
      <p className="mt-2 text-sm text-muted">
        Dolphin calls one of {agent.name}&rsquo;s own read-only tools and shows
        you what comes back. No wallet, no signature, nothing to pay.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {readTools.map((toolName) => (
          <button
            className="interactive min-h-10 rounded-xl border border-line bg-paper px-3 font-mono text-xs font-medium text-ink hover:bg-canvas disabled:cursor-wait disabled:opacity-60"
            disabled={running !== null}
            key={toolName}
            onClick={() => void onRun(toolName)}
            type="button"
          >
            {running === toolName ? "Calling…" : toolName}
          </button>
        ))}
      </div>

      {failure ? (
        <div className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-danger">
            Could not run it
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{failure}</p>
        </div>
      ) : null}

      {outcome ? (
        <figure className="mt-4">
          <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-faint">
            <span className="font-semibold text-muted">
              {outcome.agentName} · {outcome.toolName}
            </span>
            <span aria-hidden>·</span>
            {/*
              * Freshness, stated rather than implied. A cached reply is a real
              * caveat and gets the same treatment every other value on this
              * page gets.
              */}
            <span>
              {outcome.cached
                ? `answered ${relativeAge(outcome.calledAt)}, cached`
                : `answered just now in ${outcome.latencyMs}ms`}
            </span>
            {outcome.isError ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-semibold text-danger">
                  the agent reported an error
                </span>
              </>
            ) : null}
          </figcaption>

          {/*
            * A TRANSCRIPT, NOT A METRIC. Quoted, monospaced and attributed
            * above, so nothing here can be mistaken for a number Dolphin
            * measured. See the header.
            */}
          <blockquote className="mt-2 max-h-72 overflow-auto rounded-xl border border-line bg-paper-muted px-4 py-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-soft">
              {outcome.resultText.length > 0
                ? outcome.resultText
                : "The agent answered with no content."}
            </pre>
          </blockquote>

          <p className="mt-2 text-[0.7rem] text-faint">
            {agent.name}&rsquo;s own words, relayed unedited. Dolphin did not
            check whether any of it is true.
          </p>
        </figure>
      ) : null}
    </section>
  );
}
