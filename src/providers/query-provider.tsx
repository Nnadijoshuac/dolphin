import NetInfo from "@react-native-community/netinfo";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useEffect, type PropsWithChildren } from "react";

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    const hasNetwork = state.isConnected === true;
    const canReachInternet = state.isInternetReachable !== false;

    setOnline(hasNetwork && canReachInternet);
  }),
);

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
