import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, Line } from "react-native-svg";
import { StyleSheet, View } from "react-native";
import { colors } from "@/constants/theme";

type ConstellationBgProps = {
  style?: StyleProp<ViewStyle>;
  opacity?: number;
  showCenterGlow?: boolean;
};

export function ConstellationBg({
  style,
  opacity = 0.5,
  showCenterGlow = false,
}: ConstellationBgProps) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: "hidden", opacity }, style]}
    >
      <Svg height="100%" viewBox="0 0 400 400" width="100%">
        {/* Outer Orbit Ellipse */}
        <Ellipse
          cx="200"
          cy="180"
          fill="none"
          rx="180"
          ry="90"
          stroke="#E8DFCA"
          strokeDasharray="4 6"
          strokeWidth="1"
          transform="rotate(-15 200 180)"
        />
        {/* Inner Orbit Ellipse */}
        <Ellipse
          cx="200"
          cy="180"
          fill="none"
          rx="130"
          ry="65"
          stroke="#DFD3B8"
          strokeWidth="1"
          transform="rotate(20 200 180)"
        />
        {/* Secondary Orbit */}
        <Ellipse
          cx="200"
          cy="180"
          fill="none"
          rx="80"
          ry="40"
          stroke="#F3E5AB"
          strokeWidth="1"
          transform="rotate(-35 200 180)"
        />

        {/* Small constellation star dots */}
        <Circle cx="320" cy="120" fill={colors.gold} r="3" />
        <Circle cx="80" cy="220" fill={colors.gold} r="2.5" />
        <Circle cx="260" cy="240" fill={colors.gold} r="2" />
        <Circle cx="130" cy="140" fill="#E8DFCA" r="2" />
        <Circle cx="220" cy="100" fill={colors.gold} r="3.5" />
        <Circle cx="350" cy="190" fill="#E8DFCA" r="2" />

        {/* Fine connecting grid lines */}
        <Line stroke="#F0EAE0" strokeWidth="0.8" x1="50" x2="350" y1="180" y2="180" />
        <Line stroke="#F0EAE0" strokeWidth="0.8" x1="200" x2="200" y1="50" y2="350" />

        {showCenterGlow ? (
          <Circle cx="200" cy="180" fill={colors.goldSoft} opacity={0.6} r="40" />
        ) : null}
      </Svg>
    </View>
  );
}
