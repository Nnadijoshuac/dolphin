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

import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

const TAB_X_OFFSETS = [6, 76, 150, 224, 294] as const;

function SculptedTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  const activeOffset = TAB_X_OFFSETS[state.index] ?? 6;
  const translateX = useSharedValue(activeOffset);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);

  useEffect(() => {
    translateX.set(
      withSpring(activeOffset, {
        damping: 13,
        stiffness: 170,
        mass: 0.9,
      })
    );
    scaleX.set(
      withSequence(
        withTiming(1.16, { duration: 110 }),
        withSpring(1, { damping: 10, stiffness: 180 })
      )
    );
    scaleY.set(
      withSequence(
        withTiming(0.86, { duration: 110 }),
        withSpring(1, { damping: 10, stiffness: 180 })
      )
    );
  }, [activeOffset, scaleX, scaleY, translateX]);

  const jellyAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
    ],
  }));

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
            backgroundColor: "transparent",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          }}
        >
          {route.name === "dolphin" ? (
            <BrandMark
              color={isFocused ? "#080808" : "#FFE7FF"}
              size={26}
            />
          ) : (
            <CategoryGlyph
              color={isFocused ? "#080808" : "#FFE7FF"}
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
          shadowOpacity: 0.45,
          shadowRadius: 24,
          elevation: 16,
        }}
      >
        {/* The 3-lobed metaball SVG background with continuous curvature & pearl obsidian material */}
        <Svg
          height={64}
          style={StyleSheet.absoluteFill}
          viewBox="0 0 348 64"
          width={348}
        >
          <Defs>
            {/* Pearl base: deep obsidian with metallic/pearl luster */}
            <LinearGradient id="pearl-base" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#1c1b22" />
              <Stop offset="25%" stopColor="#0a0a0c" />
              <Stop offset="75%" stopColor="#050506" />
              <Stop offset="100%" stopColor="#141318" />
            </LinearGradient>

            {/* Pearl rim: luminous top highlight, soft bottom reflection */}
            <LinearGradient id="pearl-rim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
              <Stop offset="20%" stopColor="rgba(255, 231, 255, 0.22)" />
              <Stop offset="80%" stopColor="rgba(0, 0, 0, 0.5)" />
              <Stop offset="100%" stopColor="rgba(255, 231, 255, 0.28)" />
            </LinearGradient>

            {/* Upper dome specular gloss sheen */}
            <LinearGradient id="pearl-gloss" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="rgba(255, 255, 255, 0.28)" />
              <Stop offset="40%" stopColor="rgba(255, 231, 255, 0.08)" />
              <Stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
            </LinearGradient>
          </Defs>

          <Path
            d="M 27,5 L 120,5 C 132.00,5.00 143.44,21.59 148.61,14.22 A 31.0 31.0 0 0 1 199.39 14.22 C 204.56,21.59 216.00,5.00 228.00,5.00 L 321,5 C 336,5 346,16 346,32 C 346,48 336,59 321,59 L 228.00,59 C 216.00,59.00 204.56,42.41 199.39,49.78 A 31.0 31.0 0 0 1 148.61 49.78 C 143.44,42.41 132.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
            fill="url(#pearl-base)"
            stroke="url(#pearl-rim)"
            strokeWidth={1.2}
          />
          <Path
            d="M 27,5 L 120,5 C 132.00,5.00 143.44,21.59 148.61,14.22 A 31.0 31.0 0 0 1 199.39 14.22 C 204.56,21.59 216.00,5.00 228.00,5.00 L 321,5 C 336,5 346,16 346,32 C 346,48 336,59 321,59 L 228.00,59 C 216.00,59.00 204.56,42.41 199.39,49.78 A 31.0 31.0 0 0 1 148.61 49.78 C 143.44,42.41 132.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
            fill="url(#pearl-gloss)"
            opacity={0.8}
          />
        </Svg>

        {/* Sliding Nano Jelly Active Pill */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 8,
              left: 0,
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "#FFFFFF",
              shadowColor: "#000000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 14,
              elevation: 8,
              zIndex: 1,
            },
            jellyAnimatedStyle,
          ]}
        />

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
            zIndex: 2,
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
            zIndex: 2,
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
            zIndex: 2,
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
