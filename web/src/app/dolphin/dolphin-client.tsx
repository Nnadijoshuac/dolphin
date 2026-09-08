"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import {
  useDolphinChat,
  useDolphinConversation,
  type DolphinToolCall,
  type DolphinTurn,
} from "@/hooks/use-dolphin-conversation";

/**
 * DOLPHIN on the web.
 *
 * See Agent/DOLPHIN-AGENT-SCOPE.md for what this is. The interface deliberately
 * copies the shape of a familiar AI chat - centred column, unbubbled assistant
 * turns, composer pinned at the bottom - so nobody has to learn anything to use
 * it.
 *
 * What is NOT generic is the citation block under each answer. That is the
 * product.
 */

/**
 * The empty state has to TEACH.
 *
 * project-scope.md §11 requires that someone who has never heard of BNB Agent
 * Studio can use this, and a blank chat box is a dead end for that person.
 *
 * These are also the prompts to pre-run before a demo, so the obvious path is
 * the cached one and costs no free-tier model calls. Change them and that
 * caching goes with them.
 */
const SUGGESTIONS = [
  {
    title: "Find yield",
    prompt: "What yield opportunities are on BNB Chain right now?",
  },
  {
    title: "Watch a position",
    prompt: "Which agents can watch a lending position for me?",
  },
  {
    title: "Compare agents",
    prompt: "Which agents here can analyse a liquidity pool, and how do they differ?",
  },
  {
    title: "Understand the market",
    prompt: "What can the agents in this marketplace actually do?",
  },
];

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * One consulted agent.
 *
 * Comes from `dolphinToolCalls`, which the action writes before and after each
 * call - not from anything the model said about its own sources. If the answer
 * text and these rows disagree, these rows are right.
 */
function Citation({ call }: { call: DolphinToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const pending = call.latencyMs === null;
  const failed = call.transportError !== null;

  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        failed ? "border-line bg-paper-muted" : "border-line bg-paper-strong"
      }`}
    >
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-paper-muted"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            pending ? "animate-pulse bg-accent" : failed ? "bg-faint-mark" : "bg-accent"
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">
          <span className="font-semibold">
            {pending ? "Consulting" : failed ? "Could not reach" : "Consulted"}{" "}
            {call.agentName}
          </span>
          <span className="text-faint"> · {call.toolName}</span>
        </span>
        {call.latencyMs !== null ? (
          <span className="shrink-0 text-[0.7rem] tabular-nums text-faint">
            {call.latencyMs}ms
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-faint">
            {failed ? "Why it failed" : `What ${call.agentName} returned`}
          </p>
          {/*
            Verbatim, and labelled as the agent's own words. An agent's output is
            its CLAIM, never an established outcome - a collectFees tool in this
            catalog once answered `note: "Fees collected"` when nothing had been
            collected.
          */}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-muted p-3 text-[0.7rem] leading-relaxed text-muted">
            {call.transportError ?? call.resultText ?? "No content returned."}
          </pre>
          <Link
            className="inline-block text-[0.75rem] font-semibold text-accent-ink hover:underline"
            href={`/agent/${encodeURIComponent(call.agentKey)}`}
          >
            View {call.agentName} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Turn({ turn }: { turn: DolphinTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-paper-muted px-4 py-2.5 text-[0.95rem] leading-relaxed text-ink">
          {turn.content}
        </div>
      </div>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <div className="space-y-3">
      {working ? (
        <p className="flex items-center gap-2 text-[0.85rem] text-muted">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {turn.status === "thinking"
            ? "Choosing which agents to ask…"
            : "Consulting agents…"}
        </p>
      ) : null}

      {/* Citations first while working, so progress is the visible thing. */}
      {turn.toolCalls.length > 0 ? (
        <div className="space-y-1.5">
          {turn.toolCalls.map((call) => (
            <Citation call={call} key={call.id} />
          ))}
        </div>
      ) : null}

      {turn.status === "error" ? (
        <p className="rounded-lg border border-line bg-paper-muted px-4 py-3 text-[0.9rem] leading-relaxed text-ink">
          {turn.errorReason ?? "Dolphin could not answer that."}
        </p>
      ) : null}

      {turn.content.length > 0 ? (
        <div className="whitespace-pre-wrap text-[0.95rem] leading-[1.7] text-ink">
          {turn.content}
        </div>
      ) : null}

      {/*
        WHEN the answer was produced, always shown. A reused answer keeps its
        ORIGINAL completedAt, so a cached reply must not read as fresh: live
        metrics restated as current when they were read an hour ago is the
        fabricated-liveness failure of AGENTS.md §5 wearing a cache as a
        disguise.
      */}
      {turn.status === "complete" && turn.completedAt !== null ? (
        <p className="text-[0.7rem] text-faint">
          Answered {relativeTime(turn.completedAt)}
          {turn.model ? ` · ${turn.model.split("/").pop()?.replace(":free", "")}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function DolphinClient() {
  const params = useSearchParams();
  const seedAgentKey = params.get("agent");

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { conversationKey, send, reset, isSending, sendError } =
    useDolphinChat(seedAgentKey);
  const { turns } = useDolphinConversation(conversationKey);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const submit = useCallback(
    (text: string) => {
      if (text.trim().length === 0 || isSending) return;
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void send(text);
    },
    [isSending, send],
  );

  const isEmpty = turns.length === 0;

  return (
    <div className="flex h-[calc(100dvh-var(--header-height,4rem))] flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-5 pb-8 pt-10">
          {isEmpty ? (
            <div className="pt-[8vh]">
              <div className="mb-7 flex items-center gap-3">
                <BrandMark size={30} />
                <h1 className="text-[1.65rem] font-semibold tracking-tight text-ink">
                  Ask the marketplace
                </h1>
              </div>
              <p className="mb-9 max-w-[34rem] text-[0.95rem] leading-relaxed text-muted">
                Dolphin answers by calling the agents listed here and showing you
                which ones it asked. It never makes a number up — if the agents it
                can reach do not know, it says so.
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    className="group rounded-xl border border-line bg-paper-strong p-4 text-left transition-colors hover:border-line-strong hover:bg-paper-muted"
                    key={suggestion.title}
                    onClick={() => submit(suggestion.prompt)}
                    type="button"
                  >
                    <span className="block text-[0.8rem] font-semibold text-ink">
                      {suggestion.title}
                    </span>
                    <span className="mt-1 block text-[0.8rem] leading-snug text-muted">
                      {suggestion.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {turns.map((turn) => (
                <Turn key={turn.id} turn={turn} />
              ))}
            </div>
          )}

          {/*
            Only reached when the ACTION itself failed - a dropped connection.
            Failures inside a turn render in the transcript, where the question
            was asked.
          */}
          {sendError ? (
            <p className="mt-6 text-[0.85rem] text-ink">{sendError}</p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-paper">
        <div className="mx-auto w-full max-w-[46rem] px-5 py-4">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-paper-strong px-3 py-2.5 focus-within:border-line-strong">
            <textarea
              className="max-h-48 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-[0.95rem] leading-relaxed text-ink outline-none placeholder:text-faint-mark"
              onChange={(event) => {
                setDraft(event.target.value);
                // Grow with the content, the way a chat composer should.
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 192)}px`;
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter makes a newline - the convention
                // every chat interface shares.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              placeholder="Ask about an agent, a position, a yield…"
              ref={textareaRef}
              rows={1}
              value={draft}
            />
            <button
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-ink transition-opacity disabled:opacity-35"
              disabled={draft.trim().length === 0 || isSending}
              onClick={() => submit(draft)}
              type="button"
            >
              <svg aria-hidden fill="none" height="15" viewBox="0 0 24 24" width="15">
                <path
                  d="M12 19V5M12 5l-6 6M12 5l6 6"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.4"
                />
              </svg>
            </button>
          </div>

          <p className="mt-2 text-center text-[0.7rem] text-faint">
            {isEmpty && !isSending ? (
              <>Dolphin calls real agents on BNB Chain. Answers cite what it asked.</>
            ) : !isSending ? (
              <button
                className="hover:underline"
                onClick={() => {
                  reset();
                  setDraft("");
                }}
                type="button"
              >
                Start a new conversation
              </button>
            ) : (
              <>Consulting agents — this can take up to a minute.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
