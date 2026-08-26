import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "ghost" | "destructive";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  variant?: ButtonVariant;
  tone?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  variant,
  tone,
  style,
  accessibilityHint,
}: ButtonProps) {
  const activeVariant: ButtonVariant = variant ?? tone ?? "primary";
  const isPrimary = activeVariant === "primary";
  const isQuiet = activeVariant === "quiet" || activeVariant === "ghost";
  const isDestructive = activeVariant === "destructive";

  const backgroundColor = isPrimary
    ? colors.ink
    : isDestructive
    ? "#DC2626"
    : isQuiet
    ? "transparent"
    : colors.surface;

  const foregroundColor =
    isPrimary || isDestructive ? "#FFFFFF" : isQuiet ? colors.muted : colors.ink;

  const borderColor = isDestructive
    ? "#DC2626"
    : isQuiet
    ? "transparent"
    : isPrimary
    ? colors.ink
    : colors.line;

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
          minHeight: isQuiet ? 40 : 52,
          borderRadius: radii.pill,
          backgroundColor,
          borderColor,
          borderWidth: isQuiet ? 0 : 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: isQuiet ? 14 : 22,
          ...(isPrimary || isDestructive ? shadows.card : {}),
        },
        style,
      ]}
    >
      <View className="flex-row items-center justify-center gap-2">
        {loading ? <ActivityIndicator color={foregroundColor} size="small" /> : icon}
        <Text
          style={{
            color: foregroundColor,
            fontSize: isQuiet ? 14 : 15,
            fontWeight: "700",
            letterSpacing: -0.15,
          }}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
