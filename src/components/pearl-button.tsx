import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

export type PearlButtonSize = "sm" | "md" | "lg";

/**
 * The label colour on the pearl, exported so an `icon` passed in from a call
 * site can match it.
 *
 * The pearl is dark, and every other button on these screens is light, so a
 * glyph tinted with the usual `colors.ink` disappears on it. Exporting the
 * value rather than repeating the hex is what stops the two drifting the next
 * time the finish is retuned.
 */
export const PEARL_LABEL_COLOR = "#FFE7FF";

export type PearlButtonProps = {
  label: string;
  onPress?: () => void;
  size?: PearlButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  accessibilityLabel?: string;
};

const SIZES = {
  sm: {
    height: 30,
    paddingHorizontal: 12,
    fontSize: 12,
    gap: 5,
    minWidth: 64,
  },
  md: {
    height: 42,
    paddingHorizontal: 18,
    fontSize: 14,
    gap: 7,
    minWidth: 100,
  },
  lg: {
    height: 52,
    paddingHorizontal: 24,
    fontSize: 16,
    gap: 8,
    minWidth: 130,
  },
} as const;

/**
 * PearlButton — Luxury dark pearl pill button with inset reflections
 * and dynamic gloss sheen.
 */
export function PearlButton({
  label,
  onPress,
  size = "md",
  disabled = false,
  loading = false,
  icon,
  iconRight,
  style,
  accessibilityHint,
  accessibilityLabel,
}: PearlButtonProps) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
  }));

  const config = SIZES[size];

  const content = (
    <View
      style={[
        styles.outerContainer,
        {
          minHeight: config.height,
          minWidth: config.minWidth,
          paddingHorizontal: config.paddingHorizontal,
        },
      ]}
    >
      {/* 1. Upper dome background highlight (::before) */}
      <View
        pointerEvents="none"
        style={styles.domeHighlight}
      />

      {/* 2. Top specular gloss gradient (::after) */}
      <LinearGradient
        colors={[
          "rgba(255, 255, 255, 0.32)",
          "rgba(255, 255, 255, 0.08)",
          "rgba(0, 0, 0, 0)",
        ]}
        end={{ x: 0.5, y: 1 }}
        locations={[0, 0.45, 1]}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={styles.glossSheen}
      />

      {/* 3. Bottom rim subtle reflection */}
      <LinearGradient
        colors={["rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0.22)"]}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={styles.bottomRim}
      />

      {/* 4. Content */}
      <View
        style={[
          styles.contentRow,
          { gap: config.gap },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFE7FF" size="small" />
        ) : (
          <>
            {icon}
            <Text
              numberOfLines={1}
              style={[
                styles.labelText,
                { fontSize: config.fontSize },
              ]}
            >
              {label}
            </Text>
            {iconRight}
          </>
        )}
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View pointerEvents="none" style={[styles.wrapper, style]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      onPressIn={() => {
        scale.set(withSpring(0.97, { damping: 18, stiffness: 280 }));
        translateY.set(withSpring(2, { damping: 18, stiffness: 280 }));
      }}
      onPressOut={() => {
        scale.set(withSpring(1, { damping: 18, stiffness: 280 }));
        translateY.set(withSpring(0, { damping: 18, stiffness: 280 }));
      }}
      style={[styles.wrapper, { opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Animated.View style={animatedStyle}>{content}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  outerContainer: {
    alignItems: "center",
    backgroundColor: "#080808",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderTopColor: "rgba(255, 255, 255, 0.36)",
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  domeHighlight: {
    backgroundColor: "rgba(255, 255, 255, 0.11)",
    borderRadius: 9999,
    bottom: "25%",
    height: "160%",
    left: "-15%",
    position: "absolute",
    right: "-15%",
    top: "-90%",
  },
  glossSheen: {
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 9999,
    borderTopRightRadius: 9999,
    height: "45%",
    left: "6%",
    position: "absolute",
    right: "6%",
    top: 1,
  },
  bottomRim: {
    borderRadius: 9999,
    bottom: 0,
    height: 2,
    left: "14%",
    position: "absolute",
    right: "14%",
  },
  contentRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    zIndex: 1,
  },
  labelText: {
    color: PEARL_LABEL_COLOR,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
