import { colors, shadows } from "@/constants/theme";
import type { LiveMetricStatus } from "@/types/agent";

type StatePanelProps = {
  title: string;
  body: string;
  state: LiveMetricStatus | "empty";
  compact?: boolean;
};

const stateColors: Record<string, { bg: string; border: string; icon: string }> = {
  syncing: { bg: "#FFF9E6", border: "#F3E3A6", icon: "#946B00" },
  live: { bg: "#DCEFE4", border: "#B4DFC6", icon: "#1C6A44" },
  stale: { bg: "#FFF3CD", border: "#FFE69C", icon: "#856404" },
  unavailable: { bg: "#F5F3EB", border: "#ECE8DE", icon: "#6E706B" },
  empty: { bg: "#F5F3EB", border: "#ECE8DE", icon: "#6E706B" },
};

export function StatePanel({ title, body, state, compact }: StatePanelProps) {
  const palette = stateColors[state] ?? stateColors.unavailable;

  return (
    <div
      className={`rounded-2xl border text-center ${compact ? "p-4" : "px-6 py-8"}`}
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
      }}
    >
      {state === "syncing" && (
        <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: palette.icon }} />
      )}
      <h3 className="text-[15px] font-bold" style={{ color: colors.ink }}>{title}</h3>
      <p className="mt-2 text-[13px] leading-5" style={{ color: colors.muted }}>{body}</p>
    </div>
  );
}
