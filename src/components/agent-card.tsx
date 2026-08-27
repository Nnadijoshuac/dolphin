import { Text, View } from "react-native";
import { AgentIcon } from "@/components/agent-icon";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatusBadge } from "@/components/status-badge";
import { colors, radii, shadows } from "@/constants/theme";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

type AgentCardProps = {
  agent: Agent;
  onPress: () => void;
};

export function AgentCard({ agent, onPress }: AgentCardProps) {
  return (
    <PressableScale
      accessibilityHint={`Open details for ${agent.name}`}
      accessibilityLabel={agent.name}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        borderRadius: radii.large,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        padding: 16,
        ...shadows.card,
      }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-row items-start gap-3.5 flex-1 pr-3">
          <AgentIcon category={agent.category} size={58} uri={agent.iconUrl} />
          <View className="flex-1 pt-0.5">
            <Text
              className="text-[17px] font-bold tracking-tight"
              numberOfLines={1}
              style={{ color: colors.ink }}
            >
              {agent.name}
            </Text>
            <Text
              className="mt-1 text-[13px] leading-[18px]"
              numberOfLines={2}
              style={{ color: colors.muted }}
            >
              {agent.tagline}
            </Text>
          </View>
        </View>

        <View
          className="items-center justify-center"
          style={{
            backgroundColor: colors.gold,
            borderRadius: radii.pill,
            minHeight: 34,
            minWidth: 68,
            paddingHorizontal: 14,
            ...shadows.goldGlow,
          }}
        >
          <Text
            className="text-[13px] font-bold"
            style={{ color: colors.ink }}
          >
            View
          </Text>
        </View>
      </View>

      {/* Meta tags footer */}
      <View
        className="mt-3.5 flex-row items-center justify-between gap-2 border-t pt-3"
        style={{ borderColor: colors.lineLight }}
      >
        <View className="flex-row items-center gap-1.5">
          <CategoryGlyph color={colors.muted} name={agent.category} size={14} />
          <Text
            className="text-[12px] font-medium"
            style={{ color: colors.inkSecondary }}
          >
            {categoryLabels[agent.category]}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <View className="flex-row items-center gap-1.5">
            {agent.recordStatus === "indexed" ? (
              <BnbLogo size={12} />
            ) : (
              <CategoryGlyph color={colors.muted} name="info" size={12} />
            )}
            <Text
              className="text-[11px] font-medium"
              style={{ color: colors.muted }}
            >
              {agent.recordStatus === "indexed"
                ? "Registry indexed"
                : "Editorial fallback"}
            </Text>
          </View>
          <StatusBadge
            label={agent.endpointStatus.status}
            tone={agent.endpointStatus.status}
          />
        </View>
      </View>
    </PressableScale>
  );
}
