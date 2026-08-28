import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryGlyph } from "@/components/category-glyph";
import { colors } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
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

  if (!hasHydrated) {
    return null;
  }

  if (!hasCompletedOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  const bottomOffset = insets.bottom > 0 ? insets.bottom + 2 : 16;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.goldDark,
        tabBarInactiveTintColor: "#8C8E88",
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingVertical: 6,
        },
        tabBarStyle: {
          position: "absolute",
          left: 40,
          right: 40,
          bottom: bottomOffset,
          height: 60,
          borderRadius: 30,
          borderWidth: 1.2,
          borderColor: "rgba(17,18,20,0.08)",
          backgroundColor: "rgba(255,255,255,0.85)",
          overflow: "hidden",
          shadowColor: "#111215",
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.12,
          shadowRadius: 24,
          elevation: 8,
          paddingHorizontal: 4,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={80}
            style={StyleSheet.absoluteFill}
            tint="systemChromeMaterialLight"
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="discover" size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="search" size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-agents"
        options={{
          title: "My Agents",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="agents" size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="wallet" size={22} />
          ),
        }}
      />
    </Tabs>
  );
}
