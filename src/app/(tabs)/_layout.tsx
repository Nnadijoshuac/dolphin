import { useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
// SDK 57: expo-router forked the React Navigation packages it wraps, so
// @react-navigation/bottom-tabs is no longer installed. Both the Tabs
// navigator and its tab-bar prop types now come from expo-router/js-tabs -
// the root `Tabs` export is deprecated in favour of this subpath.
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

function FloatingIslandTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
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

          /*
           * Dolphin is not a peer tab - it is the primary action, and it is
           * drawn as a raised orb OUTSIDE this container. See the note where
           * that orb is rendered for why it cannot live in here.
           *
           * A flex:1 spacer still reserves its slot, so the four real tabs
           * distribute around it exactly as they would around a fifth item.
           */
          if (route.name === "dolphin") {
            return <View key={route.key} style={{ flex: 1 }} pointerEvents="none" />;
          }

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

      {/*
        THE DOLPHIN ORB.
        ---------------------------------------------------------------------
        Rendered here, as a sibling of the island rather than a child of it,
        and this is not a stylistic choice: the island sets
        `overflow: "hidden"` with `borderRadius: 31` to keep the BlurView from
        bleeding past its corners, so anything drawn inside it that breaks the
        baseline is CLIPPED. An orb that rises above the bar has to escape that
        container, and the outer wrapper - which is `pointerEvents="box-none"`
        and has no overflow rule - is where it can.

        It is deliberately not styled like the other four. Dolphin is the
        product's primary action, not a fifth section, and a peer-styled tab
        would say the opposite.
      */}
      <DolphinOrb state={state} navigation={navigation} />
    </View>
  );
}

/**
 * The raised centre action. Positioned over the island's middle slot, which the
 * spacer above reserves for it.
 */
function DolphinOrb({
  state,
  navigation,
}: Pick<BottomTabBarProps, "state" | "navigation">) {
  const index = state.routes.findIndex((route) => route.name === "dolphin");
  if (index < 0) return null;

  const isFocused = state.index === index;
  const route = state.routes[index];

  const onPress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        // Lifts the orb so it overlaps the island's top edge rather than
        // sitting on it. The island is 62 tall; 58 puts roughly a third of the
        // orb above the bar.
        bottom: 14,
        left: 0,
        right: 0,
        alignItems: "center",
      }}
    >
      <PressableScale
        accessibilityLabel="Dolphin"
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        onPress={onPress}
        containerStyle={{ alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: 29,
            backgroundColor: isFocused ? colors.goldHover : colors.gold,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 3,
            // Matches the island's own translucency so the orb reads as part
            // of the same object rather than floating in front of it.
            borderColor: Platform.OS === "ios" ? "rgba(255,255,255,0.85)" : "#FFFFFF",
            shadowColor: colors.goldDark,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.35,
            shadowRadius: 12,
            elevation: 14,
          }}
        >
          <BrandMark size={30} color={colors.ink} />
        </View>
      </PressableScale>
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
