import { useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
// SDK 57: expo-router forked the React Navigation packages it wraps, so
// @react-navigation/bottom-tabs is no longer installed. Both the Tabs
// navigator and its tab-bar prop types now come from expo-router/js-tabs -
// the root `Tabs` export is deprecated in favour of this subpath.
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

import Svg, { Path } from "react-native-svg";

function SculptedTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const onShow = () => setKeyboardVisible(true);
    const onHide = () => setKeyboardVisible(false);

    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      onShow
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      onHide
    );

    const didShowSub =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidShow", onShow)
        : null;
    const didHideSub =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidHide", onHide)
        : null;

    return () => {
      showSub.remove();
      hideSub.remove();
      didShowSub?.remove();
      didHideSub?.remove();
    };
  }, []);

  const currentOptions = descriptors[state.routes[state.index].key]?.options;
  const tabBarStyle = StyleSheet.flatten(currentOptions?.tabBarStyle) as { display?: string } | undefined;
  if (isKeyboardVisible || tabBarStyle?.display === "none") {
    return null;
  }

  const bottomOffset = insets.bottom > 0 ? insets.bottom + 8 : 20;

  const renderTab = (routeIndex: number) => {
    const route = state.routes[routeIndex];
    if (!route) return null;
    const { options } = descriptors[route.key];
    const isFocused = state.index === routeIndex;
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
        containerStyle={{ alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: isFocused ? "#FFFFFF" : "transparent",
            alignItems: "center",
            justifyContent: "center",
            ...(isFocused
              ? {
                  shadowColor: "#000000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  elevation: 6,
                }
              : {}),
          }}
        >
          {route.name === "dolphin" ? (
            <BrandMark
              color={isFocused ? "#141416" : "#FFFFFF"}
              size={26}
            />
          ) : (
            <CategoryGlyph
              color={isFocused ? "#141416" : "#FFFFFF"}
              name={glyphName as any}
              size={21}
              strokeWidth={isFocused ? 2.3 : 1.9}
            />
          )}
        </View>
      </PressableScale>
    );
  };

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
          position: "relative",
          width: 348,
          height: 64,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 14 },
          shadowOpacity: 0.36,
          shadowRadius: 32,
          elevation: 14,
        }}
      >
        {/* The 3-lobed metaball SVG background with continuous curvature */}
        <Svg
          height={64}
          style={StyleSheet.absoluteFill}
          viewBox="0 0 348 64"
          width={348}
        >
          <Path
            d="M 27,5 L 120,5 C 132.00,5.00 143.44,21.59 148.61,14.22 A 31.0 31.0 0 0 1 199.39 14.22 C 204.56,21.59 216.00,5.00 228.00,5.00 L 321,5 C 336,5 346,16 346,32 C 346,48 336,59 321,59 L 228.00,59 C 216.00,59.00 204.56,42.41 199.39,49.78 A 31.0 31.0 0 0 1 148.61 49.78 C 143.44,42.41 132.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
            fill="#16171A"
          />
        </Svg>

        {/* Left Lobe: Discover (0) & Search (1) */}
        <View
          style={{
            width: 138,
            height: "100%",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 6,
            paddingRight: 14,
          }}
        >
          {renderTab(0)}
          {renderTab(1)}
        </View>

        {/* Center Lobe: Dolphin (2) */}
        <View
          style={{
            width: 72,
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderTab(2)}
        </View>

        {/* Right Lobe: My Agents (3) & Wallet (4) */}
        <View
          style={{
            width: 138,
            height: "100%",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 14,
            paddingRight: 6,
          }}
        >
          {renderTab(3)}
          {renderTab(4)}
        </View>
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
      tabBar={(props) => <SculptedTabBar {...props} />}
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
      {/*
        DECLARATION ORDER IS RENDER ORDER, and the orb is drawn over the slot
        this reserves - so Dolphin must be third of five for it to land in the
        middle of the island. Moving this line moves the button.
      */}
      <Tabs.Screen
        name="dolphin"
        options={{
          title: "Dolphin",
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
