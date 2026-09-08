import { ScrollView, Text } from "react-native";
import * as Haptics from "expo-haptics";

import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { CategoryFacet } from "@/hooks/use-agents";

interface CategoryRailProps {
  category: string | null;
  onSelectCategory: (category: string | null) => void;
  categories: CategoryFacet[];
}

/**
 * CategoryRail
 *
 * A clean, serene horizontal scroll rail purely for categories.
 * Free of kind pills or filter triggers, letting the user browse roles calmly.
 */
export function CategoryRail({
  category,
  onSelectCategory,
  categories,
}: CategoryRailProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerStyle={{
        paddingHorizontal: 16,
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* All Categories Pill */}
      <PressableScale
        accessibilityLabel="All categories"
        accessibilityRole="button"
        accessibilityState={{ selected: category === null }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onSelectCategory(null);
        }}
        containerStyle={{
          paddingVertical: 7,
          paddingHorizontal: 14,
          borderRadius: radii.pill,
          backgroundColor: category === null ? colors.ink : colors.surface,
          borderColor: category === null ? colors.ink : colors.line,
          borderWidth: 1,
          ...shadows.subtle,
        }}
      >
        <Text
          className="text-[12.5px]"
          style={{
            color: category === null ? colors.surface : colors.ink,
            fontWeight: category === null ? "700" : "500",
          }}
        >
          All
        </Text>
      </PressableScale>

      {/* Dynamic Category Chips */}
      {categories.map((facet) => {
        const isSelected = category === facet.slug;
        return (
          <PressableScale
            key={facet.slug}
            accessibilityLabel={`${facet.label}, ${facet.count} agents`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelectCategory(isSelected ? null : facet.slug);
            }}
            containerStyle={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingVertical: 7,
              paddingHorizontal: 13,
              borderRadius: radii.pill,
              backgroundColor: isSelected ? colors.ink : colors.surface,
              borderColor: isSelected ? colors.ink : colors.line,
              borderWidth: 1,
              ...shadows.subtle,
            }}
          >
            <Text
              className="text-[12.5px]"
              style={{
                color: isSelected ? colors.surface : colors.ink,
                fontWeight: isSelected ? "700" : "500",
              }}
            >
              {facet.label}
            </Text>
            <Text
              className="text-[11px] font-medium"
              style={{
                color: isSelected ? colors.surfaceMuted : colors.faint,
              }}
            >
              {facet.count}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

// Keep export alias for any callers
export { CategoryRail as CatalogFilterRail };
