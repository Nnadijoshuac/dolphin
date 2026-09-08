import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { AgentProtocol, CategoryFacet } from "@/hooks/use-agents";

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  protocol: AgentProtocol | null;
  onSelectProtocol: (protocol: AgentProtocol | null) => void;
  category: string | null;
  onSelectCategory: (category: string | null) => void;
  categories: CategoryFacet[];
  onResetAll?: () => void;
}

function FilterSheetContent({
  onClose,
  protocol,
  onSelectProtocol,
  category,
  onSelectCategory,
  categories,
  onResetAll,
}: Omit<FilterSheetProps, "visible">) {
  // Local draft state initialized on mount so user can adjust peacefully
  const [draftProtocol, setDraftProtocol] = useState<AgentProtocol | null>(protocol);
  const [draftCategory, setDraftCategory] = useState<string | null>(category);

  const activeCount = useMemo(() => {
    let count = 0;
    if (draftProtocol !== null) count += 1;
    if (draftCategory !== null) count += 1;
    return count;
  }, [draftProtocol, draftCategory]);

  const handleApply = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelectProtocol(draftProtocol);
    onSelectCategory(draftCategory);
    onClose();
  };

  const handleReset = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraftProtocol(null);
    setDraftCategory(null);
    if (onResetAll) {
      onResetAll();
    }
  };

  const protocolOptions = [
    {
      value: null,
      title: "All agents",
      badge: "Everything",
      desc: "All verified agents across protocols",
      glyph: "layers" as const,
    },
    {
      value: "a2a" as const,
      title: "Hireable tasks",
      badge: "A2A · Escrow",
      desc: "Commission tasks paid via ERC-8183 escrow",
      glyph: "sparkle" as const,
    },
    {
      value: "mcp" as const,
      title: "Direct tools",
      badge: "MCP · Free",
      desc: "Free callable tools for Cursor, Claude & bots",
      glyph: "copy" as const,
    },
  ];

  return (
    <View className="flex-1 justify-end" style={{ backgroundColor: colors.overlay }}>
      {/* Backdrop dismiss pressable */}
      <Pressable
        accessibilityLabel="Dismiss filters"
        className="flex-1"
        onPress={onClose}
      />

      <View
        className="px-5 pt-3 pb-8 max-h-[85%]"
        style={{
          backgroundColor: colors.canvas,
          borderTopLeftRadius: radii.xl,
          borderTopRightRadius: radii.xl,
          ...shadows.floating,
        }}
      >
        {/* Subtle drag handle */}
        <View
          className="self-center rounded-full mb-3"
          style={{ backgroundColor: colors.line, height: 4, width: 38 }}
        />

        {/* Sheet Header */}
        <View className="flex-row items-center justify-between pb-3.5 border-b" style={{ borderColor: colors.line }}>
          <View className="flex-row items-center gap-2">
            <Text
              className="text-[19px] font-bold tracking-tight"
              style={{ color: colors.ink }}
            >
              Filters
            </Text>
            {activeCount > 0 ? (
              <View
                className="px-2 py-0.5 rounded-full"
                style={{ backgroundColor: colors.goldSoft }}
              >
                <Text className="text-[11px] font-bold" style={{ color: colors.goldDark }}>
                  {activeCount} active
                </Text>
              </View>
            ) : null}
          </View>

          <PressableScale
            accessibilityLabel="Close filter sheet"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            containerStyle={{
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              width: 32,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="close" size={14} />
          </PressableScale>
        </View>

        <ScrollView
          className="mt-4"
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Section 1: Agent Kind / Protocol */}
          <View className="mb-6">
            <View className="mb-2.5">
              <Text
                className="text-[13px] font-bold uppercase tracking-wider"
                style={{ color: colors.muted }}
              >
                Agent Kind
              </Text>
              <Text className="text-[12px] mt-0.5" style={{ color: colors.faint }}>
                Choose how you want to interact with agents
              </Text>
            </View>

            <View className="gap-2">
              {protocolOptions.map((opt) => {
                const isSelected = draftProtocol === opt.value;
                return (
                  <PressableScale
                    key={opt.title}
                    accessibilityLabel={`${opt.title}, ${opt.badge}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDraftProtocol(opt.value);
                    }}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 11,
                      paddingHorizontal: 13,
                      borderRadius: radii.medium,
                      backgroundColor: isSelected ? colors.goldSoft : colors.surface,
                      borderColor: isSelected ? colors.gold : colors.line,
                      borderWidth: isSelected ? 1.5 : 1,
                      ...shadows.subtle,
                    }}
                  >
                    <View
                      className="h-9 w-9 rounded-xl items-center justify-center mr-3"
                      style={{
                        backgroundColor: isSelected ? colors.gold : colors.surfaceSubtle,
                      }}
                    >
                      <CategoryGlyph
                        color={isSelected ? colors.ink : colors.muted}
                        name={opt.glyph}
                        size={18}
                      />
                    </View>

                    <View className="flex-1 mr-2">
                      <View className="flex-row items-center gap-2">
                        <Text
                          className="text-[14px]"
                          style={{
                            color: colors.ink,
                            fontWeight: isSelected ? "700" : "600",
                          }}
                        >
                          {opt.title}
                        </Text>
                        <View
                          className="px-1.5 py-0.5 rounded-md"
                          style={{
                            backgroundColor: isSelected ? colors.surface : colors.surfaceSubtle,
                          }}
                        >
                          <Text
                            className="text-[10px] font-semibold"
                            style={{ color: isSelected ? colors.goldDark : colors.muted }}
                          >
                            {opt.badge}
                          </Text>
                        </View>
                      </View>
                      <Text
                        className="text-[11.5px] mt-0.5"
                        numberOfLines={1}
                        style={{ color: colors.muted }}
                      >
                        {opt.desc}
                      </Text>
                    </View>

                    {/* Selection Radio Circle */}
                    <View
                      className="h-5 w-5 rounded-full items-center justify-center"
                      style={{
                        borderColor: isSelected ? colors.goldDark : colors.line,
                        borderWidth: isSelected ? 2 : 1.5,
                        backgroundColor: isSelected ? colors.gold : colors.surface,
                      }}
                    >
                      {isSelected ? (
                        <CategoryGlyph color={colors.ink} name="check" size={11} strokeWidth={2.5} />
                      ) : null}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {/* Section 2: Categories */}
          <View className="mb-4">
            <View className="mb-2.5">
              <Text
                className="text-[13px] font-bold uppercase tracking-wider"
                style={{ color: colors.muted }}
              >
                Category
              </Text>
              <Text className="text-[12px] mt-0.5" style={{ color: colors.faint }}>
                Filter by role or area of expertise
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-2">
              {/* All categories chip */}
              <PressableScale
                accessibilityLabel="All categories"
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDraftCategory(null);
                }}
                containerStyle={{
                  paddingVertical: 7,
                  paddingHorizontal: 13,
                  borderRadius: radii.pill,
                  backgroundColor: draftCategory === null ? colors.ink : colors.surface,
                  borderColor: draftCategory === null ? colors.ink : colors.line,
                  borderWidth: 1,
                  ...shadows.subtle,
                }}
              >
                <Text
                  className="text-[12.5px] font-semibold"
                  style={{ color: draftCategory === null ? colors.surface : colors.ink }}
                >
                  All categories
                </Text>
              </PressableScale>

              {categories.map((cat) => {
                const isSelected = draftCategory === cat.slug;
                return (
                  <PressableScale
                    key={cat.slug}
                    accessibilityLabel={`${cat.label}, ${cat.count} agents`}
                    accessibilityRole="button"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDraftCategory(isSelected ? null : cat.slug);
                    }}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
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
                      className="text-[12.5px] font-semibold"
                      style={{ color: isSelected ? colors.surface : colors.ink }}
                    >
                      {cat.label}
                    </Text>
                    <Text
                      className="text-[11px] font-medium"
                      style={{
                        color: isSelected ? colors.surfaceMuted : colors.faint,
                      }}
                    >
                      {cat.count}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Footer Actions */}
        <View
          className="pt-3 border-t flex-row items-center gap-3"
          style={{ borderColor: colors.line }}
        >
          {draftProtocol !== null || draftCategory !== null ? (
            <PressableScale
              accessibilityLabel="Reset all filters"
              accessibilityRole="button"
              onPress={handleReset}
              containerStyle={{
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: radii.pill,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text className="text-[13.5px] font-semibold" style={{ color: colors.muted }}>
                Reset all
              </Text>
            </PressableScale>
          ) : null}

          <PressableScale
            accessibilityLabel="Apply filters"
            accessibilityRole="button"
            onPress={handleApply}
            style={{ flex: 1 }}
            containerStyle={{
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.gold,
              borderRadius: radii.pill,
              height: 46,
              ...shadows.goldGlow,
            }}
          >
            <Text className="text-[14.5px] font-bold" style={{ color: colors.ink }}>
              Apply Filters
            </Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

/**
 * FilterSheet
 *
 * A tranquil, tactile bottom sheet for filtering the Dolphin catalog.
 * Avoids cascading renders and state syncing by mounting the content
 * with initial values when opened.
 */
export function FilterSheet(props: FilterSheetProps) {
  if (!props.visible) return null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible={props.visible}
    >
      <FilterSheetContent {...props} />
    </Modal>
  );
}
