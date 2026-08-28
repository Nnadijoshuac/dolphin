import { View } from "react-native";
import { Image } from "expo-image";
import { CategoryGlyph } from "@/components/category-glyph";
import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

const categoryBackgrounds: Record<AgentCategory, string> = {
  monitoring: "#F5F3EB",
  "grid-trading": "#FAF5E6",
  "health-factor": "#F9F3F0",
  yield: "#F0F7F2",
};

const categoryIconColors: Record<AgentCategory, string> = {
  monitoring: colors.ink,
  "grid-trading": colors.ink,
  "health-factor": colors.ink,
  yield: colors.ink,
};

type AgentIconProps = {
  category: AgentCategory;
  uri?: string | null;
  size?: number;
};

export function AgentIcon({ category, uri, size = 60 }: AgentIconProps) {
  const borderRadius = Math.round(size * 0.32);
  const shell = {
    width: size,
    height: size,
    borderRadius,
    backgroundColor: categoryBackgrounds[category] ?? "#F5F3EB",
    borderWidth: 1,
    borderColor: "#EFECE4",
    overflow: "hidden" as const,
  };

  if (uri) {
    return (
      <Image
        accessibilityLabel={`${category} agent icon`}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri }}
        style={shell}
        transition={180}
      />
    );
  }

  return (
    <View className="items-center justify-center relative" style={shell}>
      <CategoryGlyph
        color={categoryIconColors[category]}
        name={category}
        size={Math.round(size * 0.44)}
      />
      {/* Little gold accent dot */}
      <View
        className="absolute h-2 w-2 rounded-full"
        style={{
          backgroundColor: colors.gold,
          top: size * 0.15,
          right: size * 0.15,
        }}
      />
    </View>
  );
}
