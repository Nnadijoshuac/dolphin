import { Text, View } from "react-native";

import { AgentIcon } from "@/components/agent-icon";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import {
  summariseSignals,
  type AgentSignals,
} from "@/hooks/use-agent-signals";
import { assessHireability } from "@/services/hireability";
import type { Agent } from "@/types/agent";

type AgentRowProps = {
  agent: Agent;
  onPress: () => void;
  /** Line under the name. Defaults to the agent's own tagline. */
  subtitle?: string;
  /**
   * This agent's hire and review counts, from the ONE catalog-wide query the
   * screen makes. Passed in rather than fetched here on purpose - a row that
   * fetches its own signals is a query per row.
   */
  signals?: AgentSignals;
};

/**
 * One agent as a compact list row, with the agent's OWN icon rather than its
 * category glyph.
 * 
 * Styled to look like a Google Play Store app list item.
 */
export function AgentRow({ agent, onPress, subtitle, signals }: AgentRowProps) {
  /*
   * The pill says what the row can actually do.
   *
   * Every row used to say "View", which is true and useless, and the list gave
   * no hint that most of these agents cannot be hired at all - a user found
   * that out by opening one. Measured 2026-09-06: of 31 listed agents, 15
   * publish a callable endpoint and 9 return a real price. Saying "Hire" only
   * where a hire is possible is the cheapest honest signal available, and costs
   * no extra chrome.
   */
  const hireable = assessHireability(agent).hireable;
  /*
   * Dolphin's OWN record of this agent, not 8004scan's feedback count.
   *
   * The meta line used to read "<n> reviews · BNB Chain", where the count was
   * ERC-8004 feedback records from the indexer - a measure of activity that
   * says nothing about whether the agent did its job - and "BNB Chain" was
   * identical on every row and therefore told a reader nothing at all.
   *
   * What decides a hire is how many people hired it and what they said
   * afterwards. That is what this line carries now.
   */
  const summary = summariseSignals(signals);

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
          
          {/* Meta line: what Dolphin actually knows about this agent. */}
          <Text
            className="mt-1 text-[11px] font-medium"
            numberOfLines={1}
            style={{ color: summary ? colors.inkSecondary : colors.faint }}
          >
            {summary ?? "No hires yet"}
          </Text>
        </View>

        {/* Action Button (Pill-shaped) */}
        <View
          className="items-center justify-center px-3.5 py-1.5"
          style={{
            borderColor: hireable ? colors.goldBorder : colors.line,
            backgroundColor: hireable ? colors.goldSoft : colors.surfaceSubtle,
            borderWidth: 1,
            borderRadius: 9999,
          }}
        >
          <Text
            className="text-[12px] font-bold"
            style={{ color: hireable ? colors.goldDark : colors.muted }}
          >
            {hireable ? "Hire" : "View"}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}
