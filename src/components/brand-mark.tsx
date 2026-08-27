import { View, Text, Image } from "react-native";
import { colors } from "@/constants/theme";

const dolphinLogo = require("../../assets/DolphinLogo.png");
const bnbLogo = require("../../assets/images/bnbLogo.png");

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
    <Image
      accessibilityLabel="BNB"
      source={bnbLogo}
      style={{
        width: size,
        height: size,
        resizeMode: "contain",
      }}
    />
  );
}

export function BnbBadge({ label = "on BNB Smart Chain" }: { label?: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <BnbLogo size={16} />
      <Text
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: colors.goldDark }}
      >
        {label}
      </Text>
    </View>
  );
}

