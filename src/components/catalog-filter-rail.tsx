import { ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { AgentProtocol, CategoryFacet } from "@/hooks/use-agents";

interface CatalogFilterRailProps {
  onOpenFilterModal: () => void;
  protocol: AgentProtocol | null;
  onSelectProtocol: (protocol: AgentProtocol | null) => void;
  category: string | null;
  onSelectCategory: (category: string | null) => void;
  categories: CategoryFacet[];
  activeFilterCount: number;
}

/**
 * CatalogFilterRail
 *
 * A serene, single-row horizontal scroll rail combining a dedicated FilterModal
 * trigger with instant 1-tap pills for Kind and Category. Gives users immediate,
 * calm control over the catalog without jarring page shifts or dual-row clutter.
 */
export function CatalogFilterRail({
  onOpenFilterModal,
  protocol,
  onSelectProtocol,
  category,
  onSelectCategory,
  categories,
  activeFilterCount,
}: CatalogFilterRailProps) {
  const hasActiveFilters = activeFilterCount > 0;

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
      {/* Deep Filter Modal Trigger */}
      <PressableScale
        accessibilityLabel={`All filters, ${activeFilterCount} active`}
        accessibilityRole="button"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onOpenFilterModal();
        }}
        containerStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: radii.pill,
          backgroundColor: hasActiveFilters ? colors.gold : colors.surface,
          borderColor: hasActiveFilters ? colors.goldBorder : colors.line,
          borderWidth: 1,
          ...(hasActiveFilters ? shadows.goldGlow : shadows.subtle),
        }}
      >
        <CategoryGlyph
          color={hasActiveFilters ? colors.ink : "#7A7C75"}
          name="filter"
          size={14}
        />
        <Text
          className="text-[12.5px]"
          style={{
            color: colors.ink,
            fontWeight: hasActiveFilters ? "700" : "600",
          }}
        >
          {hasActiveFilters ? `Filters (${activeFilterCount})` : "Filters"}
        </Text>
      </PressableScale>

      {/* Subtle Separator */}
      <View
        style={{
          width: 1,
          height: 18,
          backgroundColor: colors.line,
          marginHorizontal: 2,
        }}
      />

      {/* Quick Kind Pills */}
      {([
        { value: null, label: "All kinds" },
        { value: "a2a" as const, label: "Hire" },
        { value: "mcp" as const, label: "Tools" },
      ]).map((opt) => {
        const isSelected = protocol === opt.value;
        return (
          <PressableScale
            key={opt.label}
            accessibilityLabel={opt.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelectProtocol(opt.value);
            }}
            containerStyle={{
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
              {opt.label}
            </Text>
          </PressableScale>
        );
      })}

      {/* Subtle Separator if categories exist */}
      {categories.length > 0 ? (
        <View
          style={{
            width: 1,
            height: 18,
            backgroundColor: colors.line,
            marginHorizontal: 2,
          }}
        />
      ) : null}

      {/* Category Pills */}
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
