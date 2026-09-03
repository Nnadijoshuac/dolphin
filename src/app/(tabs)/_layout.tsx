import { useSyncExternalStore } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
// SDK 57: expo-router forked the React Navigation packages it wraps, so
// @react-navigation/bottom-tabs is no longer installed. Both the Tabs
// navigator and its tab-bar prop types now come from expo-router/js-tabs -
// the root `Tabs` export is deprecated in favour of this subpath.
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

function FloatingIslandTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomOffset = insets.bottom > 0 ? insets.bottom + 8 : 20;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 50,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          width: "86%",
          maxWidth: 345,
          height: 62,
          backgroundColor:
            Platform.OS === "ios"
              ? "rgba(255, 255, 255, 0.45)"
              : "rgba(255, 255, 255, 0.94)",
          borderRadius: 31,
          borderWidth: 1.2,
          borderColor:
            Platform.OS === "ios"
              ? "rgba(255, 255, 255, 0.75)"
              : "rgba(17, 18, 20, 0.08)",
          shadowColor: "#111215",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.16,
          shadowRadius: 20,
          elevation: 12,
          paddingHorizontal: 6,
          overflow: "hidden",
        }}
      >
        <BlurView
          intensity={95}
          style={StyleSheet.absoluteFill}
          tint={Platform.OS === "ios" ? "systemThinMaterialLight" : "systemChromeMaterialLight"}
        />

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const onPress = () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const color = isFocused ? colors.goldDark : "#8C8E88";
          const glyphName =
            route.name === "index"
              ? "discover"
              : route.name === "search"
              ? "search"
              : route.name === "my-agents"
              ? "agents"
              : "wallet";

          return (
            <PressableScale
              key={route.key}
              accessibilityLabel={options.tabBarAccessibilityLabel || String(label)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              onPress={onPress}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", height: "100%" }}
              containerStyle={{ alignItems: "center", justifyContent: "center" }}
            >
              <CategoryGlyph color={color} name={glyphName as any} size={21} strokeWidth={isFocused ? 2.2 : 1.8} />
              <Text
                style={{
                  color,
                  fontSize: 10,
                  fontWeight: isFocused ? "800" : "600",
                  marginTop: 2,
                }}
              >
                {String(label)}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const hasCompletedOnboarding = useAppStore(
    (state) => state.hasCompletedOnboarding,
  );
  // Same rehydration read as the root layout - see src/app/_layout.tsx for why
  // this is useSyncExternalStore rather than useState + useEffect.
  const hasHydrated = useSyncExternalStore(
    (onStoreChange) => useAppStore.persist.onFinishHydration(onStoreChange),
    () => useAppStore.persist.hasHydrated(),
    () => useAppStore.persist.hasHydrated(),
  );

  if (!hasHydrated) {
    return null;
  }

  if (!hasCompletedOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Tabs
      tabBar={(props) => <FloatingIslandTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
        }}
      />
      <Tabs.Screen
        name="my-agents"
        options={{
          title: "My Agents",
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
        }}
      />
    </Tabs>
  );
}
