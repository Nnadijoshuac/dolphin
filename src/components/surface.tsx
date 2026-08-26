import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { colors, radii, shadows } from "@/constants/theme";

type SurfaceProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  gradient?: boolean;
}>;

export function Surface({
  children,
  style,
  padded = true,
  gradient = false,
}: SurfaceProps) {
  const sharedStyle: StyleProp<ViewStyle> = [
    {
      borderRadius: radii.large,
      borderColor: colors.line,
      borderWidth: 1,
      overflow: "hidden",
      padding: padded ? 20 : 0,
      ...shadows.card,
    },
    style,
  ];

  if (gradient) {
    return (
      <LinearGradient
        colors={[colors.surface, "#FFF9E8"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={sharedStyle}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <View style={[sharedStyle, { backgroundColor: colors.surface }]}>{children}</View>
  );
}

