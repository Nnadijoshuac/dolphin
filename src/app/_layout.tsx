import "../../global.css";

import { useEffect, useState } from "react";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import { colors } from "@/constants/theme";
import { AppProviders } from "@/providers/app-providers";
import { useAppStore } from "@/store/use-app-store";

void SplashScreen.preventAutoHideAsync().catch(() => {});

function NavigationGate() {
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const hasCompletedOnboarding = useAppStore(
    (state) => state.hasCompletedOnboarding,
  );
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    const unsubscribe = useAppStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });

    if (useAppStore.persist.hasHydrated()) {
      setHasHydrated(true);
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!hasHydrated || !navigationState?.key) return;

    const isOnboarding = (segments as readonly string[])[0] === "onboarding";

    if (!hasCompletedOnboarding && !isOnboarding) {
      router.replace("/onboarding" as any);
    }

    void SplashScreen.hideAsync().catch(() => {});
  }, [hasCompletedOnboarding, hasHydrated, navigationState?.key, router, segments]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          animation: "slide_from_right",
          contentStyle: { backgroundColor: colors.canvas },
          headerShown: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding/index" options={{ animation: "fade" }} />
        <Stack.Screen name="agent/[id]" />
        <Stack.Screen name="category/[slug]" />
        <Stack.Screen
          name="hire/[id]"
          options={{ animation: "slide_from_bottom", presentation: "modal" }}
        />
        <Stack.Screen name="manage/[id]" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <NavigationGate />
    </AppProviders>
  );
}
