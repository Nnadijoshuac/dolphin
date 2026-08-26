import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  variant = "primary",
  style,
  accessibilityHint,
}: ButtonProps) {
  const isPrimary = variant === "primary";
  const isQuiet = variant === "quiet";
  const backgroundColor = isPrimary
    ? colors.ink
    : isQuiet
      ? "transparent"
      : colors.surface;
  const foregroundColor = isPrimary ? colors.surface : colors.ink;

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
          minHeight: 54,
          borderRadius: radii.pill,
          backgroundColor,
          borderColor: isQuiet ? "transparent" : isPrimary ? colors.ink : colors.line,
          borderWidth: isQuiet ? 0 : 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 22,
          ...(isPrimary ? shadows.card : {}),
        },
        style,
      ]}
    >
      <View className="flex-row items-center justify-center gap-2">
        {loading ? <ActivityIndicator color={foregroundColor} size="small" /> : icon}
        <Text
          style={{
            color: foregroundColor,
            fontSize: 15,
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

