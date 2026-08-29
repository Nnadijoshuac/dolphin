import { colors } from "@/constants/theme";
import type { LiveMetric } from "@/types/agent";

type MetricCellProps<T> = {
  label: string;
  metric: LiveMetric<T>;
  format: (value: T) => string;
};

export function MetricCell<T>({ label, metric, format }: MetricCellProps<T>) {
  return (
    <div>
      <p className="text-[11px] font-medium" style={{ color: colors.muted }}>
        {label}
      </p>
      {metric.status === "live" || metric.status === "stale" ? (
        <p className="mt-1 text-[17px] font-bold" style={{ color: colors.ink }}>
          {format(metric.value)}
        </p>
      ) : metric.status === "syncing" ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: colors.goldDark }} />
          <span className="text-[12px]" style={{ color: colors.muted }}>Syncing</span>
        </div>
      ) : (
        <p className="mt-1 text-[13px] italic" style={{ color: colors.faint }}>
          Unavailable
        </p>
      )}
    </div>
  );
}
