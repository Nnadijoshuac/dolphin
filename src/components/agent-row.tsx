import { Text, View } from "react-native";

import { AgentIcon } from "@/components/agent-icon";
import { BnbLogo } from "@/components/brand-mark";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import type { Agent } from "@/types/agent";

type AgentRowProps = {
  agent: Agent;
  onPress: () => void;
  /** Line under the name. Defaults to the agent's own tagline. */
  subtitle?: string;
};

/**
 * One agent as a compact list row, with the agent's OWN icon rather than its
 * category glyph - the search screen previously drew the category glyph in
 * three separate places, so every agent in a category looked identical there
 * exactly as it did on the discover cards.
 *
 * Extracted because the search screen renders this same row for live results,
 * for suggestions and for the full catalog; it was copy-pasted markup in all
 * three before.
 */
export function AgentRow({ agent, onPress, subtitle }: AgentRowProps) {
  return (
    <PressableScale
      accessibilityHint={`Open details for ${agent.name}`}
      accessibilityLabel={agent.name}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        backgroundColor: "#FFFFFF",
        borderColor: "rgba(17,18,20,0.05)",
        borderRadius: 16,
        borderWidth: 1,
        padding: 12,
        ...shadows.subtle,
      }}
    >
      <View className="flex-row items-center gap-3">
        <AgentIcon category={agent.category} size={48} uri={agent.iconUrl} />

        <View className="flex-1 pr-2">
          <Text
            className="text-[15px] font-bold tracking-tight"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>
          <Text className="mt-0.5 text-[11.5px] text-zinc-500" numberOfLines={1}>
            {subtitle ?? agent.tagline}
          </Text>
          <View className="mt-1 flex-row items-center gap-1">
            <BnbLogo size={12} />
            <Text className="text-[10.5px] font-semibold text-amber-800">
              BNB Chain
            </Text>
          </View>
        </View>

        <View
          className="items-center justify-center rounded-lg px-3 py-1.5"
          style={{
            backgroundColor: colors.gold,
            minWidth: 54,
            ...shadows.subtle,
          }}
        >
          <Text className="text-[12px] font-bold text-black">View</Text>
        </View>
      </View>
    </PressableScale>
  );
}
