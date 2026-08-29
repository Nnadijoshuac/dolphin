import NetInfo from "@react-native-community/netinfo";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useEffect, type PropsWithChildren } from "react";

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

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
