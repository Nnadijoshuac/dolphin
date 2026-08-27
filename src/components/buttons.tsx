import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";

export type ButtonVariant = "primary" | "gold" | "dark" | "secondary" | "quiet" | "ghost" | "destructive";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  variant?: ButtonVariant;
  tone?: ButtonVariant;
  size?: "small" | "medium" | "large";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  iconRight,
  variant,
  tone,
  size = "medium",
  style,
  accessibilityHint,
}: ButtonProps) {
  const activeVariant: ButtonVariant = variant ?? tone ?? "primary";
  const isGold = activeVariant === "primary" || activeVariant === "gold";
  const isDark = activeVariant === "dark";
  const isQuiet = activeVariant === "quiet" || activeVariant === "ghost";
  const isDestructive = activeVariant === "destructive";

  const backgroundColor = isGold
    ? colors.gold
    : isDark
    ? colors.ink
    : isDestructive
    ? "#DC2626"
    : isQuiet
    ? "transparent"
    : colors.surface;

  const foregroundColor = isGold
    ? colors.ink
    : isDark || isDestructive
    ? "#FFFFFF"
    : isQuiet
    ? colors.inkSecondary
    : colors.ink;

  const borderColor = isDestructive
    ? "#DC2626"
    : isQuiet || isGold || isDark
    ? "transparent"
    : colors.line;

  const height = size === "small" ? 34 : size === "large" ? 56 : 50;
  const paddingX = size === "small" ? 14 : isQuiet ? 12 : 22;
  const fontSize = size === "small" ? 13 : 15;

  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={{ opacity: disabled ? 0.45 : 1 }}
      containerStyle={[
        {
          minHeight: height,
          borderRadius: radii.pill,
          backgroundColor,
          borderColor,
          borderWidth: isQuiet || isGold || isDark ? 0 : 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: paddingX,
          ...(isGold ? shadows.goldGlow : isDark ? shadows.card : isQuiet ? {} : shadows.subtle),
        },
        style,
      ]}
    >
      <View className="flex-row items-center justify-center gap-2">
        {loading ? <ActivityIndicator color={foregroundColor} size="small" /> : icon}
        <Text
          style={{
            color: foregroundColor,
            fontSize,
            fontWeight: "700",
            letterSpacing: -0.2,
          }}
        >
          {label}
        </Text>
        {iconRight}
      </View>
    </PressableScale>
  );
}
