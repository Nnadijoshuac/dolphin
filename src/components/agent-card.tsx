import { Text, View } from "react-native";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
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
        backgroundColor: "#FFFFFF",
        borderColor: "rgba(17,18,20,0.06)",
        borderRadius: 24,
        borderWidth: 1,
        padding: 16,
        ...shadows.subtle,
      }}
    >
      <View className="flex-row items-start gap-4">
        {/*
          The agent's own icon, not its category glyph. AgentIcon renders
          agent.iconUrl when there is one and falls back to the category glyph
          only when there is not, which is what the detail, hire and manage
          screens already do - so a card and its detail page now show the same
          image instead of every agent in a category sharing one drawing.
        */}
        <AgentIcon category={agent.category} size={80} uri={agent.iconUrl} />

        {/* Middle Info Column */}
        <View className="flex-1">
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
            style={{ color: "#4A4B4F" }}
          >
            {agent.tagline}
          </Text>

          {/* Category Tag */}
          <View className="mt-2.5 flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <Text className="text-[12px] font-medium text-zinc-500">
              {categoryLabels[agent.category]}
            </Text>
          </View>

          {/* Bottom Status & View CTA */}
          <View className="mt-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <CategoryGlyph color="#8C8E88" name="sparkle" size={13} />
              <Text className="text-[11.5px] font-medium text-zinc-500">
                Syncing BSC data
              </Text>
            </View>

            <View
              className="items-center justify-center rounded-xl px-4 py-1.5"
              style={{
                backgroundColor: colors.gold,
                minWidth: 64,
                ...shadows.subtle,
              }}
            >
              <Text className="text-[13px] font-bold text-black">
                View
              </Text>
            </View>
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

