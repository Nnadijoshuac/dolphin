import Svg, { Circle, Path } from "react-native-svg";
import { View, Text } from "react-native";
import { colors } from "@/constants/theme";

type BrandMarkProps = {
  size?: number;
  color?: string;
  inverted?: boolean;
};

export function BrandMark({ size = 32, color, inverted = false }: BrandMarkProps) {
  const dolphinColor = color ?? (inverted ? colors.gold : colors.ink);

  return (
    <Svg
      accessibilityLabel="Dolphin"
      height={size}
      role="img"
      viewBox="0 0 100 100"
      width={size}
    >
      {/* Sleek Leaping Dolphin Silhouette */}
      <Path
        d="M20 72 C25 65, 30 50, 42 35 C52 23, 68 18, 85 24 C82 28, 77 31, 72 32 C78 34, 82 38, 84 44 C76 40, 68 41, 62 46 C54 52, 45 62, 38 68 C34 72, 28 75, 20 72 Z"
        fill={dolphinColor}
      />
      {/* Dolphin Fin */}
      <Path
        d="M48 42 C46 36, 44 28, 42 22 C50 25, 54 32, 54 38 Z"
        fill={dolphinColor}
      />
      {/* Dolphin Tail */}
      <Path
        d="M22 71 C16 75, 12 82, 10 88 C16 85, 22 84, 25 80 C26 84, 28 89, 32 92 C30 85, 27 78, 23 72 Z"
        fill={dolphinColor}
      />
      {/* Gold orbital dot / sparkle */}
      <Circle cx="82" cy="18" fill={colors.gold} r="4" />
      <Circle cx="28" cy="85" fill={colors.gold} r="3" />
    </Svg>
  );
}

export function BnbLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg height={size} viewBox="0 0 32 32" width={size}>
      {/* BNB Icon: 4 Diamond shapes in hexagonal arrangement */}
      <Path
        d="M16 3.5 L21.5 9 L16 14.5 L10.5 9 Z"
        fill={colors.gold}
      />
      <Path
        d="M6 13.5 L11.5 19 L6 24.5 L0.5 19 Z"
        fill={colors.gold}
      />
      <Path
        d="M26 13.5 L31.5 19 L26 24.5 L20.5 19 Z"
        fill={colors.gold}
      />
      <Path
        d="M16 20.5 L21.5 26 L16 31.5 L10.5 26 Z"
        fill={colors.gold}
      />
      <Path
        d="M16 11.5 L20.5 16 L16 20.5 L11.5 16 Z"
        fill={colors.gold}
      />
    </Svg>
  );
}

export function BnbBadge({ label = "on BNB Smart Chain" }: { label?: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <BnbLogo size={13} />
      <Text
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: colors.goldDark }}
      >
        {label}
      </Text>
    </View>
  );
}
