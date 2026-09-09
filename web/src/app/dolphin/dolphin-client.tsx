"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Wallet profile icon — same glyph used in the tab bar */
function UserAvatar() {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-muted ring-1 ring-line">
      <svg aria-hidden fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path
          d="M17 20.5H7c-3 0-5-2-5-5v-7c0-3 2-5 5-5h10c3 0 5 2 5 5v7c0 3-2 5-5 5Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M2 13h3.76c.78 0 1.49.44 1.84 1.14l.75 1.52c.5 1 1.41 1.34 1.91 1.34h3.48c.5 0 1.41-.34 1.91-1.34l.75-1.52c.35-.7 1.06-1.14 1.84-1.14H22"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft ring-1 ring-line">
      <BrandMark size={17} />
    </div>
  );
}

/**
 * Linkify agent names in the response text.
 *
 * Takes the raw text from the model and the tool calls that produced it, then
 * replaces every occurrence of a consulted agent's name with a clickable link
 * to its marketplace page. The model frequently mentions the agents it called
 * by name, and making those names tappable is what turns a chat into a
 * discovery surface.
 */
function LinkifiedContent({
  text,
  toolCalls,
}: {
  text: string;
  toolCalls: DolphinTurn["toolCalls"];
}) {
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const call of toolCalls) {
      if (call.agentName && call.agentKey && !map.has(call.agentName)) {
        map.set(call.agentName, call.agentKey);
      }
    }
    return map;
  }, [toolCalls]);

  if (agentMap.size === 0) {
    return <>{text}</>;
  }

  // Build a regex that matches any agent name (longest first to avoid partial matches)
  const names = Array.from(agentMap.keys()).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${names.map(escapeRegex).join("|")})`, "g");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) => {
        const agentKey = agentMap.get(part);
        if (agentKey) {
          return (
            <Link
              className="font-semibold text-accent-ink underline decoration-accent-ink/30 underline-offset-2 hover:decoration-accent-ink"
              href={`/agent/${encodeURIComponent(agentKey)}`}
              key={i}
            >
              {part}
            </Link>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Turn({ turn }: { turn: DolphinTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex w-full items-end justify-end gap-2 py-3">
        <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[0.92rem] leading-relaxed text-ink">
          {turn.content}
        </div>
        <UserAvatar />
      </div>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <div className="flex w-full items-start gap-2 py-3">
      <AssistantAvatar />

      <div className="min-w-0 max-w-[85%] flex-1 space-y-2">
        {/* Loading state — the 3D motion rings */}
        {working && turn.content.length === 0 && turn.toolCalls.length === 0 ? (
          <DolphinLoader
            label={
              turn.status === "thinking"
                ? "Thinking…"
                : "Consulting agents…"
            }
          />
        ) : null}

        {/* The answer bubble — shown as soon as content arrives */}
        {turn.status === "error" ? (
          <div className="rounded-2xl rounded-bl-md bg-paper-muted px-4 py-3 text-[0.92rem] leading-relaxed text-ink">
            {turn.errorReason ?? "Dolphin could not answer that."}
          </div>
        ) : null}

        {turn.content.length > 0 ? (
          <div className="overflow-hidden whitespace-pre-wrap rounded-2xl rounded-bl-md bg-paper-muted px-4 py-3 text-[0.92rem] leading-[1.7] text-ink">
            <LinkifiedContent text={turn.content} toolCalls={turn.toolCalls} />
          </div>
        ) : null}

        {/* Working indicator while content streams */}
        {working && turn.content.length === 0 && turn.toolCalls.length > 0 ? (
          <DolphinLoader label="Writing…" />
        ) : null}

        {/* Consulted agents — BELOW the response bubble */}
        <DolphinToolCalls calls={turn.toolCalls} />

        {turn.status === "complete" && turn.completedAt !== null ? (
          <p className="pl-1 text-[0.68rem] text-faint">
            {relativeTime(turn.completedAt)}
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
    <div className="relative flex h-[calc(100dvh-4rem)] flex-col dolphin-chat-page">
      {/* Mobile top bar — chevron back + New conversation */}
      <div className="mobile-only flex items-center justify-between gap-2.5 px-4 pb-2 pt-3">
        <Link
          href="/"
          aria-label="Back to Discover"
          className="grid size-10 place-items-center rounded-full text-ink no-underline hover:bg-paper-muted transition-colors"
        >
          <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
            <path
              d="M15 19l-7-7 7-7"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.2"
            />
          </svg>
        </Link>
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
        <div className="mx-auto w-full max-w-[46rem] px-5 pb-36 pt-8">
          {isEmpty ? (
            <div className="dolphin-empty-hero flex flex-col items-center pt-[18vh]">
              <BrandMark size={48} />
              <h1 className="mt-4 text-[1.6rem] font-semibold tracking-tight text-ink text-center">
                Ask the marketplace
              </h1>
            </div>
          ) : (
            <div>
              {turns.map((turn) => (
                <Turn key={turn.id} turn={turn} />
              ))}
            </div>
          )}

          {sendError ? (
            <p className="mt-4 text-[0.85rem] text-ink">{sendError}</p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* THE COMPOSER ISLAND */}
      <div className="dolphin-composer-wrapper pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto w-full max-w-[46rem] px-4 pb-5 pt-2">
          <div className="pointer-events-auto flex w-full flex-col items-end rounded-3xl border border-line bg-paper-strong/90 p-2 shadow-[0_8px_28px_rgba(17,18,20,0.12)] backdrop-blur-xl transition-shadow focus-within:border-line-strong focus-within:shadow-[0_10px_34px_rgba(17,18,20,0.17)]">
            <textarea
              className="max-h-[400px] min-h-0 w-full resize-none overflow-x-hidden bg-transparent px-2 py-1.5 text-[0.92rem] leading-relaxed text-ink outline-none placeholder:text-faint-mark"
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 400)}px`;
              }}
              onKeyDown={(event) => {
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
        </div>
      </div>
    </div>
  );
}
