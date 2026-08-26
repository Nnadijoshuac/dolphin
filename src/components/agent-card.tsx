import { Text, View } from "react-native";

import { AgentIcon } from "@/components/agent-icon";
import { MetricCell } from "@/components/metric-cell";
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
  featured?: boolean;
};

export function AgentCard({ agent, onPress, featured = false }: AgentCardProps) {
  return (
    <PressableScale
      accessibilityHint={`Open details for ${agent.name}`}
      accessibilityLabel={agent.name}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        minHeight: featured ? 244 : 212,
        borderRadius: radii.large,
        borderWidth: 1,
        borderColor: featured ? "#E6D59A" : colors.line,
        backgroundColor: colors.surface,
        padding: 18,
        ...shadows.card,
      }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <AgentIcon category={agent.category} size={featured ? 64 : 54} uri={agent.iconUrl} />
        <View className="items-end gap-2">
          <StatusBadge
            label={agent.recordStatus === "indexed" ? "Registry indexed" : "Editorial fallback"}
            tone={agent.recordStatus === "indexed" ? "indexed" : "neutral"}
          />
          <StatusBadge
            label={agent.endpointStatus.status}
            tone={agent.endpointStatus.status}
          />
        </View>
      </View>

      <Text
        className="mt-4 text-[19px] font-bold tracking-[-0.5px]"
        numberOfLines={1}
        style={{ color: colors.ink }}
      >
        {agent.name}
      </Text>
      <Text
        className="mt-1 text-[12px] font-semibold"
        numberOfLines={1}
        style={{ color: colors.muted }}
      >
        {categoryLabels[agent.category]} · {agent.publisher}
      </Text>
      <Text
        className="mt-3 text-[13px] leading-5"
        numberOfLines={featured ? 3 : 2}
        style={{ color: colors.muted }}
      >
        {agent.tagline}
      </Text>

      <View
        className="mt-auto flex-row gap-4 border-t pt-4"
        style={{ borderColor: colors.line }}
      >
        <MetricCell
          compact
          format={(value) => value.toFixed(1)}
          label="Reputation"
          metric={agent.reputationScore}
        />
        <MetricCell
          compact
          format={(value) => value.toLocaleString()}
          label="Feedback"
          metric={agent.feedbackCount}
        />
      </View>
    </PressableScale>
  );
}

