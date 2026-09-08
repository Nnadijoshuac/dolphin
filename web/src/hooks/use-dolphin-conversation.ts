"use client";

import { useCallback, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";

import {
  dolphinApi,
  type DolphinMessage,
  type DolphinToolCall,
} from "@/convex/api";
import { useWalletSession } from "@/wallet/wallet-session";

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
  };
}

/**
 * Opens a conversation and sends turns into it.
 *
 * The conversation key is generated SERVER-SIDE. It is a capability - holding
 * it is what grants read access to an anonymous conversation - so it is never
 * derived in the browser. See the access-model note on `dolphinConversations`
 * in convex/schema.ts.
 */
export function useDolphinChat(seedAgentKey?: string | null) {
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const createConversation = useMutation(dolphinApi.dolphin.createConversation);
  const ask = useAction(dolphinApi.dolphin.ask);
  const session = useWalletSession();

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isSending) return;

      setIsSending(true);
      setSendError(null);
      try {
        let key = conversationKey;
        if (!key) {
          const created = await createConversation({
            ...(seedAgentKey ? { seedAgentKey } : {}),
            // Binds the conversation to the wallet when signed in so it can be
            // listed later. Anonymous is permitted and is not an error.
            ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
          });
          key = created.conversationKey;
          setConversationKey(key);
        }
        await ask({ conversationKey: key, text: trimmed });
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
    [ask, conversationKey, createConversation, isSending, seedAgentKey, session.sessionToken],
  );

  const reset = useCallback(() => {
    setConversationKey(null);
    setSendError(null);
  }, []);

  return { conversationKey, send, reset, isSending, sendError };
}
