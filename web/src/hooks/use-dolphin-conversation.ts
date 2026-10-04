"use client";

import { useCallback, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";

import {
  agentBuilderApi,
  dolphinApi,
  type DolphinConversationMode,
  type DolphinMessage,
  type DolphinToolCall,
} from "@/convex/api";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";
import { recordRefEvent } from "@/lib/campaign-ref";

/**
 * The Dolphin agent's conversation state, for the website.
 *
 * Deliberately the same shape as the mobile hook at
 * `src/hooks/use-dolphin-conversation.ts`. Two frontends against one Convex
 * backend is a documented decision (Agent/DECISION-2026-09-08-two-frontends.md)
 * and the cost it carries is one-directional drift - reviews, retention, manage
 * and onboarding all existed on mobile before they existed here. Keeping the
 * two hooks structurally identical is what makes a change to one obviously
 * portable to the other.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO STREAMING HOOK
 * ---------------------------------------------------------------------------
 * `ask` is a long-running action - it opens MCP sessions against third-party
 * servers - and returns only when the turn is done. Progress comes from the
 * Convex subscription on `getConversation`: the action writes the assistant
 * message empty, moves it thinking -> consulting -> complete, and inserts a
 * tool-call row before each call and patches it after. Every one of those
 * writes pushes here for free.
 *
 * Chosen over token streaming because Convex actions cannot stream to a client,
 * and because a free-tier rate limit hit mid-stream arrives as
 * `finish_reason: "error"` rather than an HTTP 429 - which renders as the agent
 * stopping mid-sentence for no reason.
 */

export type { DolphinMessage, DolphinToolCall };

/** A turn with the calls that produced it already attached. */
export type DolphinTurn = DolphinMessage & { toolCalls: DolphinToolCall[] };

export function useDolphinConversation(conversationKey: string | null) {
  const data = useQuery(
    dolphinApi.dolphin.getConversation,
    conversationKey ? { conversationKey } : "skip",
  );

  /*
   * THESE ARE THE CALLS THAT RAN. Written by the code that made them, not
   * parsed out of the model's prose - the model is small and free and will
   * claim to have consulted an agent it never called. Render this list as the
   * sources; never a list the answer text mentions.
   */
  const turns: DolphinTurn[] = useMemo(() => {
    if (!data) return [];
    const byMessage = new Map<string, DolphinToolCall[]>();
    for (const call of data.toolCalls) {
      const existing = byMessage.get(call.messageId);
      if (existing) existing.push(call);
      else byMessage.set(call.messageId, [call]);
    }
    return data.messages.map((message) => ({
      ...message,
      toolCalls: byMessage.get(message.id) ?? [],
    }));
  }, [data]);

  return {
    isLoading: data === undefined,
    exists: data !== undefined && data !== null,
    title: data?.conversation.title ?? null,
    seedAgentKey: data?.conversation.seedAgentKey ?? null,
    turns,
    agentDirectory: data?.agentDirectory ?? [],
  };
}

/**
 * Opens a conversation and sends turns into it.
 *
 * The conversation key is generated SERVER-SIDE. It is a capability - holding
 * it is what grants read access to an anonymous conversation - so it is never
 * derived in the browser. See the access-model note on `dolphinConversations`
 * in convex/schema.ts.
 *
 * `newConversationMode` is what the Chat | Build switch says, and applies only
 * until a conversation exists. After that the mode is the one the conversation
 * was created with, read back from the server, because an opened chat from the
 * history list may be a build or a try-run. Each mode has its own action, and
 * the backend refuses a turn sent to the wrong one.
 */
export function useDolphinChat(
  seedAgentKey?: string | null,
  newConversationMode: "chat" | "build" = "chat",
) {
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const builder = useAgentDraft(conversationKey);
  /* Null while an opened conversation's mode is still loading: nothing is sent until it is known. */
  const mode: DolphinConversationMode | null = conversationKey
    ? (builder?.mode ?? null)
    : newConversationMode;

  const createConversation = useMutation(dolphinApi.dolphin.createConversation);
  const startTryMutation = useMutation(agentBuilderApi.agentBuilder.startTry);
  const chatAsk = useAction(dolphinApi.dolphin.ask);
  const buildAsk = useAction(agentBuilderApi.agentBuilder.ask);
  const tryAsk = useAction(agentBuilderApi.agentBuilder.tryAsk);
  const ask = mode === "build" ? buildAsk : mode === "try" ? tryAsk : chatAsk;
  const wallet = useWallet();
  const session = useWalletSession();
  const userAddress = (wallet.address ?? session.address ?? undefined)?.toLowerCase();
  /* Sent with chat turns so a balance question can read the Dolphin Wallet too. */
  const dolphinWallet = useAltanaWallet();
  const dolphinWalletAddress =
    dolphinWallet.status === "connected" ? (dolphinWallet.address ?? undefined) : undefined;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isSending || mode === null) return;

      setIsSending(true);
      setSendError(null);
      try {
        let key = conversationKey;
        // A try-run always has a key already: startTry opened it.
        if (!key && mode !== "try") {
          const created = await createConversation({
            mode,
            ...(seedAgentKey && mode === "chat" ? { seedAgentKey } : {}),
            // Binds the conversation to the wallet when signed in so it can be
            // listed later. Anonymous is permitted and is not an error.
            ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
            ...(userAddress ? { userAddress } : {}),
          });
          key = created.conversationKey;
          setConversationKey(key);
          if (mode === "build") recordRefEvent("buildStart");
        }
        if (!key) return;
        await ask({
          conversationKey: key,
          text: trimmed,
          ...(userAddress ? { userAddress } : {}),
          ...(mode === "chat" && dolphinWalletAddress ? { dolphinWalletAddress } : {}),
        });
      } catch (cause) {
        /*
         * Only reached when the ACTION ITSELF failed - a dropped connection, or
         * the conversation disappearing. Failures inside the turn (rate limits,
         * an unreachable agent, a model that would not answer) are written onto
         * the assistant message as `status: "error"` with a readable reason,
         * because they belong in the transcript where the question was asked.
         */
        setSendError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsSending(false);
      }
    },
    [
      ask,
      conversationKey,
      createConversation,
      dolphinWalletAddress,
      isSending,
      mode,
      seedAgentKey,
      session.sessionToken,
      userAddress,
    ],
  );

  const reset = useCallback(() => {
    setConversationKey(null);
    setSendError(null);
  }, []);

  const openConversation = useCallback((key: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    setConversationKey(normalizedKey);
    setSendError(null);
  }, []);

  /** Opens a private try-run of a build conversation's draft, and switches to it. */
  const [isStartingTry, setIsStartingTry] = useState(false);
  const startTry = useCallback(
    async (buildConversationKey: string) => {
      setIsStartingTry(true);
      setSendError(null);
      try {
        const opened = await startTryMutation({
          buildConversationKey,
          ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
          ...(userAddress ? { userAddress } : {}),
        });
        setConversationKey(opened.conversationKey);
      } catch (cause) {
        setSendError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsStartingTry(false);
      }
    },
    [session.sessionToken, startTryMutation, userAddress],
  );

  return {
    conversationKey,
    mode,
    /** The conversation's builder side. undefined while loading. */
    builder,
    send,
    reset,
    openConversation,
    startTry,
    isStartingTry,
    isSending,
    sendError,
  };
}

/**
 * The builder side of a conversation: its mode, and the draft it builds or
 * tries. `undefined` while loading, null when there is no conversation.
 */
export function useAgentDraft(conversationKey: string | null) {
  return useQuery(
    agentBuilderApi.agentBuilder.getDraft,
    conversationKey ? { conversationKey } : "skip",
  );
}
