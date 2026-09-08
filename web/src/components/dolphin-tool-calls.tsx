"use client";

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";

import { AgentIcon } from "@/components/agent-icon";
import type { DolphinToolCall } from "@/hooks/use-dolphin-conversation";

/**
 * THE AGENTS DOLPHIN CONSULTED.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT IS THE PRODUCT
 * ---------------------------------------------------------------------------
 * Everything else on this page is a chat interface, and chat interfaces are a
 * commodity. This is the part that says Dolphin did not answer from its own
 * weights - it called these specific third-party agents, asked them these
 * specific things, and got these specific answers back, in this many
 * milliseconds.
 *
 * Every row comes from `dolphinToolCalls`, which convex/dolphin.ts writes
 * BEFORE each call and patches after. It is not parsed out of the model's
 * prose, and it must never be: the model is small and free and will claim to
 * have consulted an agent it never called. If the answer text and these rows
 * disagree, these rows are right.
 *
 * Each row links to the agent's own marketplace page, which makes the chat a
 * discovery surface feeding the catalog rather than competing with it.
 */

function Chevron({ open, size = 16 }: { open: boolean; size?: number }) {
  return (
    <HugeiconsIcon
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      icon={ArrowDown01Icon}
      size={size}
    />
  );
}

/**
 * The consulted agents' icons, overlapped and alternately tilted.
 *
 * Deduplicated by AGENT rather than by tool: Dolphin frequently calls the same
 * agent twice in one turn, and four identical stacked icons would imply four
 * sources where there is one.
 */
function StackedIcons({ calls }: { calls: DolphinToolCall[] }) {
  const seen = new Set<string>();
  const unique = calls.filter((call) => {
    if (seen.has(call.agentKey)) return false;
    seen.add(call.agentKey);
    return true;
  });

  const shown = unique.slice(0, 6);

  return (
    <div className="flex min-h-8 items-center -space-x-2">
      {shown.map((call, index) => (
        <div
          className="relative flex min-w-8 items-center justify-center"
          key={call.agentKey}
          style={{
            rotate: shown.length > 1 ? (index % 2 === 0 ? "8deg" : "-8deg") : "0deg",
            zIndex: index,
          }}
        >
          {/*
            The agent's own icon, not a generic tool glyph. `seed` gives the
            same deterministic fallback the catalog draws when a publisher
            serves no image, so a consulted agent looks here exactly as it looks
            on its own card.
          */}
          <AgentIcon category="monitoring" seed={call.agentKey} size={26} />
        </div>
      ))}
      {unique.length > shown.length ? (
        <div className="z-10 grid size-7 min-w-7 place-items-center rounded-lg bg-paper-muted text-[0.65rem] font-medium text-muted">
          +{unique.length - shown.length}
        </div>
      ) : null}
    </div>
  );
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function DolphinToolCalls({ calls }: { calls: DolphinToolCall[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (calls.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const agentCount = new Set(calls.map((call) => call.agentKey)).size;
  const pending = calls.some((call) => call.latencyMs === null);

  return (
    <div className="w-fit max-w-full">
      <button
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 py-2 text-muted transition-colors hover:text-ink"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <StackedIcons calls={calls} />
        <span className="text-xs font-medium">
          {pending ? "Consulting" : "Consulted"} {agentCount} agent
          {agentCount > 1 ? "s" : ""}
          <span className="text-faint">
            {" · "}
            {calls.length} call{calls.length > 1 ? "s" : ""}
          </span>
        </span>
        <Chevron open={open} size={18} />
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ${
          open ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="pt-1">
          {calls.map((call, index) => {
            const isOpen = expanded.has(call.id);
            const failed = call.transportError !== null;
            const isPending = call.latencyMs === null;

            return (
              <div className="flex items-stretch gap-2.5" key={call.id}>
                {/* Icon column with the connector line down to the next call. */}
                <div className="flex shrink-0 flex-col items-center self-stretch">
                  <div className="flex min-h-8 min-w-8 items-center justify-center">
                    <AgentIcon category="monitoring" seed={call.agentKey} size={26} />
                  </div>
                  {index < calls.length - 1 ? (
                    <div className="min-h-4 w-px flex-1 bg-line" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 pb-1">
                  <button
                    className="group/row flex items-center gap-1.5 text-left"
                    onClick={() => toggle(call.id)}
                    type="button"
                  >
                    <span className="text-xs font-medium text-ink group-hover/row:underline">
                      {failed
                        ? `Could not reach ${call.agentName}`
                        : isPending
                          ? `Asking ${call.agentName}…`
                          : `Asked ${call.agentName}`}
                    </span>
                    {call.latencyMs !== null ? (
                      <span className="text-[0.65rem] tabular-nums text-faint">
                        {call.latencyMs}ms
                      </span>
                    ) : null}
                    <Chevron open={isOpen} size={13} />
                  </button>

                  <p className="text-[0.68rem] capitalize text-faint">
                    {call.toolName.replace(/[_-]/g, " ")}
                    {call.isError && !failed ? " · the agent reported an error" : ""}
                  </p>

                  {isOpen ? (
                    <div className="mb-3 mt-2 w-full space-y-2.5 rounded-xl bg-paper-muted p-3 text-[0.68rem]">
                      <div className="flex flex-col">
                        <span className="mb-1 font-medium text-faint">Dolphin asked</span>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-muted">
                          {prettyJson(call.argumentsJson)}
                        </pre>
                      </div>

                      <div className="flex flex-col">
                        <span className="mb-1 font-medium text-faint">
                          {failed ? "Why it failed" : `${call.agentName} answered`}
                        </span>
                        {/*
                          Verbatim, and labelled as that agent's own words. An
                          agent's output is its CLAIM, never an established
                          outcome - a collectFees tool in this catalog once
                          answered `note: "Fees collected"` when nothing had
                          been collected.
                        */}
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-muted">
                          {call.transportError ??
                            call.resultText ??
                            (isPending ? "Still waiting…" : "No content returned.")}
                        </pre>
                      </div>

                      <Link
                        className="inline-block font-semibold text-accent-ink hover:underline"
                        href={`/agent/${encodeURIComponent(call.agentKey)}`}
                      >
                        View {call.agentName} →
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
