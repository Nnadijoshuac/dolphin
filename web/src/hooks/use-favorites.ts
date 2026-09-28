"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo } from "react";

import { favoritesApi } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import {
  flushFavorites,
  pressFavorite,
  reconcileFavorites,
  registerFavoriteWriter,
  useFavoritesStore,
} from "@/store/use-favorites-store";
import { toast } from "@/store/use-toast-store";
import type { Agent } from "@/types/agent";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * The connected wallet's starred agents (convex/favorites.ts).
 *
 * THE STAR EXISTS ONLY FOR A CONNECTED WALLET (owner, 2026-09-28): a feature
 * that cannot work for someone is not shown to them. `visible` is that rule.
 * Connected but not yet signed in still shows the star; the first press asks
 * for the sign-in signature and then stars, in one go.
 *
 * Presses are local-first and batched - see store/use-favorites-store.ts. Every
 * star on a page calls this hook, and Convex shares one subscription between
 * identical queries, so the page holds one read, not one per card.
 */
export function useFavorites() {
  const session = useWalletSession();
  const visible =
    convexClient !== null &&
    session.status !== "unavailable" &&
    session.status !== "wallet-disconnected";
  const token = session.sessionToken;

  const mine = useQuery(
    favoritesApi.favorites.mine,
    visible && token ? { sessionToken: token } : "skip",
  );
  const setFavorite = useMutation(favoritesApi.favorites.set);
  const pending = useFavoritesStore((state) => state.pending);

  const serverKeys = useMemo(() => new Set(mine?.agentKeys ?? []), [mine]);

  const writer = useMemo(
    () =>
      token
        ? async (agentKey: string, favorite: boolean) => {
            try {
              await setFavorite({ sessionToken: token, agentKey, favorite });
            } catch (cause) {
              // A ConvexError carries its sentence in `data`; `message` has the request id.
              const data = (cause as { data?: unknown } | null)?.data;
              toast.error(
                typeof data === "string" ? data : toUserMessage(cause, "Could not update your favorites."),
              );
              throw cause;
            }
          }
        : null,
    [setFavorite, token],
  );

  useEffect(() => {
    registerFavoriteWriter(writer, serverKeys);
    reconcileFavorites(serverKeys);
  }, [serverKeys, writer]);

  // A change still waiting when the tab is hidden or closed goes out then.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushFavorites();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushFavorites);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushFavorites);
    };
  }, []);

  const isFavorite = useCallback(
    (agentKey: string) => pending[agentKey] ?? serverKeys.has(agentKey),
    [pending, serverKeys],
  );

  const toggle = useCallback(
    async (agentKey: string) => {
      const favorite = !isFavorite(agentKey);
      if (!token) {
        // First press on a connected but signed-out wallet: one signature, then star.
        if (session.isSigningIn) return;
        const issued = await session.signIn();
        if (!issued) {
          // `session.error` here is this render's, not the failed sign-in's.
          toast.notice("Sign in with your wallet to save favorites.");
          return;
        }
        // The writer registers on the next render; the settle timer outlasts it.
      }
      pressFavorite(agentKey, favorite);
    },
    [isFavorite, session, token],
  );

  // The shelf follows local presses too: an un-starred agent leaves it at once.
  const agents = useMemo(
    () => ((mine?.agents ?? []) as Agent[]).filter((agent) => pending[agent.agentKey] !== false),
    [mine, pending],
  );

  return {
    visible,
    isSigningIn: session.isSigningIn,
    isFavorite,
    toggle,
    agents,
  };
}
