import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useEffect, type PropsWithChildren } from "react";

import { AGENT_QUERY_TIMINGS } from "@/constants/agents";

// Native only, deliberately. Browsers already have TanStack Query's own
// onlineManager, driven by window's online/offline events - the same reason
// the focus listener below is skipped on web.
//
// Wiring NetInfo here on web actively breaks the app when it is not served
// from the domain root. NetInfo's web build defaults to
// `reachabilityUrl: "/"` with `reachabilityMethod: "HEAD"` and a
// `reachabilityTest` of `status === 200` (see its
// internal/defaultConfiguration.web.js). Under any sub-path deploy - a
// GitHub Pages project site at /<repo>, or anything behind a path prefix -
// that probe hits a root the app does not own and gets a 404, so
// isInternetReachable becomes false, onlineManager goes offline, and
// TanStack Query *pauses* every query instead of failing it: no HTTP
// request, no error, no retry, and a permanently empty marketplace.
//
// Confirmed on 2026-08-29 by exporting with experiments.baseUrl set and
// serving under a sub-path: zero requests to 8004scan and a "No Agents
// Found" Discover tab, while the identical bundle served at / fetched all
// eight agents. Convex was unaffected, which is what made it look like a
// routing bug rather than a network-state one.
if (Platform.OS !== "web") {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      const hasNetwork = state.isConnected === true;
      const canReachInternet = state.isInternetReachable !== false;

      setOnline(hasNetwork && canReachInternet);
    }),
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: true,
      retry: 2,
    },
    mutations: {
      retry: 0,
    },
  },
});

/* --- disk cache ------------------------------------------------------------
 *
 * WHY: the query cache was memory-only, so every cold start began with nothing
 * and the Discover tab opened on a spinner - even though the catalog is
 * considered fresh for 5 minutes and is kept for an hour. That hour only ever
 * applied within a single run of the app. Persisting it means a relaunch paints
 * the last known catalog immediately and revalidates behind it, which is the
 * difference between "loading" and "already there".
 *
 * NATIVE ONLY, and not as a preference. AsyncStorage's web build is backed by
 * localStorage, which does not exist during the static web export's SSR pass -
 * that is the same failure that already crashed the export once via
 * WalletConnect's Core.init (see the note in wallet-provider.native.tsx). Web
 * therefore keeps the plain in-memory provider.
 */
const CACHE_KEY = "dolphin-query-cache-v1";

/**
 * Bump to discard every persisted entry - a restored cache is only safe while
 * the shapes it holds still match what the code expects, and nothing else
 * invalidates it. Change this in the same commit as any change to the Agent
 * shape or to what the catalog query returns.
 */
const CACHE_BUSTER = "agents-v1";

const persister =
  Platform.OS === "web"
    ? null
    : createAsyncStoragePersister({
        storage: AsyncStorage,
        key: CACHE_KEY,
        // Batches the writes that follow a burst of queries into one, so
        // restoring a screen full of data does not mean a write per query.
        throttleTime: 1_000,
      });

function syncNativeFocus(status: AppStateStatus) {
  focusManager.setFocused(status === "active");
}

export function QueryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    // Browsers already have TanStack Query's visibility listener.
    if (Platform.OS === "web") {
      return undefined;
    }

    syncNativeFocus(AppState.currentState);
    const subscription = AppState.addEventListener("change", syncNativeFocus);

    return () => subscription.remove();
  }, []);

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Matches the catalog's gcTime, so disk never hands back something the
        // in-memory cache would already have dropped.
        maxAge: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          /**
           * Persist settled catalog reads, and NOTHING live.
           *
           * The default already excludes errors and pending queries. The
           * addition is erc8183-job: those polls carry a job's on-chain escrow
           * status, read fresh every few seconds with staleTime 0
           * (use-job-delivery.ts). Restoring one from disk would show a
           * FUNDED/SUBMITTED state from a previous session as though it were
           * current - a claim about someone's money that Dolphin has not
           * verified this run. Live chain state is re-read, never remembered
           * (AGENTS.md §5).
           */
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            query.queryKey[0] !== "erc8183-job",
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
