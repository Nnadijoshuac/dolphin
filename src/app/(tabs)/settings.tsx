import { useState } from "react";
import {
  Alert,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";

import { BnbBadge } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { Surface } from "@/components/surface";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { useDolphinStore } from "@/stores/dolphin-store";
import type { AgentCategory } from "@/types/agent";

export default function SettingsScreen() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>("monitoring");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const { data: agents } = useAgents();
  const clearPreviewHires = useDolphinStore((state) => state.clearPreviewHires);
  const previewHires = useDolphinStore((state) => state.previewHires);

  const activeCategoryInfo = AGENT_CATEGORIES.find((c) => c.slug === selectedCategory)!;
  const categoryAgentCount = agents?.filter((a) => a.category === selectedCategory).length ?? 0;

  const handleCopy = async (text: string, label: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleClearPreviews = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Reset Local Previews",
      "Are you sure you want to clear all locally saved agent hire previews?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearPreviewHires();
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ConstellationBg opacity={0.3} />

      {/* Sticky Pinned Top Header */}
      <View
        className="px-6 pb-3 pt-2"
        style={{ backgroundColor: colors.canvas, zIndex: 10 }}
      >
        <Text
          className="text-[32px] font-bold tracking-[-0.6px]"
          style={{ color: colors.ink }}
        >
          Settings
        </Text>
        <Text className="mt-1 text-[14px]" style={{ color: colors.muted }}>
          App preferences, categories & BNB network
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-6 px-6">
          {/* Section: Categories Directory */}
          <View>
            <View className="mb-3 flex-row items-center justify-between">
              <View>
                <Text
                  className="text-[17px] font-bold tracking-tight"
                  style={{ color: colors.ink }}
                >
                  Agent Categories
                </Text>
                <Text className="text-[12px]" style={{ color: colors.muted }}>
                  Browse agent specializations and capabilities
                </Text>
              </View>

              <BnbBadge label="4 SPECIALIZATIONS" />
            </View>

            {/* Category Filter Chips */}
            <View className="flex-row flex-wrap gap-2 pb-3">
              {AGENT_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.slug;
                return (
                  <PressableScale
                    key={cat.slug}
                    accessibilityLabel={cat.label}
                    accessibilityRole="button"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedCategory(cat.slug);
                    }}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: radii.pill,
                      backgroundColor: isSelected ? colors.ink : colors.surface,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.ink : colors.line,
                      ...shadows.subtle,
                    }}
                  >
                    <CategoryGlyph
                      color={isSelected ? "#FFFFFF" : colors.ink}
                      name={cat.slug}
                      size={14}
                    />
                    <Text
                      className="text-[12px] font-bold"
                      style={{ color: isSelected ? "#FFFFFF" : colors.ink }}
                    >
                      {cat.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>

            {/* Selected Category Feature Card */}
            <Surface className="p-4.5">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <View className="flex-row items-center gap-2">
                    <CategoryGlyph name={activeCategoryInfo.slug} size={20} />
                    <Text
                      className="text-[16px] font-bold"
                      style={{ color: colors.ink }}
                    >
                      {activeCategoryInfo.label}
                    </Text>
                  </View>
                  <Text
                    className="mt-1.5 text-[13px] leading-5"
                    style={{ color: colors.muted }}
                  >
                    {activeCategoryInfo.desc}
                  </Text>
                </View>

                <View className="items-end">
                  <Text
                    className="text-[20px] font-black"
                    style={{ color: colors.goldDark }}
                  >
                    {categoryAgentCount}
                  </Text>
                  <Text className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Agents
                  </Text>
                </View>
              </View>

              <View className="mt-4 pt-3 border-t border-slate-100 flex-row items-center justify-between">
                <Text className="text-[12px] font-medium text-muted">
                  Explore full registry listing
                </Text>
                <PressableScale
                  accessibilityLabel={`Browse all ${activeCategoryInfo.label} agents`}
                  accessibilityRole="button"
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({
                      pathname: "/category/[slug]",
                      params: { slug: activeCategoryInfo.slug },
                    });
                  }}
                  containerStyle={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: colors.ink,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: radii.pill,
                  }}
                >
                  <Text className="text-[11px] font-bold text-white">
                    View Agents
                  </Text>
                  <CategoryGlyph color="#FFFFFF" name="arrow-right" size={12} />
                </PressableScale>
              </View>
            </Surface>
          </View>

          {/* Section: Network & Infrastructure */}
          <View>
            <Text
              className="mb-3 text-[17px] font-bold tracking-tight"
              style={{ color: colors.ink }}
            >
              Network & Protocol
            </Text>

            <Surface>
              {[
                {
                  label: "Chain",
                  value: "BNB Smart Chain (ID: 56)",
                  copyable: false,
                },
                {
                  label: "RPC Node",
                  value: "https://bsc-dataseed.bnbchain.org",
                  copyable: true,
                },
                {
                  label: "Registry Standard",
                  value: "ERC-8004 AI Agent Registry",
                  copyable: false,
                },
                {
                  label: "Indexing Engine",
                  value: "8004scan · Live Multicall",
                  copyable: false,
                },
              ].map((item, idx) => (
                <View
                  key={item.label}
                  className={`flex-row items-center justify-between py-3.5 ${
                    idx > 0 ? "border-t" : ""
                  }`}
                  style={{ borderColor: colors.lineLight }}
                >
                  <Text className="text-[13px]" style={{ color: colors.muted }}>
                    {item.label}
                  </Text>
                  <PressableScale
                    disabled={!item.copyable}
                    onPress={() => item.copyable && handleCopy(item.value, item.label)}
                    containerStyle={{ flexDirection: "row", items: "center", gap: 6 }}
                  >
                    <Text
                      className="text-[13px] font-semibold"
                      numberOfLines={1}
                      style={{
                        color: item.copyable ? colors.goldDark : colors.ink,
                        maxWidth: 200,
                      }}
                    >
                      {copiedText === item.label ? "Copied!" : item.value}
                    </Text>
                    {item.copyable ? (
                      <CategoryGlyph
                        color={colors.muted}
                        name={copiedText === item.label ? "check" : "copy"}
                        size={14}
                      />
                    ) : null}
                  </PressableScale>
                </View>
              ))}
            </Surface>
          </View>

          {/* Section: Storage & Session Controls */}
          <View>
            <Text
              className="mb-3 text-[17px] font-bold tracking-tight"
              style={{ color: colors.ink }}
            >
              Local Data
            </Text>

            <Surface className="p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-4">
                  <Text
                    className="text-[14px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    Saved Previews ({previewHires.length})
                  </Text>
                  <Text className="mt-0.5 text-[12px]" style={{ color: colors.muted }}>
                    Locally cached agent configurations on this device.
                  </Text>
                </View>

                <PressableScale
                  accessibilityLabel="Clear preview hires"
                  accessibilityRole="button"
                  disabled={previewHires.length === 0}
                  onPress={handleClearPreviews}
                  containerStyle={{
                    backgroundColor: previewHires.length > 0 ? "#FEE2E2" : colors.lineLight,
                    borderRadius: radii.pill,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    className="text-[12px] font-bold"
                    style={{
                      color: previewHires.length > 0 ? "#DC2626" : colors.muted,
                    }}
                  >
                    Reset
                  </Text>
                </PressableScale>
              </View>
            </Surface>
          </View>

          {/* Section: About */}
          <View>
            <Text
              className="mb-3 text-[17px] font-bold tracking-tight"
              style={{ color: colors.ink }}
            >
              About Dolphin
            </Text>

            <Surface className="p-4">
              <View className="flex-row items-center justify-between pb-3 border-b border-slate-100">
                <Text className="text-[13px]" style={{ color: colors.muted }}>
                  Version
                </Text>
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  1.0.0 (BNB Studio Hackathon)
                </Text>
              </View>

              <View className="flex-row items-center justify-between pt-3">
                <Text className="text-[13px]" style={{ color: colors.muted }}>
                  Security Architecture
                </Text>
                <Text className="text-[13px] font-semibold" style={{ color: colors.goldDark }}>
                  Strict Read-Only Verification
                </Text>
              </View>
            </Surface>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
