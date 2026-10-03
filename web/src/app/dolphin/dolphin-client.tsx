"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/* React Flow's stylesheet, for the Build canvas. External stylesheets are imported from app/ (Next CSS docs). */
import "@xyflow/react/dist/style.css";

import styles from "@/app/dolphin/dolphin-chat.module.css";
import { AgentCanvas, type CanvasRun } from "@/components/agent-canvas";
import { AgentDraftPanel, EMPTY_AGENT_DRAFT } from "@/components/agent-draft-panel";
import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { DolphinLoader } from "@/components/dolphin-loader";
import { HoldButton } from "@/components/hold-button";
import { ChatRow } from "@/components/chat-row";
import { ShinyText } from "@/components/shiny-text";
import { DolphinMessageContent } from "@/components/dolphin-message-content";
import { DolphinToolCalls } from "@/components/dolphin-tool-calls";
import { PublishAgentDialog } from "@/components/publish-agent-dialog";
import { SlideOver } from "@/components/slide-over";
import { HireTicket } from "@/components/hire-ticket";
import { TradeTicket } from "@/components/trade-ticket";
import { autopilotApi, builtAgentsApi, chatDeletionApi } from "@/convex/api";
import {
    useDolphinChat,
    useDolphinConversation,
    type DolphinTurn,
} from "@/hooks/use-dolphin-conversation";
import { usePanelLayout, type PanelKey } from "@/hooks/use-panel-layout";
import { useAppStore, type ChatHistoryEntry } from "@/store/use-app-store";
import { NEW_CONVERSATION, useDolphinPlaceStore } from "@/store/use-dolphin-place-store";
import { toast } from "@/store/use-toast-store";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

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
export const STARTER_PROMPTS = [
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
export const BUILD_STARTERS = [
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

const RESIZE_LABEL: Record<PanelKey, string> = {
  history: "Resize chat history",
  builder: "Resize builder chat",
  draft: "Resize agent draft",
};

/**
 * A draggable column border. Invisible until hovered, like n8n's and VS Code's.
 * Double-click resets; arrow keys nudge, so it works without a mouse too.
 */
function ResizeHandle({
  x,
  label,
  onPointerDown,
  onReset,
  onKeyNudge,
}: {
  x: number;
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
  onKeyNudge: (delta: number) => void;
}) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className="group absolute bottom-0 top-0 z-40 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none lg:block"
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onKeyNudge(-24);
        else if (event.key === "ArrowRight") onKeyNudge(24);
        else return;
        event.preventDefault();
      }}
      onPointerDown={onPointerDown}
      role="separator"
      style={{ left: x }}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
    >
      <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors group-hover:bg-line-strong group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}

/** For the "am I mounted" snapshot: nothing ever changes, so nothing is notified. */
function subscribeToNothing() {
  return () => {};
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

        {turn.ticket ? turn.ticket.kind === "hire" ? <HireTicket ticket={turn.ticket} /> : <TradeTicket ticket={turn.ticket} /> : null}

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
  onPin,
  onRename,
}: {
  activeKey: string | null;
  entries: ChatHistoryEntry[];
  /** Deletes every chat in the list, from the database too. */
  onClear: () => void;
  onClose?: () => void;
  onNew: () => void;
  onOpen: (conversationKey: string) => void;
  /** Deletes one chat, from the database too. */
  onRemove: (conversationKey: string) => void;
  onPin: (conversationKey: string) => void;
  onRename: (conversationKey: string, title: string) => void;
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

      <div className="sleek-scroll mt-5 min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-2 text-[12px] leading-relaxed text-muted">Your chats appear here.</p>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry) => {
              const active = entry.conversationKey === activeKey;
              /*
               * PIN, RENAME, DELETE behind three dots, like Claude's sidebar
               * (owner, 2026-09-29). Delete removes the chat from Dolphin's
               * database, not only this list (convex/chatDeletion.ts).
               */
              return (
                <ChatRow
                  active={active}
                  key={entry.conversationKey}
                  onDelete={() => onRemove(entry.conversationKey)}
                  onOpen={() => onOpen(entry.conversationKey)}
                  onPin={() => onPin(entry.conversationKey)}
                  onRename={(title) => onRename(entry.conversationKey, title)}
                  pinned={Boolean(entry.pinned)}
                  title={entry.title}
                />
              );
            })}
          </div>
        )}
      </div>

      {entries.length > 0 ? (
        <div className="mt-3 px-1">
          {/* Every chat, from the database too - so it takes a deliberate hold. */}
          <HoldButton
            backgroundColor="var(--paper)"
            className="history-delete-all"
            doneLabel="Deleting..."
            fillColor="#d64545"
            fillTextColor="#ffffff"
            holdTime={1400}
            onHold={onClear}
            radius={9}
            resetAfter={1500}
            size="sm"
            textColor="var(--muted)"
          >
            Hold to delete all chats
          </HoldButton>
        </div>
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const closeDraftSheet = useCallback(() => setDraftOpen(false), []);
  /*
   * The new-conversation mode and the composer text live in the place store
   * (browser-only), so they survive leaving the page. Read only once mounted:
   * the server render, and the client render that hydrates it, use defaults.
   */
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const storedMode = useDolphinPlaceStore((state) => state.newMode);
  const setMode = useDolphinPlaceStore((state) => state.setNewMode);
  const mode: ChatMode = mounted ? storedMode : "chat";
  const wallet = useWallet();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
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

  const composerKey = conversationKey ?? NEW_CONVERSATION;
  const storedComposer = useDolphinPlaceStore((state) => state.composer[composerKey]);
  const draft = mounted ? (storedComposer ?? "") : "";
  /** The composer's text, remembered per conversation as it is typed. */
  const setComposerText = useCallback(
    (text: string) => useDolphinPlaceStore.getState().setComposer(composerKey, text),
    [composerKey],
  );

  /*
   * WHERE TO START, once, after mount (owner, 2026-09-28: remember where they
   * were). A `?c=` link wins; a link about an agent starts fresh on purpose;
   * otherwise the conversation, mode and unsent text from last time come back
   * (store/use-dolphin-place-store.ts - this browser only, never the database).
   * After mount, because the server render cannot know any of it.
   */
  const openedFromLinkRef = useRef(false);
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (openedFromLinkRef.current) return;
    openedFromLinkRef.current = true;
    if (initialConversationKey) {
      openConversation(initialConversationKey);
      return;
    }
    const place = useDolphinPlaceStore.getState();
    if (seedAgentKey) {
      // A question about one agent: a fresh Chat, with the question ready.
      place.setNewMode("chat");
      if (!autoAsk && seedAgentName) {
        place.setComposer(NEW_CONVERSATION, `Tell me about ${seedAgentName.trim()} — what strategy does it run?`);
      }
      return;
    }
    if (place.conversationKey) {
      restoredKeyRef.current = place.conversationKey;
      openConversation(place.conversationKey);
    }
  }, [autoAsk, initialConversationKey, openConversation, seedAgentKey, seedAgentName]);
  const { exists, isLoading, title, turns, agentDirectory } =
    useDolphinConversation(conversationKey);

  /* Keep the place current. Skips the first render, which is before the restore above. */
  const placeMountedRef = useRef(false);
  useEffect(() => {
    if (!placeMountedRef.current) {
      placeMountedRef.current = true;
      return;
    }
    useDolphinPlaceStore.getState().setConversationKey(conversationKey);
  }, [conversationKey]);

  /* A remembered conversation that no longer exists quietly becomes a new one. */
  useEffect(() => {
    if (conversationKey && conversationKey === restoredKeyRef.current && !isLoading && !exists) {
      restoredKeyRef.current = null;
      reset();
    }
  }, [conversationKey, exists, isLoading, reset]);


  const history = useAppStore((state) => state.chatHistory);
  const upsertHistory = useAppStore((state) => state.upsertChatHistory);
  const removeHistory = useAppStore((state) => state.removeChatHistory);
  const clearHistory = useAppStore((state) => state.clearChatHistory);
  const togglePin = useAppStore((state) => state.togglePinChat);
  const renameChat = useAppStore((state) => state.renameChat);
  const deleteConversations = useMutation(chatDeletionApi.chatDeletion.deleteConversations);

  /*
   * SCROLL. Opening a conversation - including coming back to one - lands
   * where the person left it, or at the bottom if they never scrolled. After
   * that, new turns follow the bottom as before.
   */
  const scrolledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationKey || turns.length === 0) return;
    if (scrolledKeyRef.current !== conversationKey) {
      scrolledKeyRef.current = conversationKey;
      const saved = useDolphinPlaceStore.getState().scroll[conversationKey];
      const scroller = scrollerRef.current;
      requestAnimationFrame(() => {
        if (scroller && saved !== undefined) scroller.scrollTop = saved;
        else bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationKey, turns]);
  const scrollFrameRef = useRef(0);

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
      setComposerText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      void send(text);
    },
    [activeMode, isSending, send, setComposerText],
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
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }, [reset]);

  const openSavedConversation = useCallback(
    (conversationKeyToOpen: string) => {
      openConversation(conversationKeyToOpen);
      setHistoryOpen(false);
    },
    [openConversation],
  );

  /*
   * DELETE MEANS DELETE (owner, 2026-09-29). This used to drop the chat from
   * this device's list and leave every message on Dolphin's servers. Now the
   * list entry goes at once and the server deletes the messages and tool
   * calls, keeping only an anonymous summary (convex/chatDeletion.ts). If the
   * server refuses, the entry comes back and the person is told.
   */
  const removeSavedConversation = useCallback(
    (conversationKeyToRemove: string) => {
      const entry = history.find((item) => item.conversationKey === conversationKeyToRemove);
      removeHistory(conversationKeyToRemove);
      if (conversationKeyToRemove === conversationKey) reset();
      deleteConversations({ conversationKeys: [conversationKeyToRemove] }).then(
        () => toast.success("Chat deleted."),
        () => {
          if (entry) upsertHistory(entry);
          toast.error("That chat could not be deleted. Try again.");
        },
      );
    },
    [conversationKey, deleteConversations, history, removeHistory, reset, upsertHistory],
  );

  const deleteAllConversations = useCallback(() => {
    const keys = history.map((item) => item.conversationKey);
    if (keys.length === 0) return;
    const saved = history;
    clearHistory();
    reset();
    deleteConversations({ conversationKeys: keys }).then(
      () => toast.success(keys.length === 1 ? "Chat deleted." : `${keys.length} chats deleted.`),
      () => {
        saved.forEach((item) => upsertHistory(item));
        toast.error("Your chats could not be deleted. Try again.");
      },
    );
  }, [clearHistory, deleteConversations, history, reset, upsertHistory]);

  const isEmpty = turns.length === 0;
  const building = activeMode === "build";
  /* A private try-run of a draft. Opened from the draft panel, never from the switch. */
  const trying = activeMode === "try";
  const withDraft = building || trying;
  /*
   * THE CANVAS LAYOUT (owner, 2026-09-28: "like n8n"). Once a build
   * conversation has started, the agent is drawn in the middle and the chat
   * narrows to a builder column on the left, the way n8n puts its assistant
   * beside the workflow. History moves behind its button. The empty Build
   * screen is untouched: there is nothing to draw before the first turn.
   */
  const showCanvas = conversationKey !== null && ((building && !isEmpty) || trying);

  /*
   * THE RUN, AS IT HAPPENS (owner: "see that engine work"). Derived from the
   * latest answer's real status and its real tool calls - a call is recorded
   * before it runs and completed after (convex/dolphin.ts recordToolCall), so
   * "running" here means a request is actually in flight.
   */
  const canvasRun = useMemo<CanvasRun | null>(() => {
    if (!trying) return null;
    const last = [...turns].reverse().find((turn) => turn.role === "assistant");
    if (!last) return null;
    const tools = last.toolCalls.map((call) => ({
      agentKey: call.agentKey,
      toolName: call.toolName,
      state: (call.isError || call.transportError
        ? "error"
        : call.latencyMs === null && call.resultText === null
          ? "running"
          : "done") as CanvasRun["tools"][number]["state"],
    }));
    const working = last.status === "thinking" || last.status === "consulting";
    const phase: CanvasRun["phase"] =
      last.status === "error"
        ? "error"
        : !working
          ? "done"
          : tools.some((tool) => tool.state === "running")
            ? "consulting"
            : tools.length > 0 || last.content.length > 0
              ? "writing"
              : "thinking";
    // An autopilot run's message names the trigger that started it (convex/autopilot.ts).
    const asked = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "";
    const triggeredBy = asked.startsWith("Scheduled run")
      ? "schedule"
      : asked.startsWith("Price trigger")
        ? "price"
        : asked.startsWith("Wallet watch")
          ? "walletWatch"
          : asked.startsWith("Signal:")
            ? "signal"
            : null;
    return { phase, tools, triggeredBy } as CanvasRun;
  }, [trying, turns]);
  const { measure: measurePanels, ...panels } = usePanelLayout(showCanvas ? "canvas" : withDraft ? "draft" : "chat");
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
        brain: builder.draft.brain ?? null,
        blocks: builder.draft.blocks ?? [],
        detached: builder.draft.detached ?? [],
        autopilot: builder.draft.autopilot ?? null,
        purpose: builder.draft.purpose ?? null,
        hirePriceUsd: builder.draft.hirePriceUsd ?? null,
        paperMode: builder.draft.paperMode ?? true,
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

  /* AUTOPILOT: arming spends the builder's own key, so it needs their signed-in wallet. */
  const session = useWalletSession();
  const setAutopilot = useMutation(autopilotApi.autopilot.setAutopilot);
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const toggleAutopilot = async (on: boolean) => {
    if (!buildConversationKey) return;
    setAutopilotBusy(true);
    try {
      const token = session.sessionToken ?? (await session.signIn());
      if (!token) {
        toast.notice("Sign in with your wallet to switch Autopilot on.");
        return;
      }
      const result = await setAutopilot({ conversationKey: buildConversationKey, sessionToken: token, on });
      toast.success(
        result.on
          ? `Autopilot is on. It checks its ${result.triggers} trigger${result.triggers === 1 ? "" : "s"} from now, on your key.`
          : "Autopilot is off.",
      );
    } catch (cause) {
      const data = (cause as { data?: unknown } | null)?.data;
      toast.error(typeof data === "string" ? data : "Could not change Autopilot.");
    } finally {
      setAutopilotBusy(false);
    }
  };
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
    onToggleAutopilot: building && buildConversationKey ? (on: boolean) => void toggleAutopilot(on) : undefined,
    onWatchRuns: agentDraft.autopilot
      ? () => {
          setDraftOpen(false);
          openConversation(agentDraft.autopilot!.conversationKey);
        }
      : undefined,
    autopilotBusy,
    tradeKeyConversation: building ? buildConversationKey : null,
    knowledgeConversation: building && BUILD_BACKEND_CONNECTED ? buildConversationKey : null,
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
  const composerPlaceholder = building
    ? "Describe the agent you want to build…"
    : trying
      ? `Ask ${draftName} something…`
      : "Ask about an agent, a position, or a yield…";
  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <div className="flex w-full flex-col rounded-[1.4rem] border border-line/80 bg-paper p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-14px_rgba(15,23,42,0.18)]">
        {/*
          * THE PLACEHOLDER SHIMMERS (owner, 2026-09-29), in Chat, Build and
          * Try alike. A native placeholder cannot carry a moving gradient, so
          * the textarea's own is empty and this sits over it while the box is
          * empty; the aria-label still names the field.
          */}
        <div className="relative">
          {draft.length === 0 ? (
            <span aria-hidden="true" className="composer-placeholder">
              <ShinyText
                color="var(--faint)"
                shineColor="var(--ink)"
                speed={2.6}
                text={composerPlaceholder}
              />
            </span>
          ) : null}
          <textarea
            aria-label={
              building ? "Describe the agent to build" : trying ? `Message ${draftName}` : "Message Dolphin"
            }
            className={`max-h-[400px] w-full resize-none overflow-x-hidden bg-transparent px-2.5 py-2 text-[0.94rem] leading-relaxed text-ink outline-none placeholder:text-faint focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
              isEmpty ? "min-h-[3.4rem]" : "min-h-0"
            }`}
            onChange={(event) => {
              setComposerText(event.target.value);
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
            ref={textareaRef}
            rows={1}
            value={draft}
          />
        </div>
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
                <CategoryGlyph name="brain" size={14} strokeWidth={1.9} />
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
        /*
         * Always four tracks - history | chat | canvas | draft - with hidden
         * ones at 0, so a change of layout can animate (use-panel-layout.ts).
         * These classes are only the first paint; once the page is measured
         * the inline px template takes over and the borders become draggable.
         */
        showCanvas
          ? "lg:grid-cols-[0px_24rem_minmax(0,1fr)_22rem]"
          : withDraft
            ? "lg:grid-cols-[17rem_minmax(0,1fr)_0px_22rem]"
            : "lg:grid-cols-[17rem_minmax(0,1fr)_0px_0px]"
      } ${styles.shell}`}
      ref={measurePanels}
      style={panels.style}
    >
      {panels.columns
        ? panels.handles.map((handle) => (
            <ResizeHandle
              key={handle.key}
              label={RESIZE_LABEL[handle.key]}
              onKeyNudge={(delta) => panels.nudge(handle.key, handle.invert ? -delta : delta)}
              onPointerDown={(event) => panels.startDrag(handle.key, handle.invert, event)}
              onReset={() => panels.reset(handle.key)}
              x={panels.columns!.slice(0, handle.afterColumn + 1).reduce((a, b) => a + b, 0)}
            />
          ))
        : null}
      {/*
        * History on the LEFT, where Claude, ChatGPT and Gemini keep it: you
        * look left to find a past chat and work in the middle. The draft is on
        * the right, like Claude's artifacts: the thing being made sits beside
        * the conversation making it. In Build mode both show on desktop.
        */}
      {/* Always a grid item, so collapsing it is a 0px track rather than a reflow. */}
      <div
        aria-hidden={showCanvas || undefined}
        className="relative z-20 hidden min-h-0 overflow-hidden lg:block"
        inert={showCanvas}
      >
        <div className="h-full min-w-[13rem]">
          <ChatHistory
            activeKey={conversationKey}
            entries={history}
            onClear={deleteAllConversations}
            onNew={startNew}
            onOpen={openSavedConversation}
            onPin={togglePin}
            onRename={renameChat}
            onRemove={removeSavedConversation}
          />
        </div>
      </div>

      <section
        className={`relative z-10 flex min-h-0 min-w-0 flex-col ${showCanvas ? "lg:border-r lg:border-line/60" : ""}`}
      >
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
              isEmpty ? "flex" : showCanvas ? "hidden" : "hidden sm:flex"
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
              className={`grid size-10 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper/80 ${
                showCanvas ? "" : "lg:hidden"
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

        <div
          className="sleek-scroll min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop;
            if (!conversationKey) return;
            cancelAnimationFrame(scrollFrameRef.current);
            scrollFrameRef.current = requestAnimationFrame(() =>
              useDolphinPlaceStore.getState().setScroll(conversationKey, top),
            );
          }}
          ref={scrollerRef}
        >
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
                        setComposerText(suggestion);
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

      <div className="relative z-0 hidden min-h-0 min-w-0 overflow-hidden lg:block">
        {showCanvas ? (
          <AgentCanvas
            draft={agentDraft}
            editKey={building ? buildConversationKey : null}
            layoutKey={buildConversationKey}
            run={canvasRun}
          />
        ) : null}
      </div>

      {/*
        * The draft panel keeps its full width while its track grows from 0,
        * pinned to the right edge - so it slides in from the right rather than
        * being squeezed open (owner, 2026-09-28).
        */}
      <div className="relative z-20 hidden min-h-0 overflow-hidden lg:flex lg:justify-end">
        {withDraft ? (
          <div className="h-full shrink-0" style={{ width: panels.columns?.[3] || panels.sizes.draft }}>
            <AgentDraftPanel draft={agentDraft} {...draftPanelActions} />
          </div>
        ) : null}
      </div>

      <SlideOver
        className="lg:hidden"
        label="agent draft"
        onClose={closeDraftSheet}
        open={draftOpen && withDraft}
        side="right"
      >
        <AgentDraftPanel draft={agentDraft} onClose={closeDraftSheet} {...draftPanelActions} />
      </SlideOver>

      {publishOpen && buildConversationKey && agentDraft.name && agentDraft.description ? (
        <PublishAgentDialog
          agentDescription={agentDraft.description}
          agentName={agentDraft.name}
          buildConversationKey={buildConversationKey}
          onClose={() => setPublishOpen(false)}
        />
      ) : null}

      <SlideOver
        className={showCanvas ? "" : "lg:hidden"}
        label="chat history"
        onClose={closeHistory}
        open={historyOpen}
        side="left"
      >
        <ChatHistory
          activeKey={conversationKey}
          entries={history}
          onClear={deleteAllConversations}
          onClose={closeHistory}
          onNew={startNew}
          onOpen={openSavedConversation}
          onPin={togglePin}
          onRename={renameChat}
          onRemove={removeSavedConversation}
        />
      </SlideOver>
    </div>
  );
}
