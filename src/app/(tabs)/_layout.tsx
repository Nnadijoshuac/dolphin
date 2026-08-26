import { StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";

import { CategoryGlyph } from "@/components/category-glyph";
import { colors } from "@/constants/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: "#8C8E88",
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          paddingTop: 1,
        },
        tabBarStyle: {
          position: "absolute",
          height: 78,
          paddingTop: 8,
          paddingBottom: 9,
          borderTopColor: "rgba(17,18,20,0.08)",
          backgroundColor: "transparent",
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView intensity={72} style={StyleSheet.absoluteFill} tint="systemChromeMaterialLight" />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, size }) => (
            <CategoryGlyph color={color} name="discover" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: "Categories",
          tabBarIcon: ({ color, size }) => (
            <CategoryGlyph color={color} name="grid-trading" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => (
            <CategoryGlyph color={color} name="search" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-agents"
        options={{
          title: "My Agents",
          tabBarIcon: ({ color, size }) => (
            <CategoryGlyph color={color} name="agents" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, size }) => (
            <CategoryGlyph color={color} name="wallet" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

