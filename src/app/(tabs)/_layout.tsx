import { BlurView } from "expo-blur";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
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

  const bottomOffset = insets.bottom > 0 ? insets.bottom + 6 : 18;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.goldDark,
        tabBarInactiveTintColor: "#8C8E88",
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 9.5,
          fontWeight: "700",
          marginTop: -2,
        },
        tabBarItemStyle: {
          paddingVertical: 5,
        },
        tabBarStyle: {
          position: "absolute",
          left: 54,
          right: 54,
          bottom: bottomOffset,
          height: 58,
          borderRadius: 29,
          borderWidth: 1.2,
          borderColor: "rgba(17,18,20,0.08)",
          backgroundColor: "rgba(255,255,255,0.92)",
          overflow: "hidden",
          shadowColor: "#111215",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.14,
          shadowRadius: 20,
          elevation: 10,
          paddingHorizontal: 2,
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
            <CategoryGlyph color={color} name="discover" size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="search" size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-agents"
        options={{
          title: "My Agents",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="agents" size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) => (
            <CategoryGlyph color={color} name="wallet" size={20} />
          ),
        }}
      />
    </Tabs>
  );
}
