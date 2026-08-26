import { Text, View, useWindowDimensions } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { StatePanel } from "@/components/state-panel";
import { colors, radii } from "@/constants/theme";
import type { AgentPerformancePoint } from "@/types/agent";

type PerformancePanelProps = {
  points: AgentPerformancePoint[];
};

export function PerformancePanel({ points }: PerformancePanelProps) {
  const { width } = useWindowDimensions();

  if (points.length < 2) {
    return (
      <StatePanel
        body="A chart appears after the indexer receives at least two dated, sourced observations."
        compact
        state="syncing"
        title="Track record syncing"
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
            Published performance
          </Text>
          <Text className="mt-1 text-[11px]" style={{ color: "#AEB0A9" }}>
            {points.length} sourced observations
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

