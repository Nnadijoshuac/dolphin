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

interface SmartFilterModalProps {
  visible: boolean;
  onClose: () => void;
  protocol: AgentProtocol | null;
  onSelectProtocol: (protocol: AgentProtocol | null) => void;
  category: string | null;
  onSelectCategory: (category: string | null) => void;
  categories: CategoryFacet[];
  onResetAll?: () => void;
}

interface SmartFilterModalContentProps extends Omit<SmartFilterModalProps, "visible"> {}

/**
 * SmartFilterModalContent
 *
 * Inner component mounted on modal open to cleanly manage draft state
 * without requiring cascading render effects.
 */
function SmartFilterModalContent({
  onClose,
  protocol,
  onSelectProtocol,
  category,
  onSelectCategory,
  categories,
  onResetAll,
}: SmartFilterModalContentProps) {
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

  // Smart preset handlers
  const handlePreset = (preset: "hire-ready" | "free-tools" | "defi" | "trading" | "all") => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    switch (preset) {
      case "hire-ready":
        setDraftProtocol("a2a");
        break;
      case "free-tools":
        setDraftProtocol("mcp");
        break;
      case "defi": {
        const defiCat = categories.find((c) =>
          c.slug.includes("defi") || c.slug.includes("yield") || c.slug.includes("lend")
        );
        if (defiCat) setDraftCategory(defiCat.slug);
        break;
      }
      case "trading": {
        const tradeCat = categories.find((c) =>
          c.slug.includes("trad") || c.slug.includes("rebalanc") || c.slug.includes("arbitrag")
        );
        if (tradeCat) setDraftCategory(tradeCat.slug);
        break;
      }
      case "all":
        setDraftProtocol(null);
        setDraftCategory(null);
        break;
    }
  };

  const smartPresets = [
    {
      id: "hire-ready" as const,
      label: "Hire Ready",
      icon: "sparkle" as const,
      isActive: draftProtocol === "a2a",
    },
    {
      id: "free-tools" as const,
      label: "Free Tools",
      icon: "copy" as const,
      isActive: draftProtocol === "mcp",
    },
    {
      id: "defi" as const,
      label: "DeFi & Yield",
      icon: "layers" as const,
      isActive: draftCategory?.includes("defi") || draftCategory?.includes("yield"),
    },
    {
      id: "trading" as const,
      label: "Trading Bots",
      icon: "refresh" as const,
      isActive: draftCategory?.includes("trad") || draftCategory?.includes("rebalanc"),
    },
  ];

  return (
    <View className="flex-1 justify-center items-center px-4" style={{ backgroundColor: colors.overlay }}>
      {/* Backdrop tap to close */}
      <Pressable
        accessibilityLabel="Dismiss modal backdrop"
        className="absolute inset-0"
        onPress={onClose}
      />

      {/* Floating Center Card */}
      <View
        className="w-full max-h-[84%] rounded-3xl overflow-hidden"
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          ...shadows.card,
        }}
      >
        {/* Modal Top Header */}
        <View
          className="px-5 pt-4 pb-3.5 flex-row items-center justify-between border-b"
          style={{ borderColor: colors.line, backgroundColor: colors.canvas }}
        >
          <View className="flex-row items-center gap-2">
            <View
              className="h-7 w-7 rounded-lg items-center justify-center"
              style={{ backgroundColor: colors.goldSoft }}
            >
              <CategoryGlyph color={colors.goldDark} name="sparkle" size={15} />
            </View>
            <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
              Smart Filters
            </Text>
            {activeCount > 0 ? (
              <View
                className="px-2 py-0.5 rounded-full"
                style={{ backgroundColor: colors.ink }}
              >
                <Text className="text-[10.5px] font-bold text-white">
                  {activeCount}
                </Text>
              </View>
            ) : null}
          </View>

          <PressableScale
            accessibilityLabel="Close filters"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            containerStyle={{
              height: 30,
              width: 30,
              borderRadius: 15,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              justifyContent: "center",
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="close" size={13} strokeWidth={2.2} />
          </PressableScale>
        </View>

        {/* Scrollable Modal Body */}
        <ScrollView
          className="px-5 pt-4"
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Section 1: 1-Tap Smart Presets */}
          <View className="mb-5">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Smart Intents
              </Text>
              <Text className="text-[11px] font-medium text-zinc-400">
                1-tap presets
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-5"
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
            >
              {smartPresets.map((preset) => {
                const active = Boolean(preset.isActive);
                return (
                  <PressableScale
                    key={preset.id}
                    accessibilityLabel={preset.label}
                    accessibilityRole="button"
                    onPress={() => handlePreset(preset.id)}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radii.pill,
                      backgroundColor: active ? colors.goldSoft : colors.surfaceSubtle,
                      borderWidth: 1,
                      borderColor: active ? colors.gold : colors.line,
                      ...(active ? shadows.subtle : {}),
                    }}
                  >
                    <CategoryGlyph
                      color={active ? colors.goldDark : colors.muted}
                      name={preset.icon}
                      size={12}
                    />
                    <Text
                      className="text-[12px]"
                      style={{
                        color: active ? colors.ink : colors.inkSecondary,
                        fontWeight: active ? "700" : "500",
                      }}
                    >
                      {preset.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>

          {/* Section 2: Execution Mode (Capsule Segmented Controller) */}
          <View className="mb-5">
            <Text className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Execution Mode
            </Text>

            <View
              className="flex-row p-1 rounded-full"
              style={{ backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.line }}
            >
              {([
                { value: null, label: "All Agents" },
                { value: "a2a" as const, label: "Hire (A2A)" },
                { value: "mcp" as const, label: "Tools (MCP)" },
              ]).map((seg) => {
                const isSelected = draftProtocol === seg.value;
                return (
                  <PressableScale
                    key={seg.label}
                    accessibilityLabel={seg.label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDraftProtocol(seg.value);
                    }}
                    style={{ flex: 1 }}
                    containerStyle={{
                      paddingVertical: 7,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radii.pill,
                      backgroundColor: isSelected ? colors.ink : "transparent",
                    }}
                  >
                    <Text
                      className="text-[12.5px]"
                      style={{
                        color: isSelected ? colors.surface : colors.muted,
                        fontWeight: isSelected ? "700" : "500",
                      }}
                    >
                      {seg.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {/* Section 3: Role & Capabilities Matrix */}
          <View className="mb-3">
            <Text className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Role & Capability
            </Text>

            <View className="flex-row flex-wrap gap-2">
              {/* All Roles */}
              <PressableScale
                accessibilityLabel="All roles"
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDraftCategory(null);
                }}
                containerStyle={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: radii.pill,
                  backgroundColor: draftCategory === null ? colors.ink : colors.surfaceSubtle,
                  borderWidth: 1,
                  borderColor: draftCategory === null ? colors.ink : colors.line,
                }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: draftCategory === null ? colors.surface : colors.ink }}
                >
                  All Roles
                </Text>
              </PressableScale>

              {categories.map((facet) => {
                const isSelected = draftCategory === facet.slug;
                return (
                  <PressableScale
                    key={facet.slug}
                    accessibilityLabel={`${facet.label}, ${facet.count} agents`}
                    accessibilityRole="button"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDraftCategory(isSelected ? null : facet.slug);
                    }}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radii.pill,
                      backgroundColor: isSelected ? colors.gold : colors.surfaceSubtle,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.goldBorder : colors.line,
                      ...(isSelected ? shadows.goldGlow : {}),
                    }}
                  >
                    <CategoryGlyph
                      color={isSelected ? colors.ink : colors.muted}
                      name={facet.slug}
                      size={13}
                    />
                    <Text
                      className="text-[12px]"
                      style={{
                        color: colors.ink,
                        fontWeight: isSelected ? "700" : "500",
                      }}
                    >
                      {facet.label}
                    </Text>
                    <Text
                      className="text-[10.5px]"
                      style={{
                        color: isSelected ? colors.goldDark : colors.faint,
                        fontWeight: "600",
                      }}
                    >
                      {facet.count}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Modal Bottom Action Bar */}
        <View
          className="p-4 border-t flex-row items-center gap-3"
          style={{ borderColor: colors.line, backgroundColor: colors.canvas }}
        >
          {draftProtocol !== null || draftCategory !== null ? (
            <PressableScale
              accessibilityLabel="Reset filters"
              accessibilityRole="button"
              onPress={handleReset}
              containerStyle={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radii.pill,
              }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: colors.muted }}>
                Reset
              </Text>
            </PressableScale>
          ) : null}

          <PressableScale
            accessibilityLabel="Apply smart filters"
            accessibilityRole="button"
            onPress={handleApply}
            style={{ flex: 1 }}
            containerStyle={{
              height: 44,
              borderRadius: radii.pill,
              backgroundColor: colors.gold,
              alignItems: "center",
              justifyContent: "center",
              ...shadows.goldGlow,
            }}
          >
            <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
              Apply Filters
            </Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

/**
 * SmartFilterModal
 *
 * A floating, centered modal with high-tech smart presets, segmented execution
 * switch, and a visual capability matrix.
 */
export function SmartFilterModal(props: SmartFilterModalProps) {
  if (!props.visible) return null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={props.onClose}
      transparent
      visible={props.visible}
    >
      <SmartFilterModalContent {...props} />
    </Modal>
  );
}
