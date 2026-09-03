import { Text, View } from "react-native";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

const backgrounds: Record<AgentCategory, string> = {
  monitoring: colors.blue,
  rebalancing: colors.blue,
  "grid-trading": colors.goldSoft,
  "health-factor": colors.coral,
  yield: colors.mint,
  trading: colors.lilac,
};

type CategoryCardProps = {
  category: AgentCategory;
  label: string;
  description: string;
  count?: number;
  onPress: () => void;
};

export function CategoryCard({
  category,
  label,
  description,
  count,
  onPress,
}: CategoryCardProps) {
  return (
    <PressableScale
      accessibilityHint={`Browse all ${label} agents`}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        minHeight: 184,
        borderRadius: radii.large,
        backgroundColor: backgrounds[category],
        padding: 18,
      }}
    >
      <View
        className="items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 15,
          backgroundColor: "rgba(255,255,255,0.72)",
        }}
      >
        <CategoryGlyph name={category} size={23} />
      </View>
      <Text
        className="mt-5 text-[18px] font-bold tracking-[-0.45px]"
        style={{ color: colors.ink }}
      >
        {label}
      </Text>
      <Text
        className="mt-1.5 text-[12px] leading-[17px]"
        numberOfLines={2}
        style={{ color: colors.muted }}
      >
        {description}
      </Text>
      <Text
        className="mt-auto pt-3 text-[10px] font-bold uppercase tracking-[1.1px]"
        style={{ color: colors.muted }}
      >
        {typeof count === "number" ? `${count} indexed` : "Syncing catalog"}
      </Text>
    </PressableScale>
  );
}

