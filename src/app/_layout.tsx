import "../../global.css";

import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";

import { colors } from "@/constants/theme";
import { AppProviders } from "@/providers/app-providers";
import { SplashScreenView } from "@/components/splash-screen-view";
import { useAppStore } from "@/store/use-app-store";

void SystemUI.setBackgroundColorAsync(colors.canvas).catch(() => {});
void SplashScreen.preventAutoHideAsync().catch(() => {});

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
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [hasHydrated]);

  return (
    // Edge-to-edge is mandatory from SDK 55, so the status bar is transparent
    // and the app draws underneath it. Anything the app does not paint there
    // falls through to the host window's decor background, which is black in
    // Expo Go - that is what showed above the header.
    //
    // SystemUI.setBackgroundColorAsync above targets the activity's root view,
    // which Expo Go owns, so it cannot be relied on there. This view is the
    // app's own full-window surface: it spans the whole window including the
    // status bar strip, and every screen's SafeAreaView still insets its
    // content below the bar as before.
    <View style={{ backgroundColor: colors.canvas, flex: 1 }}>
      <StatusBar hidden={false} style="dark" />
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
