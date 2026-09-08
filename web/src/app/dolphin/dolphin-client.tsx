"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { DolphinLoader } from "@/components/dolphin-loader";
import { DolphinToolCalls } from "@/components/dolphin-tool-calls";
import {
  useDolphinChat,
  useDolphinConversation,
  type DolphinTurn,
} from "@/hooks/use-dolphin-conversation";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * DOLPHIN on the web.
 *
 * See Agent/DOLPHIN-AGENT-SCOPE.md for what this is. The chat shell is
 * deliberately conventional - two-tone bubbles, avatars, a rounded composer,
 * Enter to send - so nobody has to learn anything. The part that is not
 * conventional is components/dolphin-tool-calls.tsx, which is the product.
 *
 * `seedAgentKey` arrives as a PROP from the server page rather than being read
 * here with `useSearchParams`. That is not a style preference: a component
 * calling `useSearchParams` must sit under a Suspense boundary, and with the
 * whole screen inside one the prerender emitted an empty body - verified by
 * serving the build and finding a 200 with a correct <title> and no content at
 * all. Reading the param on the server keeps the HTML complete.
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

function Avatar({ kind, initials }: { kind: "user" | "assistant"; initials: string }) {
  if (kind === "assistant") {
    return (
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft ring-1 ring-line">
        <BrandMark size={17} />
      </div>
    );
  }
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-muted text-[0.65rem] font-semibold uppercase text-muted ring-1 ring-line">
      {initials}
    </div>
  );
}

function Turn({ turn, initials }: { turn: DolphinTurn; initials: string }) {
  if (turn.role === "user") {
    return (
      <div className="flex w-full items-end justify-end gap-2 py-3">
        <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[0.92rem] leading-relaxed text-ink">
          {turn.content}
        </div>
        <Avatar initials={initials} kind="user" />
      </div>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <div className="flex w-full items-start gap-2 py-3">
      <Avatar initials="AI" kind="assistant" />

      <div className="min-w-0 max-w-[85%] flex-1 space-y-2">
        {/*
          Progress and provenance sit ABOVE the answer, in the order they
          happened: Dolphin picks who to ask, asks them, then writes. Watching
          the consulted-agent rows land one by one is the demo.
        */}
        {working && turn.toolCalls.length === 0 ? (
          <DolphinLoader
            label={
              turn.status === "thinking"
                ? "Choosing which agents to ask…"
                : "Consulting agents…"
            }
          />
        ) : null}

        <DolphinToolCalls calls={turn.toolCalls} />

        {turn.status === "error" ? (
          <div className="rounded-2xl rounded-bl-md bg-paper-muted px-4 py-3 text-[0.92rem] leading-relaxed text-ink">
            {turn.errorReason ?? "Dolphin could not answer that."}
          </div>
        ) : null}

        {turn.content.length > 0 ? (
          <div className="overflow-hidden whitespace-pre-wrap rounded-2xl rounded-bl-md bg-paper-muted px-4 py-3 text-[0.92rem] leading-[1.7] text-ink">
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
          <p className="pl-1 text-[0.68rem] text-faint">
            Answered {relativeTime(turn.completedAt)}
            {turn.model ? ` · ${turn.model.split("/").pop()?.replace(":free", "")}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DolphinClient({ seedAgentKey }: { seedAgentKey: string | null }) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { conversationKey, send, reset, isSending, sendError } =
    useDolphinChat(seedAgentKey);
  const { turns } = useDolphinConversation(conversationKey);
  const wallet = useWallet();

  const initials = wallet.address ? wallet.address.slice(2, 4) : "You";

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
    <div className="relative flex h-[calc(100dvh-4rem)] flex-col">
      {/* Mobile top bar matching src/app/(tabs)/dolphin.tsx */}
      <div className="mobile-only flex items-center justify-between gap-2.5 px-5 pb-3 pt-2">
        <div className="flex items-center gap-2.5">
          <BrandMark size={24} />
          <h1 className="text-[20px] font-extrabold text-ink">Dolphin</h1>
        </div>
        {!isEmpty ? (
          <button
            className="text-[13px] font-bold text-accent-ink hover:underline"
            onClick={() => {
              reset();
              setDraft("");
            }}
            type="button"
          >
            New
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/*
          `pb-36` is the composer island's landing space. The island is
          positioned over this scroll area rather than beside it, so without
          that padding the last turn ends up underneath it and unreadable.
        */}
        <div className="mx-auto w-full max-w-[46rem] px-5 pb-36 pt-8">
          {isEmpty ? (
            <div className="pt-[6vh]">
              <div className="mb-6 flex items-center gap-3">
                <BrandMark size={30} />
                <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">
                  Ask the marketplace
                </h1>
              </div>
              <p className="mb-8 max-w-[34rem] text-[0.92rem] leading-relaxed text-muted">
                Dolphin answers by calling the agents listed here and showing you
                which ones it asked, what it asked them, and what each one said
                back. It never makes a number up — if the agents it can reach do
                not know, it says so.
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    className="rounded-xl border border-line bg-paper-strong p-4 text-left transition-colors hover:border-line-strong hover:bg-paper-muted"
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
            <div>
              {turns.map((turn) => (
                <Turn initials={initials} key={turn.id} turn={turn} />
              ))}
            </div>
          )}

          {/*
            Only reached when the ACTION itself failed - a dropped connection.
            Failures inside a turn render in the transcript, where the question
            was asked.
          */}
          {sendError ? (
            <p className="mt-4 text-[0.85rem] text-ink">{sendError}</p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {/*
        THE COMPOSER IS AN ISLAND.
        ---------------------------------------------------------------------
        Same object language as the app's floating tab bar: a capsule that sits
        clear of the edges with a soft shadow under it, rather than a bar welded
        to the bottom of the viewport by a full-bleed border.

        `pointer-events-none` on the wrapper with `pointer-events-auto` on the
        island itself is what lets the transcript keep scrolling in the gutter
        either side of it - an island floating over content should not capture
        clicks in the water around it.
      */}
      <div className="dolphin-composer-wrapper pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto w-full max-w-[46rem] px-4 pb-5 pt-2">
          <div className="pointer-events-auto flex w-full flex-col items-end rounded-3xl border border-line bg-paper-strong/90 p-2 shadow-[0_8px_28px_rgba(17,18,20,0.12)] backdrop-blur-xl transition-shadow focus-within:border-line-strong focus-within:shadow-[0_10px_34px_rgba(17,18,20,0.17)]">
            <textarea
              className="max-h-[400px] min-h-0 w-full resize-none overflow-x-hidden bg-transparent px-2 py-1.5 text-[0.92rem] leading-relaxed text-ink outline-none placeholder:text-faint-mark"
              onChange={(event) => {
                setDraft(event.target.value);
                // Grow with the content, the way a chat composer should.
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 400)}px`;
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter makes a newline - the convention
                // every chat interface shares.
                if (event.key === "Enter" && !event.shiftKey) {
                  if (draft.trim().length === 0) return;
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
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-40"
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
                  strokeWidth="2.5"
                />
              </svg>
            </button>
          </div>

          <p className="pointer-events-auto mt-2 text-center text-[0.68rem] text-faint">
            {isSending ? (
              <>Consulting agents — this can take up to a minute.</>
            ) : isEmpty ? (
              <>Dolphin calls real agents on BNB Chain. Every answer cites what it asked.</>
            ) : (
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
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
