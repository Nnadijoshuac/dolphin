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
      {/*
       * `style` is the CONTENT colour, not the mode - the naming trips everyone.
       * "dark" means dark icons and clock, which is what a light-mode app needs;
       * "light" paints them white.
       *
       * This read `splashVisible ? "dark" : "light"`, so the moment the splash
       * finished the icons turned white on a #FBF9F4 canvas and effectively
       * disappeared. Dolphin is light-mode throughout - app.json pins
       * userInterfaceStyle "light", the splash is #F6F4EE, the canvas is
       * #FBF9F4, and BOTH expo-status-bar entries in app.json already say
       * "dark". Only this component disagreed with all of it.
       *
       * No condition, because there is nothing to switch between: the splash and
       * the app are the same cream family, so one value is correct for both.
       */}
      <StatusBar hidden={false} style="dark" />
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
