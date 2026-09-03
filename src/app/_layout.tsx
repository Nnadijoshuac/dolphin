import "../../global.css";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useSyncExternalStore } from "react";
import { Platform, StatusBar as RNStatusBar, View } from "react-native";

import { SplashScreenView } from "@/components/splash-screen-view";
import { colors } from "@/constants/theme";
import { AppProviders } from "@/providers/app-providers";
import { useAppStore } from "@/store/use-app-store";

// StatusBar.currentHeight is a static Android system value: always the correct
// status-bar pixel height, available without any provider or hook. Used by the
// scrim below to paint white behind the transparent status bar.
const STATUS_BAR_HEIGHT: number = Platform.select({
  android: RNStatusBar.currentHeight ?? 24,
  default: 0,
});

void SystemUI.setBackgroundColorAsync("#FFFFFF").catch(() => { });
void SplashScreen.preventAutoHideAsync().catch(() => { });

function RootNavigator() {
  // Zustand's persist rehydration is an external store, so read it with the
  // primitive built for that. The previous useState + useEffect version called
  // setState synchronously in the effect body, which eslint-plugin-react-hooks
  // 7 (SDK 57) reports as react-hooks/set-state-in-effect. It also had a real
  // gap: hydration finishing between first render and the effect running fired
  // onFinishHydration before we subscribed, and the state stayed false.
  // useSyncExternalStore re-reads the snapshot after subscribing, so it cannot
  // miss that transition.
  const hasHydrated = useSyncExternalStore(
    (onStoreChange) => useAppStore.persist.onFinishHydration(onStoreChange),
    () => useAppStore.persist.hasHydrated(),
    () => useAppStore.persist.hasHydrated(),
  );


  useEffect(() => {
    if (hasHydrated) {
      void SplashScreen.hideAsync().catch(() => { });
    }
  }, [hasHydrated]);

  return (
    // SDK 54→57 regression: edge-to-edge is now mandatory on Android, making
    // the status bar transparent. The Stack navigator's native container covers
    // the root View in the status bar region, and SystemUI has no effect in
    // Expo Go (host app owns the native window). The only reliable fix is a
    // React Native View rendered AFTER the Stack (so it's above it in paint
    // order) with pointerEvents="none" so it doesn't block touches.
    <View style={{ flex: 1 }}>
      <StatusBar hidden={false} style="light" />
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
      <SplashScreenView />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

