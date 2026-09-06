import "../../global.css";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useCallback, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { SplashScreenView } from "@/components/splash-screen-view";
import { colors } from "@/constants/theme";
import { AppProviders } from "@/providers/app-providers";
import { useAppStore } from "@/store/use-app-store";

void SystemUI.setBackgroundColorAsync("#FFFFFF").catch(() => { });
void SplashScreen.preventAutoHideAsync().catch(() => { });

function revealAnimatedSplash() {
  return SplashScreen.hideAsync();
}

function RootNavigator() {
  const [splashVisible, setSplashVisible] = useState(true);
  const finishSplash = useCallback(() => setSplashVisible(false), []);
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

  return (
    <View style={{ flex: 1 }}>
      <StatusBar hidden={false} style={splashVisible ? "dark" : "light"} />
      <View
        accessibilityElementsHidden={splashVisible}
        importantForAccessibility={splashVisible ? "no-hide-descendants" : "auto"}
        pointerEvents={splashVisible ? "none" : "auto"}
        style={{ flex: 1 }}
      >
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
      </View>
      {splashVisible ? (
        <SplashScreenView
          isReady={hasHydrated}
          onReady={revealAnimatedSplash}
          onFinish={finishSplash}
        />
      ) : null}
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
