"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/app/dolphin/dolphin-chat.module.css";
import { AgentDraftPanel, EMPTY_AGENT_DRAFT } from "@/components/agent-draft-panel";
import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { DolphinLoader } from "@/components/dolphin-loader";
import { DolphinMessageContent } from "@/components/dolphin-message-content";
import { DolphinToolCalls } from "@/components/dolphin-tool-calls";
import {
    useDolphinChat,
    useDolphinConversation,
    type DolphinTurn,
} from "@/hooks/use-dolphin-conversation";
import { useAppStore, type ChatHistoryEntry } from "@/store/use-app-store";
import { useWallet } from "@/wallet/wallet-provider";

/** Matches the abbreviation SiteHeader uses, so one address reads the same everywhere. */
function shortWalletAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function historyTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

type ChatMode = "chat" | "build";

/*
 * THE EMPTY SCREEN IS THE MODE SWITCH AND ONE LINE. (2026-09-26)
 *
 * It used to carry a logo, a heading, a paragraph and four starter chips, and
 * Build mode copied the pattern. The owner's call: too much, for both modes.
 * A new visitor has one decision to make (ask, or build) and then one thing
 * to do (type), so the screen shows exactly that. The line says what to type
 * in the mode that is selected, and the composer's placeholder repeats it
 * where the typing happens.
 *
 * This deliberately reverses the 2026-09-12 starter prompts, which were added
 * because a blank box hid what Dolphin can answer. The one-line hint is what
 * is kept of that argument.
 */
const MODE_HINT: Readonly<Record<ChatMode, string>> = {
  chat: "Ask anything about the agents on BNB Chain.",
  build: "Describe the agent you want, and Dolphin builds it.",
};

/*
 * Build mode has its UI and not yet its backend. Sending is refused in
 * `submit` as well as disabled on the button, so no path (Enter, a starter
 * chip) can push a build request into the Q&A pipeline, where it would be
 * answered as a question about the marketplace instead of drafting an agent.
 * Flipped when convex/ gains the builder action.
 */
const BUILD_BACKEND_CONNECTED: boolean = false;

/**
 * Chat or Build, chosen on a NEW conversation only, the way Claude Code picks
 * a mode before the first prompt. Once a conversation has a turn in it, its mode
 * is fixed: a builder transcript and a Q&A transcript are different documents,
 * and switching halfway would leave one reading as the other.
 */
function ModeSwitch({
  mode,
  onChange,
  size = "sm",
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  size?: "sm" | "lg";
}) {
  return (
    <div
      aria-label="Conversation mode"
      className={`inline-flex items-center rounded-full border border-line/80 bg-paper-muted/70 ${
        size === "lg" ? "p-1" : "p-0.5"
      }`}
      role="radiogroup"
    >
      {(["chat", "build"] as const).map((option) => {
        const selected = option === mode;
        return (
          <button
            aria-checked={selected}
            className={`rounded-full font-semibold transition-colors ${
              size === "lg" ? "px-6 py-2 text-[15px]" : "px-3 py-1 text-[12px]"
            } ${
              selected ? "bg-ink text-canvas shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
            key={option}
            onClick={() => onChange(option)}
            role="radio"
            type="button"
          >
            <span className={selected ? "text-canvas" : undefined}>
              {option === "chat" ? "Chat" : "Build"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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

function HistoryGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path
        d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function Turn({
  turn,
  dynamicAgents,
  onSelectPrompt,
}: {
  turn: DolphinTurn;
  dynamicAgents?: Array<{ name: string; agentKey: string }>;
  onSelectPrompt?: (prompt: string) => void;
}) {
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
      <div className="min-w-0 max-w-[85%] flex-1 space-y-2">
        {working && turn.content.length === 0 && turn.toolCalls.length === 0 ? (
          <DolphinLoader
            label={turn.status === "thinking" ? "Thinking…" : "Consulting agents…"}
          />
        ) : null}

        {/*
          * AN ERROR MUST NOT LOOK LIKE AN ANSWER. (2026-09-12)
          *
          * Every error turn rendered in `bg-paper-muted` with the same radius
          * and type as a reply, so "Dolphin is out of free model calls" was
          * visually indistinguishable from Dolphin having said something - and
          * equally indistinguishable from a crash. Those are three different
          * facts and only one means the product is broken.
          *
          * `capacity` is the common one and it is NOT a fault: the free tier
          * is spent, the rest of the product is unaffected, and it resets on
          * its own. It gets the informational treatment and says so. Anything
          * else is a real failure and reads as one.
          */}
        {turn.status === "error" ? (
          turn.errorKind === "capacity" ? (
            <div className="rounded-2xl border border-info/25 bg-info-soft px-4 py-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-info">
                Out of model calls
              </p>
              <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft">
                {turn.errorReason}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-danger">
                {turn.errorKind === "provider"
                  ? "Model provider unavailable"
                  : turn.errorKind === "input"
                    ? "Could not process that"
                    : "Dolphin failed"}
              </p>
              <p className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-soft">
                {turn.errorReason ?? "Dolphin could not answer that."}
              </p>
            </div>
          )
        ) : null}

        {turn.content.length > 0 ? (
          <div className="overflow-hidden rounded-2xl rounded-bl-md bg-paper-muted px-4 py-3 text-[0.92rem] leading-[1.7] text-ink">
            <DolphinMessageContent
              content={turn.content}
              dynamicAgents={dynamicAgents}
              onSelectPrompt={onSelectPrompt}
              toolCalls={turn.toolCalls}
            />
          </div>
        ) : null}

        {working && turn.content.length === 0 && turn.toolCalls.length > 0 ? (
          <DolphinLoader label="Writing…" />
        ) : null}

        <DolphinToolCalls calls={turn.toolCalls} />

        {/*
          * A REUSED ANSWER SHOWS WHEN IT WAS WRITTEN, not when it was served.
          *
          * Dolphin reuses a previous answer to an identical question rather
          * than spending a free-tier model call on it (convex/dolphin.ts,
          * reusableAnswer). Only tool-free explanations are eligible, so this
          * never restates a live reading as current - but the timestamp still
          * has to be the original one, which is what the schema note on
          * `reusedFrom` requires.
          */}
        {turn.status === "complete" && turn.reusedFrom !== null ? (
          <p className="pl-1 text-[0.68rem] text-faint">
            Answered {relativeTime(turn.reusedFrom)} · reused for an identical
            question
          </p>
        ) : turn.status === "complete" && turn.completedAt !== null ? (
          <p className="pl-1 text-[0.68rem] text-faint">
            {relativeTime(turn.completedAt)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChatHistory({
  activeKey,
  entries,
  onClear,
  onClose,
  onNew,
  onOpen,
  onRemove,
}: {
  activeKey: string | null;
  entries: ChatHistoryEntry[];
  onClear: () => void;
  onClose?: () => void;
  onNew: () => void;
  onOpen: (conversationKey: string) => void;
  onRemove: (conversationKey: string) => void;
}) {
  return (
    <aside
      aria-label="Chat history"
      className="flex h-full min-h-0 flex-col border-l border-line/80 bg-paper/78 px-3 pb-4 pt-3 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="grid size-9 place-items-center rounded-xl bg-ink text-canvas">
          <CategoryGlyph color="#FFFFFF" name="panel-left" size={17} strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Chat history</h2>
          <p className="text-[0.68rem] text-muted">Saved on this device</p>
        </div>
        {onClose ? (
          <button
            aria-label="Close chat history"
            className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-paper-muted"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        ) : null}
      </div>

      <button
        className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-canvas transition-transform hover:-translate-y-0.5 active:translate-y-0"
        onClick={onNew}
        type="button"
      >
        <CategoryGlyph color="#FFFFFF" name="add" size={18} strokeWidth={2} />
        <span className="text-canvas">New conversation</span>
      </button>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper/55 px-4 py-5">
            <p className="text-sm font-medium text-ink-soft">No saved chats yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Your first question will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => {
              const active = entry.conversationKey === activeKey;
              return (
                <div
                  className={`group flex items-center gap-1 rounded-2xl p-1 transition-colors ${
                    active ? "bg-success-soft ring-1 ring-success/30" : "hover:bg-paper-muted/80"
                  }`}
                  key={entry.conversationKey}
                >
                  <button
                    className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left"
                    onClick={() => onOpen(entry.conversationKey)}
                    type="button"
                  >
                    <span className="block truncate text-[0.82rem] font-medium text-ink">
                      {entry.title}
                    </span>
                    <span className="mt-0.5 block text-[0.66rem] text-muted">
                      {historyTime(entry.updatedAt)}
                    </span>
                  </button>
                  <button
                    aria-label={`Remove ${entry.title} from history`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-faint opacity-70 transition-colors hover:bg-paper hover:text-ink group-hover:opacity-100"
                    onClick={() => onRemove(entry.conversationKey)}
                    type="button"
                  >
                    <span aria-hidden>×</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {entries.length > 0 ? (
        <button
          className="mt-3 self-start px-2 py-2 text-xs font-medium text-muted hover:text-ink"
          onClick={onClear}
          type="button"
        >
          Clear local history
        </button>
      ) : null}
    </aside>
  );
}

export function DolphinClient({
  seedAgentKey,
  seedAgentName,
  autoAsk,
}: {
  seedAgentKey: string | null;
  seedAgentName?: string | null;
  autoAsk?: boolean;
}) {
  const [draft, setDraft] = useState(() =>
    !autoAsk && seedAgentName
      ? `Tell me about ${seedAgentName.trim()} — what strategy does it run?`
      : "",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");
  const wallet = useWallet();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoAskedRef = useRef(false);

  const { conversationKey, send, reset, openConversation, isSending, sendError } =
    useDolphinChat(seedAgentKey);
  const { exists, isLoading, title, turns, agentDirectory } =
    useDolphinConversation(conversationKey);
  const history = useAppStore((state) => state.chatHistory);
  const upsertHistory = useAppStore((state) => state.upsertChatHistory);
  const removeHistory = useAppStore((state) => state.removeChatHistory);
  const clearHistory = useAppStore((state) => state.clearChatHistory);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (!conversationKey || turns.length === 0) return;
    const firstQuestion = turns.find((turn) => turn.role === "user")?.content.trim();
    const newestTurn = turns[turns.length - 1];
    upsertHistory({
      conversationKey,
      title: title && title !== "New conversation" ? title : firstQuestion || "New conversation",
      updatedAt: newestTurn.completedAt ?? newestTurn.createdAt,
    });
  }, [conversationKey, title, turns, upsertHistory]);

  const submit = useCallback(
    (text: string) => {
      if (text.trim().length === 0 || isSending) return;
      if (mode === "build" && !BUILD_BACKEND_CONNECTED) return;
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void send(text);
    },
    [isSending, mode, send],
  );

  useEffect(() => {
    if (!seedAgentKey || hasAutoAskedRef.current) return;
    if (autoAsk) {
      hasAutoAskedRef.current = true;
      const agentDisplayName = seedAgentName ? seedAgentName.trim() : "this agent";
      const prompt = `Can you analyze ${agentDisplayName}? What strategy does it run, what are its live on-chain metrics, and is it safe to use?`;
      const timer = setTimeout(() => {
        void submit(prompt);
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [seedAgentKey, seedAgentName, autoAsk, submit]);


  const startNew = useCallback(() => {
    reset();
    setDraft("");
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }, [reset]);

  const openSavedConversation = useCallback(
    (conversationKeyToOpen: string) => {
      openConversation(conversationKeyToOpen);
      setDraft("");
      setHistoryOpen(false);
    },
    [openConversation],
  );

  const removeSavedConversation = useCallback(
    (conversationKeyToRemove: string) => {
      removeHistory(conversationKeyToRemove);
      if (conversationKeyToRemove === conversationKey) reset();
    },
    [conversationKey, removeHistory, reset],
  );

  const isEmpty = turns.length === 0;
  const building = mode === "build";
  // The mode is chosen on a new conversation and fixed once it has a turn.
  const canSwitchMode = isEmpty && !conversationKey;
  const sendBlocked = building && !BUILD_BACKEND_CONNECTED;

  return (
    <div
      className={`dolphin-chat-page relative grid h-[100dvh] overflow-hidden ${
        building ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "lg:grid-cols-[minmax(0,1fr)_19rem]"
      } ${styles.shell}`}
    >
      <div aria-hidden className={styles.grid} />

      <section className="relative z-10 flex min-h-0 min-w-0 flex-col">
        <header className="relative flex min-h-16 items-center justify-between gap-2.5 border-b border-line/65 bg-paper/45 px-4 backdrop-blur-sm">
          <Link
            aria-label="Back to Discover"
            className="grid size-10 place-items-center rounded-full text-ink no-underline transition-colors hover:bg-paper/80"
            href="/"
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

          <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
            <BrandMark size={20} />
            <span className="text-sm font-semibold text-ink">Dolphin</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/*
              * CONNECT, ON THE ONE ROUTE THAT HID IT. (2026-09-12)
              *
              * app-frame.tsx suppresses SiteHeader here, and SiteHeader is
              * where the connect button lives - so the chat was the only
              * surface in the product with no way to connect a wallet. That
              * mattered in two concrete ways:
              *
              *  - SYSTEM_PROMPT rule 13 instructs the model, verbatim, to
              *    "invite them to click 'Connect' in the top bar". The control
              *    it names did not exist on this route, so following the
              *    instruction sent the user looking for a button that was not
              *    there.
              *  - One of the starter prompts is "What is my Venus health
              *    factor?", which cannot be answered without an address.
              *
              * Rendered as a compact pill rather than the full header control:
              * this header is a chat toolbar, not site chrome, and the address
              * links to /wallet the same way SiteHeader's does.
              */}
            {wallet.isConnected && wallet.address ? (
              <Link
                className="hidden items-center gap-1.5 rounded-full border border-line/80 bg-paper/75 px-3 py-1.5 text-[12px] font-semibold text-ink-soft no-underline transition-colors hover:bg-paper sm:inline-flex"
                href="/wallet"
                title={wallet.address}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                <span className="font-mono">{shortWalletAddress(wallet.address)}</span>
              </Link>
            ) : (
              <button
                aria-busy={wallet.isConnecting}
                className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                disabled={wallet.isConnecting}
                onClick={() => void wallet.connect()}
                type="button"
              >
                {wallet.isConnecting ? "Connecting…" : "Connect"}
              </button>
            )}
            {/*
              * In Build mode the draft takes the desktop side column, so
              * history moves behind this button on every width.
              */}
            <button
              aria-label="Open chat history"
              className={`grid size-10 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper/80 ${
                building ? "" : "lg:hidden"
              }`}
              onClick={() => setHistoryOpen(true)}
              type="button"
            >
              <HistoryGlyph />
            </button>
            {!isEmpty ? (
              <button
                className="rounded-full px-3 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-paper/80 hover:text-ink"
                onClick={startNew}
                type="button"
              >
                New
              </button>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[46rem] px-5 pb-8 pt-8">
            {conversationKey && isLoading ? (
              <div className="flex justify-center pt-[18vh]">
                <DolphinLoader label="Loading conversation…" />
              </div>
            ) : conversationKey && !exists ? (
              <div className="flex flex-col items-center gap-2 pt-[18vh] text-center">
                <h1 className="text-base font-semibold text-ink">
                  Conversation unavailable
                </h1>
                <p className="max-w-sm text-sm text-muted">
                  This locally saved chat can no longer be opened.
                </p>
              </div>
            ) : isEmpty ? (
              <div className="dolphin-empty-hero flex flex-col items-center pt-[30vh]">
                <h1 className="sr-only">
                  {building ? "Build an agent" : "Ask the marketplace"}
                </h1>
                <ModeSwitch mode={mode} onChange={setMode} size="lg" />
                <p className="mt-4 text-center text-sm text-muted">{MODE_HINT[mode]}</p>
              </div>
            ) : (
              <div>
                {turns.map((turn) => (
                  <Turn
                    dynamicAgents={agentDirectory}
                    key={turn.id}
                    onSelectPrompt={(prompt) => submit(prompt)}
                    turn={turn}
                  />
                ))}
              </div>
            )}

            {sendError ? (
              <p className="mt-4 text-[0.85rem] text-ink">{sendError}</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="dolphin-composer-wrapper relative z-10 bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)]/95 to-transparent">
          <form
            className="mx-auto w-full max-w-[46rem] px-4 pb-5 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            <div className="flex w-full flex-col rounded-[1.65rem] border border-line/90 bg-paper/88 p-2 shadow-[0_12px_38px_rgba(15,23,42,0.11)] backdrop-blur-xl">
              <textarea
                aria-label={building ? "Describe the agent to build" : "Message Dolphin"}
                className="max-h-[400px] min-h-0 w-full resize-none overflow-x-hidden bg-transparent px-2.5 py-2 text-[0.94rem] leading-relaxed text-ink outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-faint"
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
                placeholder={
                  building
                    ? "Describe the agent you want to build…"
                    : "Ask about an agent, a position, or a yield…"
                }
                ref={textareaRef}
                rows={1}
                value={draft}
              />
              <div className="flex items-center justify-between gap-2 pl-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {/*
                    * The switch itself lives in the empty screen. Once a
                    * conversation has started, this label is the only reminder
                    * of which mode it is in.
                    */}
                  {canSwitchMode ? null : (
                    <span className="px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {building ? "Build" : "Chat"}
                    </span>
                  )}
                  {/*
                    * The draft's door on narrow screens. It lives here rather
                    * than in the header because the header already holds back,
                    * title, Connect and history, and a fourth control pushed
                    * Connect into the centred title at 390px.
                    */}
                  {building ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-full border border-line/80 px-2.5 py-1 text-[12px] font-semibold text-ink-soft transition-colors hover:bg-paper-muted hover:text-ink lg:hidden"
                      onClick={() => setDraftOpen(true)}
                      type="button"
                    >
                      <CategoryGlyph name="bot" size={14} strokeWidth={1.9} />
                      Draft
                    </button>
                  ) : null}
                </div>
              <button
                aria-label="Send"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-[opacity,transform] hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-30"
                disabled={draft.trim().length === 0 || isSending || sendBlocked}
                type="submit"
              >
                <svg
                  aria-hidden
                  className="text-canvas"
                  fill="none"
                  height="15"
                  viewBox="0 0 24 24"
                  width="15"
                >
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
            {sendBlocked ? (
              <p className="mt-2 px-3 text-center text-[0.72rem] text-muted">
                The builder is not connected yet, so nothing is sent. Switch to Chat to
                ask the marketplace a question.
              </p>
            ) : null}
          </form>
        </div>
      </section>

      <div className="relative z-20 hidden min-h-0 lg:block">
        {building ? (
          <AgentDraftPanel draft={EMPTY_AGENT_DRAFT} />
        ) : (
          <ChatHistory
            activeKey={conversationKey}
            entries={history}
            onClear={clearHistory}
            onNew={startNew}
            onOpen={openSavedConversation}
            onRemove={removeSavedConversation}
          />
        )}
      </div>

      {draftOpen && building ? (
        <div className="fixed inset-0 z-30 flex justify-end lg:hidden">
          <button
            aria-label="Close agent draft"
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
            onClick={() => setDraftOpen(false)}
            type="button"
          />
          <div className="relative h-full w-[min(88vw,22rem)] shadow-[-18px_0_50px_rgba(15,23,42,0.16)]">
            <AgentDraftPanel draft={EMPTY_AGENT_DRAFT} onClose={() => setDraftOpen(false)} />
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className={`fixed inset-0 z-30 flex justify-end ${building ? "" : "lg:hidden"}`}>
          <button
            aria-label="Close chat history"
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
            onClick={() => setHistoryOpen(false)}
            type="button"
          />
          <div className="relative h-full w-[min(88vw,20rem)] shadow-[-18px_0_50px_rgba(15,23,42,0.16)]">
            <ChatHistory
              activeKey={conversationKey}
              entries={history}
              onClear={clearHistory}
              onClose={() => setHistoryOpen(false)}
              onNew={startNew}
              onOpen={openSavedConversation}
              onRemove={removeSavedConversation}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
