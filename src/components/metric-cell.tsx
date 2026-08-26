import { Text, View } from "react-native";

import { colors } from "@/constants/theme";
import type { LiveMetric } from "@/types/agent";

type MetricCellProps<T> = {
  label: string;
  metric: LiveMetric<T>;
  format: (value: T) => string;
  compact?: boolean;
};

export function MetricCell<T>({
  label,
  metric,
  format,
  compact = false,
}: MetricCellProps<T>) {
  const display =
    metric.status === "live" || metric.status === "stale"
      ? format(metric.value)
      : metric.status === "syncing"
        ? "Syncing"
        : "Not reported";

  return (
    <View className="min-w-0 flex-1">
      <Text
        className="text-[10px] font-bold uppercase tracking-[1.1px]"
        numberOfLines={1}
        style={{ color: colors.faint }}
      >
        {label}
      </Text>
      <Text
        className={compact ? "mt-1 text-[14px] font-bold" : "mt-1.5 text-[17px] font-bold"}
        numberOfLines={1}
        style={{ color: colors.ink, letterSpacing: -0.25 }}
      >
        {display}
      </Text>
    </View>
  );
}

