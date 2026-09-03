import { Text, View } from "react-native";

import { AgentIcon } from "@/components/agent-icon";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import type { Agent } from "@/types/agent";

type AgentRowProps = {
  agent: Agent;
  onPress: () => void;
  /** Line under the name. Defaults to the agent's own tagline. */
  subtitle?: string;
};

/**
 * One agent as a compact list row, with the agent's OWN icon rather than its
 * category glyph.
 * 
 * Styled to look like a Google Play Store app list item.
 */
export function AgentRow({ agent, onPress, subtitle }: AgentRowProps) {
  const feedbackCount =
    agent.feedbackCount.status === "live" || agent.feedbackCount.status === "stale"
      ? agent.feedbackCount.value
      : null;

  return (
    <PressableScale
      accessibilityHint={`Open details for ${agent.name}`}
      accessibilityLabel={agent.name}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        backgroundColor: "transparent",
        paddingVertical: 10,
        paddingHorizontal: 4,
      }}
    >
      <View className="flex-row items-center gap-4">
        {/* App Icon */}
        <AgentIcon category={agent.category} size={56} uri={agent.iconUrl} />

        <View className="flex-1 pr-2">
          {/* App Title */}
          <Text
            className="text-[16px] font-semibold tracking-tight"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>
          
          {/* App Publisher/Subtitle */}
          <Text className="mt-0.5 text-[12px] text-zinc-500 font-normal" numberOfLines={1}>
            {subtitle ?? agent.tagline}
          </Text>
          
          {/* Meta line: e.g. "24 reviews · BNB Chain" */}
          <View className="mt-1 flex-row items-center gap-1.5">
            {feedbackCount !== null && feedbackCount > 0 ? (
              <>
                <Text className="text-[11px] font-medium text-zinc-500">
                  {feedbackCount} reviews
                </Text>
                <View className="w-0.5 h-0.5 rounded-full bg-zinc-400" />
              </>
            ) : null}
            <Text className="text-[11px] font-medium text-zinc-500">BNB Chain</Text>
          </View>
        </View>

        {/* Action Button (Pill-shaped) */}
        <View
          className="items-center justify-center px-4 py-1.5"
          style={{
            borderColor: "rgba(17,18,20,0.15)",
            borderWidth: 1,
            borderRadius: 9999,
          }}
        >
          <Text className="text-[13px] font-medium" style={{ color: colors.ink }}>
            View
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}
