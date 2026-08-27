import Svg, { Path } from "react-native-svg";
import { View, Text, Image } from "react-native";
import { colors } from "@/constants/theme";

const dolphinLogo = require("../../assets/DolphinLogo.png");

type BrandMarkProps = {
  size?: number;
  color?: string;
  inverted?: boolean;
};

export function BrandMark({ size = 32, color, inverted = false }: BrandMarkProps) {
  const tint = color ?? (inverted ? colors.gold : colors.ink);

  return (
    <Image
      accessibilityLabel="Dolphin"
      source={dolphinLogo}
      style={{
        width: size,
        height: size,
        tintColor: tint,
        resizeMode: "contain",
      }}
    />
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
