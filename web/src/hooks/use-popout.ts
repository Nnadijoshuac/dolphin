"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * POP A PANEL OUT INTO ITS OWN TAB, AND NEVER LOSE IT (owner, 2026-10-03).
 *
 * The agent panel or the canvas can move to a new browser tab - to drag onto a second
 * screen - and must come back on its own when that tab goes away:
 *
 * - The popped tab is the same /dolphin page in "solo" mode, so it shows the same live
 *   data (everything is a Convex subscription) with nothing copied between tabs.
 * - It says "I'm here" on a BroadcastChannel every second and stamps the time in
 *   localStorage. Closing it says "closed" at once; a crash simply stops the beat.
 * - The main window puts the panel back when the beat is older than STALE_MS, and on a
 *   refresh it reads the stamp: no fresh stamp, no pop-out - the panel is restored.
 *
 * Nothing here touches the database: it is per-browser layout, like the panel sizes.
 */

export type PopKind = "draft" | "canvas";

type Message =
  | { type: "alive"; kind: PopKind; key: string }
  | { type: "closed"; kind: PopKind }
  | { type: "return"; kind: PopKind }
  | { type: "follow"; key: string }
  | { type: "action"; kind: PopKind; action: PopAction };

/** What a popped panel asks the main window to do, because it changes what the main window shows. */
export type PopAction = "try" | "back" | "publish" | "watchRuns";

const CHANNEL = "dolphin.popout.v1";
const BEAT_MS = 1000;
const STALE_MS = 4000;
const stampKey = (kind: PopKind) => `dolphin.popout.${kind}`;

function readStamp(kind: PopKind): number {
  try {
    const raw = window.localStorage.getItem(stampKey(kind));
    const at = raw ? (JSON.parse(raw) as { at?: unknown }).at : null;
    return typeof at === "number" ? at : 0;
  } catch {
    return 0;
  }
}

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
}

/** The main window: which panels are away, popping out, bringing back, and the asks from popped tabs. */
export function usePopouts(enabled: boolean, conversationKey: string | null, onAction: (action: PopAction) => void) {
  const [away, setAway] = useState<Record<PopKind, boolean>>({ draft: false, canvas: false });
  const seen = useRef<Record<PopKind, number>>({ draft: 0, canvas: 0 });
  const channel = useRef<BroadcastChannel | null>(null);
  const actionRef = useRef(onAction);
  useEffect(() => {
    actionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    if (!enabled) return;
    const bc = openChannel();
    channel.current = bc;
    // A refresh: a panel stays away only if its tab beat a moment ago.
    const now = Date.now();
    for (const kind of ["draft", "canvas"] as const) seen.current[kind] = readStamp(kind);
    const initial = {
      draft: now - seen.current.draft < STALE_MS,
      canvas: now - seen.current.canvas < STALE_MS,
    };
    const first = window.setTimeout(() => setAway(initial), 0);
    const onMessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === "alive") {
        seen.current[message.kind] = Date.now();
        setAway((current) => (current[message.kind] ? current : { ...current, [message.kind]: true }));
      } else if (message.type === "closed") {
        seen.current[message.kind] = 0;
        setAway((current) => ({ ...current, [message.kind]: false }));
      } else if (message.type === "action") {
        actionRef.current(message.action);
        window.focus();
      }
    };
    bc?.addEventListener("message", onMessage);
    const check = window.setInterval(() => {
      const at = Date.now();
      setAway((current) => {
        const next = {
          draft: current.draft && at - seen.current.draft < STALE_MS,
          canvas: current.canvas && at - seen.current.canvas < STALE_MS,
        };
        return next.draft === current.draft && next.canvas === current.canvas ? current : next;
      });
    }, BEAT_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(check);
      bc?.removeEventListener("message", onMessage);
      bc?.close();
      channel.current = null;
    };
  }, [enabled]);

  // A popped panel follows the conversation the main window is on.
  useEffect(() => {
    if (conversationKey) channel.current?.postMessage({ type: "follow", key: conversationKey } satisfies Message);
  }, [conversationKey]);

  const popOut = useCallback(
    (kind: PopKind) => {
      if (!conversationKey) return false;
      const url = `/dolphin?c=${conversationKey}&solo=${kind}`;
      const opened = window.open(url, `dolphin-${kind}`);
      if (!opened) return false;
      // Grace for the new tab to load before its first beat counts.
      seen.current[kind] = Date.now() + 8000;
      setAway((current) => ({ ...current, [kind]: true }));
      return true;
    },
    [conversationKey],
  );

  const bringBack = useCallback((kind: PopKind) => {
    channel.current?.postMessage({ type: "return", kind } satisfies Message);
    seen.current[kind] = 0;
    setAway((current) => ({ ...current, [kind]: false }));
  }, []);

  return { away, popOut, bringBack };
}

/** The popped tab: beat, say goodbye, close when called back, follow the main window. */
export function usePopoutBeat(kind: PopKind | null, conversationKey: string | null, onFollow: (key: string) => void) {
  const channel = useRef<BroadcastChannel | null>(null);
  const followRef = useRef(onFollow);
  useEffect(() => {
    followRef.current = onFollow;
  }, [onFollow]);

  useEffect(() => {
    if (!kind || !conversationKey) return;
    const bc = openChannel();
    channel.current = bc;
    const beat = () => {
      bc?.postMessage({ type: "alive", kind, key: conversationKey } satisfies Message);
      try {
        window.localStorage.setItem(stampKey(kind), JSON.stringify({ at: Date.now(), key: conversationKey }));
      } catch {
        /* Blocked storage: the channel still carries the beat; only refresh-restore is lost. */
      }
    };
    beat();
    const timer = window.setInterval(beat, BEAT_MS);
    const goodbye = () => {
      bc?.postMessage({ type: "closed", kind } satisfies Message);
      try {
        window.localStorage.removeItem(stampKey(kind));
      } catch {
        /* See above. */
      }
    };
    const onMessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === "return" && message.kind === kind) {
        goodbye();
        window.close();
      } else if (message.type === "follow" && message.key !== conversationKey) {
        followRef.current(message.key);
      }
    };
    bc?.addEventListener("message", onMessage);
    window.addEventListener("pagehide", goodbye);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", goodbye);
      bc?.removeEventListener("message", onMessage);
      bc?.close();
      channel.current = null;
    };
  }, [kind, conversationKey]);

  const ask = useCallback(
    (action: PopAction) => {
      if (kind) channel.current?.postMessage({ type: "action", kind, action } satisfies Message);
    },
    [kind],
  );
  return { ask };
}
