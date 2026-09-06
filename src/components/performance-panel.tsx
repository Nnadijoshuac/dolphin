import { Text, View, useWindowDimensions } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { StatePanel } from "@/components/state-panel";
import { colors, radii } from "@/constants/theme";
import type { AgentPerformancePoint } from "@/types/agent";

type PerformancePanelProps = {
  points: AgentPerformancePoint[];
  /**
   * What the plotted number is, e.g. "Average health factor". Null for a
   * category with no wired metric, which is a different state from "wired but
   * not yet observed twice" and is worded differently below.
   */
  metricLabel?: string | null;
  /** True while the series has not loaded yet, as opposed to being genuinely short. */
  isLoading?: boolean;
};

export function PerformancePanel({
  points,
  metricLabel = null,
  isLoading = false,
}: PerformancePanelProps) {
  const { width } = useWindowDimensions();

  /*
   * Three distinct empty states, kept apart on purpose.
   *
   * This panel used to have one, reading "A chart appears after the indexer
   * receives at least two dated, sourced observations" - which rendered for
   * every agent, forever, because `performanceSeries` was hardcoded `[]` and
   * no indexer existed. The sentence was true and the impression it created
   * was false.
   *
   * There is now a real source (convex/lib/statsHistory.ts), so the sentence
   * has become accurate for the categories that have a metric - and for the
   * three that do not, saying "syncing" would be the old lie again. Those get
   * told there is nothing to plot and why.
   */
  if (isLoading) {
    return (
      <StatePanel
        body="Reading the observations Dolphin has stored for this agent."
        compact
        state="syncing"
        title="Loading track record"
      />
    );
  }

  if (metricLabel === null) {
    return (
      <StatePanel
        body="This category has no protocol-level metric Dolphin can read on a schedule, so there is nothing to plot over time. See the telemetry section above for what is and is not available."
        compact
        state="unavailable"
        title="No chartable metric"
      />
    );
  }

  if (points.length < 2) {
    return (
      <StatePanel
        body={`Dolphin has ${points.length === 0 ? "no" : "one"} stored reading of this agent's ${metricLabel.toLowerCase()}. A chart appears from the second one, and readings are taken at most hourly while the agent is being viewed.`}
        compact
        state="syncing"
        title="Track record building"
      />
    );
  }

  const chartWidth = Math.min(width - 80, 680);
  const chartHeight = 174;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const polyline = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * chartWidth;
      const y = chartHeight - 18 - ((point.value - min) / spread) * (chartHeight - 36);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <View
      style={{
        borderRadius: radii.large,
        borderColor: colors.line,
        borderWidth: 1,
        backgroundColor: colors.ink,
        overflow: "hidden",
        padding: 18,
      }}
    >
      <View className="mb-3 flex-row items-start justify-between">
        <View>
          <Text className="text-[16px] font-bold" style={{ color: colors.surface }}>
            {metricLabel}
          </Text>
          <Text className="mt-1 text-[11px]" style={{ color: "#AEB0A9" }}>
            {points.length} readings taken by Dolphin
          </Text>
        </View>
        <Text className="text-[10px] font-bold uppercase tracking-[1px]" style={{ color: colors.gold }}>
          {points[points.length - 1]?.source.label}
        </Text>
      </View>
      <Svg height={chartHeight} width={chartWidth}>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <Line
            key={ratio}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            x1="0"
            x2={chartWidth}
            y1={chartHeight * ratio}
            y2={chartHeight * ratio}
          />
        ))}
        <Polyline
          fill="none"
          points={polyline}
          stroke={colors.gold}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </Svg>
    </View>
  );
}

