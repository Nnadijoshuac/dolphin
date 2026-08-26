import Svg, { Circle, Path } from "react-native-svg";

import { colors } from "@/constants/theme";

type BrandMarkProps = {
  size?: number;
  inverted?: boolean;
};

export function BrandMark({ size = 34, inverted = false }: BrandMarkProps) {
  const background = inverted ? colors.surface : colors.ink;
  const foreground = inverted ? colors.ink : colors.gold;

  return (
    <Svg
      accessibilityLabel="Dolphin"
      height={size}
      role="img"
      viewBox="0 0 40 40"
      width={size}
    >
      <Circle cx="20" cy="20" fill={background} r="20" />
      <Path
        d="M9.5 22.6c4.9-8.7 12-11.4 20.4-8.1-2.8.5-4.8 1.7-6 3.4 3.4-.1 5.8.9 7.3 3-4.1-1-7.1-.4-9.2 1.7-2.2 2.3-5.4 3.3-9.6 3l2.4-2.8c-1.8.5-3.6.4-5.3-.2Z"
        fill={foreground}
      />
      <Circle cx="20.2" cy="18" fill={background} r="1" />
    </Svg>
  );
}

