"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/dolphin/dolphin-chat.module.css";
import { AgentDraftPanel, EMPTY_AGENT_DRAFT } from "@/components/agent-draft-panel";
import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { DolphinLoader } from "@/components/dolphin-loader";
import { DolphinMessageContent } from "@/components/dolphin-message-content";
import { DolphinToolCalls } from "@/components/dolphin-tool-calls";
import { PublishAgentDialog } from "@/components/publish-agent-dialog";
import { TradeTicket } from "@/components/trade-ticket";
import { builtAgentsApi } from "@/convex/api";
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
 * THE EMPTY SCREEN (owner's direction, 2026-09-26): the mode switch, one line,
 * the composer, and small suggestions under it, the way Claude lays out its
 * own. The logo, paragraph and large chips that were here were too much for
 * both modes. The suggestions stay, because a blank box hides what Dolphin
 * can answer, but they are quiet pills rather than a menu.
 */
const MODE_HINT: Readonly<Record<ChatMode, string>> = {
  chat: "What do you want to know?",
  build: "What should your agent do?",
};

/**
 * Chat suggestions. Every entry must be answerable by something actually
 * wired, so a first impression is a real answer rather than an apology:
 * execution capability comes from published tool lists
 * (convex/lib/toolCapability.ts), the health factor is a live Venus read,
 * comparing yield agents is catalog work, and the probe is the one question
 * Dolphin can always answer about itself. Nothing about grid or trading
 * performance: those categories return unavailableStats by construction.
 */
const STARTER_PROMPTS = [
  "Which agents can execute a transaction?",
  "What is my Venus health factor?",
  "Compare the yield agents",
  "How does Dolphin decide an agent is live?",
];

/**
 * Build suggestions. Each describes an agent whose tools can come from the
 * read-only MCP agents already listed, so none asks for something the builder
 * would have to refuse.
 */
const BUILD_STARTERS = [
  /*
   * "Check", not "Watch": a built agent answers when asked and cannot watch
   * anything in the background, and the builder says so if asked.
   */
  "Check my Venus health factor",
  "Compare yields on BNB Chain",
  "Explain a PancakeSwap pool before I add liquidity",
];

/*
 * Build mode's backend is convex/agentBuilder.ts, deployed to dev on
 * 2026-09-26 and to PROD on 2026-09-27 (owner: "deploy to prod, fully"). It is
 * on unless NEXT_PUBLIC_DOLPHIN_BUILD=0: this site cannot set Vercel variables
 * from here, and the backend is now on every deployment it talks to.
 *
 * Sending is refused in `submit` as well as disabled on the button, so no path
 * (Enter, a starter chip) can send a build turn while it is off.
 */
const BUILD_BACKEND_CONNECTED: boolean = process.env.NEXT_PUBLIC_DOLPHIN_BUILD !== "0";

/**
 * Chat or Build, chosen on a NEW conversation only, the way Claude Code picks
 * a mode before the first prompt. Once a conversation has a turn in it, its mode
 * is fixed: a builder transcript and a Q&A transcript are different documents,
 * and switching halfway would leave one reading as the other.
 */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  return (
    <div
      aria-label="Conversation mode"
      className="inline-flex items-center rounded-full border border-line/70 bg-paper-muted/60 p-[3px]"
      role="radiogroup"
    >
      {(["chat", "build"] as const).map((option) => {
        const selected = option === mode;
        return (
          <button
            aria-checked={selected}
            className={`rounded-full px-3 py-[3px] text-[12px] font-medium transition-colors ${
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
  askedPrompts,
  onRetry,
  onConfirm,
}: {
  turn: DolphinTurn;
  dynamicAgents?: Array<{ name: string; agentKey: string }>;
  /** Only on the latest turn, and only when it failed: re-asks the question before it. */
  onRetry?: () => void;
  /** Only on the latest turn: sends the corrected request a typo reply offers. */
  onConfirm?: (prompt: string) => void;
  /** Only the latest answer gets follow-up suggestions; older ones stay quiet. */
  onSelectPrompt?: (prompt: string) => void;
  askedPrompts?: readonly string[];
}) {
  if (turn.role === "user") {
    return (
      <div className="flex w-full justify-end py-3">
        <div className="max-w-[80%] overflow-hidden whitespace-pre-wrap rounded-2xl bg-paper-muted px-4 py-2.5 text-[0.94rem] leading-relaxed text-ink">
          {turn.content}
        </div>
      </div>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <div className="flex w-full py-3">
      <div className="min-w-0 flex-1 space-y-2.5">
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
                Out of answers for now
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

        {turn.status === "error" && onRetry ? (
          <button
            className="rounded-full border border-line/80 px-3 py-1 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-paper-muted hover:text-ink"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        ) : null}

        {turn.content.length > 0 ? (
          <div className="overflow-hidden text-[0.95rem] leading-[1.75] text-ink">
            <DolphinMessageContent
              content={turn.content}
              dynamicAgents={dynamicAgents}
              excludePrompts={askedPrompts}
              onSelectPrompt={turn.ticket || turn.suggestedPrompt ? undefined : onSelectPrompt}
              toolCalls={turn.toolCalls}
            />
          </div>
        ) : null}

        {turn.ticket ? <TradeTicket ticket={turn.ticket} /> : null}

        {/*
          * A TYPO IS CONFIRMED WITH ONE TAP (owner, 2026-09-26). The button
          * sends the corrected request as a new turn, which resolves like a
          * typed one; nothing is traded on the guess.
          */}
        {turn.suggestedPrompt && onConfirm ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-semibold"
            onClick={() => onConfirm(turn.suggestedPrompt as string)}
            type="button"
          >
            <span className="text-canvas">Yes, {turn.suggestedPrompt}</span>
          </button>
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
          <p className="text-[0.68rem] text-faint">
            Answered {relativeTime(turn.reusedFrom)} · reused for an identical
            question
          </p>
        ) : turn.status === "complete" && turn.completedAt !== null ? (
          <p className="text-[0.68rem] text-faint">
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
      className="flex h-full min-h-0 flex-col border-r border-line/60 bg-paper px-3 pb-4 pt-3"
    >
      <div className="flex h-9 items-center gap-2 px-2">
        <h2 className="min-w-0 flex-1 text-[13px] font-semibold text-ink">Chats</h2>
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
        className="mt-2 flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-muted"
        onClick={onNew}
        type="button"
      >
        <CategoryGlyph name="add" size={16} strokeWidth={2} />
        New chat
      </button>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-2 text-[12px] leading-relaxed text-muted">
            Your chats appear here. They are saved on this device only.
          </p>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry) => {
              const active = entry.conversationKey === activeKey;
              return (
                <div
                  className={`group flex items-center gap-1 rounded-lg transition-colors ${
                    active ? "bg-paper-muted" : "hover:bg-paper-muted/70"
                  }`}
                  key={entry.conversationKey}
                >
                  <button
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left"
                    onClick={() => onOpen(entry.conversationKey)}
                    type="button"
                  >
                    <span className="block truncate text-[13px] text-ink">{entry.title}</span>
                    <span className="block text-[11px] text-muted">
                      {historyTime(entry.updatedAt)}
                    </span>
                  </button>
                  <button
                    aria-label={`Remove ${entry.title} from history`}
                    className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-faint transition-opacity hover:bg-paper hover:text-ink focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
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
  initialConversationKey = null,
}: {
  seedAgentKey: string | null;
  seedAgentName?: string | null;
  autoAsk?: boolean;
  /** From `?c=`: a conversation to open straight away. */
  initialConversationKey?: string | null;
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

  const {
    conversationKey,
    mode: activeMode,
    builder,
    send,
    reset,
    openConversation,
    startTry,
    isStartingTry,
    isSending,
    sendError,
  } = useDolphinChat(seedAgentKey, mode);

  /* `?c=` opens that conversation once; the history list picks it up from there. */
  const openedFromLinkRef = useRef(false);
  useEffect(() => {
    if (!initialConversationKey || openedFromLinkRef.current) return;
    openedFromLinkRef.current = true;
    openConversation(initialConversationKey);
  }, [initialConversationKey, openConversation]);
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
      if (activeMode !== "chat" && !BUILD_BACKEND_CONNECTED) return;
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void send(text);
    },
    [activeMode, isSending, send],
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
  const building = activeMode === "build";
  /* A private try-run of a draft. Opened from the draft panel, never from the switch. */
  const trying = activeMode === "try";
  const withDraft = building || trying;
  const askedPrompts = useMemo(
    () => turns.filter((turn) => turn.role === "user").map((turn) => turn.content),
    [turns],
  );
  // The mode is chosen on a new conversation and fixed once it has a turn.
  const canSwitchMode = isEmpty && !conversationKey;
  // Also blocked while an opened conversation's mode is loading (activeMode null).
  const sendBlocked = activeMode === null || (withDraft && !BUILD_BACKEND_CONNECTED);

  const agentDraft = builder?.draft
    ? {
        name: builder.draft.name,
        description: builder.draft.description,
        instructions: builder.draft.instructions,
        tools: builder.draft.tools,
      }
    : EMPTY_AGENT_DRAFT;
  const draftName = agentDraft.name?.trim() || "your agent";

  const buildConversationKey = builder?.buildConversationKey ?? null;
  /* Where this draft already lives on-chain (convex/builtAgents.ts forDraft). */
  const publishedListings = useQuery(
    builtAgentsApi.builtAgents.forDraft,
    withDraft && buildConversationKey && BUILD_BACKEND_CONNECTED ? { buildConversationKey } : "skip",
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const draftPanelActions = {
    trying,
    isStartingTry,
    onTry:
      building && conversationKey && BUILD_BACKEND_CONNECTED
        ? () => {
            setDraftOpen(false);
            void startTry(conversationKey);
          }
        : undefined,
    onBack:
      trying && buildConversationKey
        ? () => {
            setDraftOpen(false);
            openConversation(buildConversationKey);
          }
        : undefined,
    onPublish:
      building && buildConversationKey && BUILD_BACKEND_CONNECTED
        ? () => {
            setDraftOpen(false);
            setPublishOpen(true);
          }
        : undefined,
    published: (publishedListings ?? []).map((entry) => ({
      hash: entry.hash,
      networkLabel: entry.networkLabel,
      status: entry.status,
      tokenId: entry.tokenId,
    })),
  };

  const suggestions = trying
    ? []
    : building
    ? BUILD_STARTERS
    : seedAgentName
      ? [
          `What strategy does ${seedAgentName} run?`,
          `Check live health for ${seedAgentName}`,
          `Is ${seedAgentName} verified and safe?`,
        ]
      : STARTER_PROMPTS;

  /*
   * One composer, rendered in the middle of the empty screen or docked at the
   * bottom of a conversation. Only one of the two places renders it at a time,
   * so the textarea ref always points at the box on screen.
   */
  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <div className="flex w-full flex-col rounded-[1.4rem] border border-line/80 bg-paper p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-14px_rgba(15,23,42,0.18)]">
        <textarea
          aria-label={
            building ? "Describe the agent to build" : trying ? `Message ${draftName}` : "Message Dolphin"
          }
          className={`max-h-[400px] w-full resize-none overflow-x-hidden bg-transparent px-2.5 py-2 text-[0.94rem] leading-relaxed text-ink outline-none placeholder:text-faint focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
            isEmpty ? "min-h-[3.4rem]" : "min-h-0"
          }`}
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
              : trying
                ? `Ask ${draftName} something…`
                : "Ask about an agent, a position, or a yield…"
          }
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <div className="flex items-center justify-between gap-2 pl-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {/*
              * The switch lives above the empty screen's composer. Once a
              * conversation has started, this label is the only reminder of
              * which mode it is in.
              */}
            {canSwitchMode || activeMode === null ? null : (
              <span className="px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                {building ? "Build" : trying ? "Try" : "Chat"}
              </span>
            )}
            {/*
              * The draft's door on narrow screens. It lives here rather than in
              * the header because the header already holds back, title, Connect
              * and history, and a fourth control pushed Connect into the centred
              * title at 390px.
              */}
            {withDraft ? (
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
            className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-opacity disabled:opacity-25"
            disabled={draft.trim().length === 0 || isSending || sendBlocked}
            type="submit"
          >
            <svg aria-hidden className="text-canvas" fill="none" height="14" viewBox="0 0 24 24" width="14">
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
      {withDraft && !BUILD_BACKEND_CONNECTED ? (
        <p className="mt-2 px-3 text-center text-[0.72rem] text-muted">
          The builder is not connected yet, so nothing is sent. Switch to Chat to ask
          the marketplace a question.
        </p>
      ) : null}
      {sendError ? <p className="mt-2 px-3 text-[0.8rem] text-ink">{sendError}</p> : null}
    </form>
  );

  return (
    <div
      className={`dolphin-chat-page relative grid overflow-hidden ${
        withDraft
          ? "lg:grid-cols-[17rem_minmax(0,1fr)_22rem]"
          : "lg:grid-cols-[17rem_minmax(0,1fr)]"
      } ${styles.shell}`}
    >
      {/*
        * History on the LEFT, where Claude, ChatGPT and Gemini keep it: you
        * look left to find a past chat and work in the middle. The draft is on
        * the right, like Claude's artifacts: the thing being made sits beside
        * the conversation making it. In Build mode both show on desktop.
        */}
      <div className="relative z-20 hidden min-h-0 lg:block">
          <ChatHistory
            activeKey={conversationKey}
            entries={history}
            onClear={clearHistory}
            onNew={startNew}
            onOpen={openSavedConversation}
            onRemove={removeSavedConversation}
          />
      </div>

      <section className="relative z-10 flex min-h-0 min-w-0 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-between gap-2.5 px-4">
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

          {/*
            * Below sm the title gives way once a conversation is open: back,
            * Connect, history and New already fill 390px, and the centred title
            * sat underneath Connect.
            */}
          <div
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 items-center gap-2 ${
              isEmpty ? "flex" : "hidden sm:flex"
            }`}
          >
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
            <button
              aria-label="Open chat history"
              className="grid size-10 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper/80 lg:hidden"
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
          {conversationKey && isLoading ? (
            <div className="flex justify-center pt-[18vh]">
              <DolphinLoader label="Loading conversation…" />
            </div>
          ) : conversationKey && !exists ? (
            <div className="flex flex-col items-center gap-2 px-5 pt-[18vh] text-center">
              <h1 className="text-base font-semibold text-ink">
                Conversation unavailable
              </h1>
              <p className="max-w-sm text-sm text-muted">
                This locally saved chat can no longer be opened.
              </p>
            </div>
          ) : isEmpty ? (
            /*
             * THE EMPTY SCREEN, CLAUDE-STYLE. (2026-09-26)
             *
             * Mode, one quiet line, the composer in the middle of the page, and
             * small suggestions under it. The composer sits HERE rather than at
             * the bottom until the first turn, the way Claude's does: an empty
             * page with its input pinned to the floor makes the visitor look
             * for what to do; an input in the centre is the thing to do.
             */
            <div className="dolphin-empty-hero flex min-h-full flex-col items-center justify-center px-4 pb-[10vh] pt-10">
              <h1 className="sr-only">
                {building ? "Build an agent" : trying ? `Try ${draftName}` : "Ask the marketplace"}
              </h1>
              {trying ? (
                <>
                  <p className="text-center text-[1.3rem] font-medium tracking-[-0.02em] text-ink">
                    Try {draftName}
                  </p>
                  <p className="mt-2 max-w-[32rem] text-center text-[0.84rem] text-muted">
                    Ask it what you built it for. Only you can see this, and it
                    uses only the tools in the draft.
                  </p>
                </>
              ) : (
                <>
                  {canSwitchMode ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
                  <p className="mt-5 text-center text-[1.3rem] font-medium tracking-[-0.02em] text-ink">
                    {MODE_HINT[building ? "build" : "chat"]}
                  </p>
                </>
              )}
              <div className="mt-5 w-full max-w-[40rem]">{composer}</div>
              <div className="mt-3 flex max-w-[40rem] flex-wrap justify-center gap-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    className="rounded-full border border-line/70 bg-paper/60 px-3 py-1 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:bg-paper hover:text-ink"
                    key={suggestion}
                    onClick={() => {
                      /*
                       * Chat answers a suggestion straight away. Build puts it
                       * in the box instead, so the person can shape it before
                       * anything is drafted.
                       */
                      if (building) {
                        setDraft(suggestion);
                        textareaRef.current?.focus();
                      } else {
                        submit(suggestion);
                      }
                    }}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[44rem] px-5 pb-8 pt-8">
              {turns.map((turn, index) => (
                <Turn
                  askedPrompts={askedPrompts}
                  dynamicAgents={agentDirectory}
                  key={turn.id}
                  onSelectPrompt={
                    /*
                     * The follow-up chips are questions for Dolphin. Under a
                     * builder reply or a built agent's answer they would send a
                     * marketplace question to the wrong listener.
                     */
                    activeMode === "chat" && index === turns.length - 1
                      ? (prompt) => submit(prompt)
                      : undefined
                  }
                  onConfirm={index === turns.length - 1 ? (prompt) => submit(prompt) : undefined}
                  onRetry={
                    index === turns.length - 1 && turn.status === "error" && index > 0
                      ? () => submit(turns[index - 1].content)
                      : undefined
                  }
                  turn={turn}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {isEmpty ? null : (
          <div className="dolphin-composer-wrapper relative z-10 bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)]/95 to-transparent">
            <div className="mx-auto w-full max-w-[44rem] px-4 pb-5 pt-3">{composer}</div>
          </div>
        )}
      </section>

      {withDraft ? (
        <div className="relative z-20 hidden min-h-0 lg:block">
          <AgentDraftPanel draft={agentDraft} {...draftPanelActions} />
        </div>
      ) : null}

      {draftOpen && withDraft ? (
        <div className="fixed inset-0 z-30 flex justify-end lg:hidden">
          <button
            aria-label="Close agent draft"
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
            onClick={() => setDraftOpen(false)}
            type="button"
          />
          <div className="relative h-full w-[min(88vw,22rem)] shadow-[-18px_0_50px_rgba(15,23,42,0.16)]">
            <AgentDraftPanel
              draft={agentDraft}
              onClose={() => setDraftOpen(false)}
              {...draftPanelActions}
            />
          </div>
        </div>
      ) : null}

      {publishOpen && buildConversationKey && agentDraft.name && agentDraft.description ? (
        <PublishAgentDialog
          agentDescription={agentDraft.description}
          agentName={agentDraft.name}
          buildConversationKey={buildConversationKey}
          onClose={() => setPublishOpen(false)}
        />
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-30 flex justify-start lg:hidden">
          <button
            aria-label="Close chat history"
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
            onClick={() => setHistoryOpen(false)}
            type="button"
          />
          <div className="relative h-full w-[min(88vw,20rem)] shadow-[18px_0_50px_rgba(15,23,42,0.16)]">
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
