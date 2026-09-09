import { useCallback, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * The Dolphin agent's conversation state.
 *
 * See Agent/DOLPHIN-AGENT-SCOPE.md for what this feature is and convex/dolphin.ts
 * for the loop behind it.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO STREAMING HOOK HERE
 * ---------------------------------------------------------------------------
 * `ask` is a long-running action - it opens MCP sessions against third-party
 * servers and calls their tools - and it returns only when the whole turn is
 * done. Progress does not come back through it.
 *
 * Progress comes from the Convex subscription on `getConversation`. The action
 * writes the assistant message empty, moves it through `thinking` ->
 * `consulting` -> `complete`, and inserts a `dolphinToolCalls` row before each
 * call and patches it after. Every one of those writes pushes to this hook for
 * free.
 *
 * That was a deliberate choice over token streaming: Convex actions cannot
 * stream to a client, and on the free tier a rate limit hit mid-stream arrives
 * as `finish_reason: "error"` rather than an HTTP 429 - which renders as the
 * agent stopping mid-sentence for no reason. Watching "consulting Brain on
 * BNB..." land row by row is also the better demo.
 */

export type DolphinToolCall = {
  id: string;
  messageId: string;
  agentKey: string;
  agentName: string;
  toolName: string;
  /** What Dolphin asked, JSON. Shown beside what came back. */
  argumentsJson: string;
  resultText: string | null;
  isError: boolean;
  transportError: string | null;
  latencyMs: number | null;
  calledAt: number;
};

export type DolphinMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "thinking" | "consulting" | "complete" | "error";
  errorReason: string | null;
  model: string | null;
  createdAt: number;
  completedAt: number | null;
};

/** A turn with the calls that produced it already attached. */
export type DolphinTurn = DolphinMessage & { toolCalls: DolphinToolCall[] };

export function useDolphinConversation(conversationKey: string | null) {
  const data = useQuery(
    api.dolphin.getConversation,
    conversationKey ? { conversationKey } : "skip",
  );

  /*
   * Tool calls are attached to their message here rather than in the query so
   * the backend keeps returning a flat, cheap shape.
   *
   * THESE ARE THE CALLS THAT RAN. They are written by the code that made them,
   * not parsed out of the model's prose - the model is small and free and will
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
    /** undefined while the subscription is loading, null when no such key. */
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
 * The conversation key is generated SERVER-SIDE and held here. It is a
 * capability - holding it is what grants read access to an anonymous
 * conversation - so it is never derived on the device. See the access-model
 * note on `dolphinConversations` in convex/schema.ts.
 */
export function useDolphinChat(seedAgentKey?: string | null) {
  const [conversationKey, setConversationKey] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const createConversation = useMutation(api.dolphin.createConversation);
  const ask = useAction(api.dolphin.ask);
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
            // Binds the conversation to the wallet when signed in, so it shows
            // up in history. Anonymous is permitted and is not an error.
            ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
          });
          key = created.conversationKey;
          setConversationKey(key);
        }
        await ask({ conversationKey: key, text: trimmed });
      } catch (cause) {
        /*
         * Only reached when the ACTION ITSELF failed - a network drop, or the
         * conversation disappearing. Failures inside the turn (rate limits, an
         * unreachable agent, a model refusal) are written onto the assistant
         * message as `status: "error"` with a readable `errorReason`, because
         * they belong in the transcript where the user asked the question, not
         * in a toast that outlives it.
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

  const openConversation = useCallback((key: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    setConversationKey(normalizedKey);
    setSendError(null);
  }, []);

  return { conversationKey, send, reset, openConversation, isSending, sendError };
}
