import { View } from "react-native";
import { Image } from "expo-image";

import { CategoryGlyph } from "@/components/category-glyph";
import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

const categoryBackgrounds: Record<AgentCategory, string> = {
  monitoring: colors.blue,
  "grid-trading": colors.goldSoft,
  "health-factor": colors.coral,
  yield: colors.mint,
};

type AgentIconProps = {
  category: AgentCategory;
  uri?: string | null;
  size?: number;
};

export function AgentIcon({ category, uri, size = 58 }: AgentIconProps) {
  const shell = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
    backgroundColor: categoryBackgrounds[category],
    overflow: "hidden" as const,
  };

  if (uri) {
    return (
      <Image
        accessibilityLabel={`${category} agent icon`}
        contentFit="cover"
        source={{ uri }}
        style={shell}
        transition={180}
      />
    );
  }

  return (
    <View className="items-center justify-center" style={shell}>
      <CategoryGlyph name={category} size={Math.round(size * 0.46)} />
    </View>
  );
}

