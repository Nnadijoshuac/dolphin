import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors } from "@/constants/theme";

const DIGITS = ["0", "1", "0", "1", "1", "0", "0", "1"] as const;

function MatrixDigit({ digit, index }: { digit: string; index: number }) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(
      80 + index * 160,
      withRepeat(
        withTiming(1, { duration: 1800, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [index, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion
      ? 0.62
      : interpolate(
          progress.value,
          [0, 0.2, 0.48, 0.5, 0.8, 1],
          [0, 0.82, 0.82, 0.24, 0.82, 0],
        ),
    transform: reduceMotion
      ? []
      : [
          {
            translateY: interpolate(progress.value, [0, 0.2, 0.8, 1], [-8, 0, 0, 8]),
          },
          { perspective: 90 },
          {
            rotateX: `${interpolate(progress.value, [0, 0.2, 0.8, 1], [90, 0, 0, -90])}deg`,
          },
        ],
  }));

  return (
    <Animated.Text
      style={[
        {
          width: 12,
          color: "#00C96F",
          fontFamily: "monospace",
          fontSize: 6.5,
          fontWeight: "700",
          lineHeight: 10,
          textAlign: "center",
          textShadowColor: "rgba(0, 255, 136, 0.72)",
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 3,
        },
        animatedStyle,
      ]}
    >
      {digit}
    </Animated.Text>
  );
}

function MatrixGlow() {
  const progress = useSharedValue(0.28);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(
      withTiming(0.72, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.36 : progress.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          inset: 1,
          borderRadius: 18,
          backgroundColor: "rgba(0, 255, 136, 0.11)",
        },
        animatedStyle,
      ]}
    />
  );
}

export function DolphinLoader({ label }: { label: string }) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <View
        style={{
          width: 36,
          height: 33,
          flexDirection: "row",
          flexWrap: "wrap",
          alignContent: "center",
          position: "relative",
        }}
      >
        <MatrixGlow />
        {DIGITS.map((digit, index) => (
          <MatrixDigit digit={digit} index={index} key={`${digit}-${index}`} />
        ))}
      </View>
      <Text style={{ fontSize: 13, color: colors.inkSecondary, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}
