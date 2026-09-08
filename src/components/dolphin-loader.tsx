import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors } from "@/constants/theme";

/**
 * Dolphin is working.
 *
 * The web build of this (web/src/components/dolphin-loader.module.css) is three
 * nested rings tumbling in perspective, each a beat behind the last. This is
 * the same design expressed in Reanimated, which is the stack's animation
 * library - the CSS version cannot cross over, but the motion can.
 *
 * Deliberately NOT an ActivityIndicator. A spinner says "something is
 * happening"; this is shown while Dolphin is doing something specific and
 * comparatively slow - waiting on strangers' servers - and the label says
 * which. Three rings turning at three speeds reads as work rather than a wait.
 */

const RINGS = [
  { size: 30, border: 10, color: colors.goldDark, delay: 0 },
  { size: 38, border: 7, color: colors.goldHover, delay: 75 },
  { size: 46, border: 5, color: colors.gold, delay: 150 },
] as const;

function Ring({
  size,
  border,
  color,
  delay,
}: {
  size: number;
  border: number;
  color: string;
  delay: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    // The stagger is what makes this read as one object tumbling rather than
    // three rings spinning independently.
    const timer = setTimeout(() => {
      progress.value = withRepeat(
        withTiming(1, { duration: 1000, easing: Easing.bezier(0.49, 0.06, 0.43, 0.85) }),
        -1,
        true,
      );
    }, delay);

    return () => {
      clearTimeout(timer);
      cancelAnimation(progress);
    };
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      // Perspective must come FIRST in a React Native transform array or the
      // rotations are applied flat and the whole 3D effect disappears.
      { perspective: 220 },
      { rotateX: `${24 - 4 * progress.value}deg` },
      { rotateY: "20deg" },
      { rotateZ: `${50 * progress.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          marginTop: -size / 2,
          marginLeft: -size / 2,
          top: "50%",
          left: "50%",
          borderRadius: size,
          borderWidth: border,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

export function DolphinLoader({ label }: { label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <View style={{ width: 52, height: 52 }}>
        {RINGS.map((ring) => (
          <Ring
            border={ring.border}
            color={ring.color}
            delay={ring.delay}
            key={ring.size}
            size={ring.size}
          />
        ))}
      </View>
      <Text style={{ fontSize: 13, color: colors.inkSecondary, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}
