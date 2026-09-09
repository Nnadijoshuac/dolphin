import { useMemo } from "react";
import { useWindowDimensions, View } from "react-native";

import { colors } from "@/constants/theme";

const GRID_X = 20;
const GRID_Y = 30;
const GRID_HEIGHT = 420;

/** A lightweight native approximation of the masked CSS grid used on web. */
export function DolphinGridBackground() {
  const { width } = useWindowDimensions();
  const verticalLines = useMemo(
    () => Array.from({ length: Math.ceil(width / GRID_X) + 1 }, (_, index) => index),
    [width],
  );
  const horizontalLines = useMemo(
    () => Array.from({ length: Math.ceil(GRID_HEIGHT / GRID_Y) + 1 }, (_, index) => index),
    [],
  );

  return (
    <View pointerEvents="none" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {verticalLines.map((index) => {
        const x = index * GRID_X;
        const edgeDistance = Math.min(1, Math.abs(x - width / 2) / Math.max(width / 2, 1));
        return (
          <View
            key={`x-${index}`}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: 1,
              height: GRID_HEIGHT * (1 - edgeDistance * 0.42),
              backgroundColor: colors.line,
              opacity: 0.72 * (1 - edgeDistance * 0.7),
            }}
          />
        );
      })}
      {horizontalLines.map((index) => {
        const y = index * GRID_Y;
        const progress = y / GRID_HEIGHT;
        const lineWidth = width * (0.96 - progress * 0.38);
        return (
          <View
            key={`y-${index}`}
            style={{
              position: "absolute",
              left: (width - lineWidth) / 2,
              top: y,
              width: lineWidth,
              height: 1,
              backgroundColor: colors.line,
              opacity: 0.72 * (1 - progress),
            }}
          />
        );
      })}
    </View>
  );
}
