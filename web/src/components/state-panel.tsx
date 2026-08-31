import { CategoryGlyph } from "@/components/category-glyph";
import type { LiveMetricStatus } from "@/types/agent";

type StatePanelProps = {
  title: string;
  body: string;
  state: LiveMetricStatus | "empty";
  compact?: boolean;
};

const stateConfigs: Record<
  LiveMetricStatus | "empty",
  { label: string; bg: string; text: string; icon: "sparkle" | "shield" | "info" }
> = {
  syncing: {
    label: "Syncing",
    bg: "#fff2bd",
    text: "#654b00",
    icon: "sparkle",
  },
  live: {
    label: "Live",
    bg: "#e4f2ea",
    text: "#267052",
    icon: "shield",
  },
  stale: {
    label: "Stale",
    bg: "#fff2bd",
    text: "#654b00",
    icon: "info",
  },
  unavailable: {
    label: "Unavailable",
    bg: "#eeede6",
    text: "#6c6d64",
    icon: "info",
  },
  empty: {
    label: "Nothing here yet",
    bg: "#eeede6",
    text: "#6c6d64",
    icon: "info",
  },
};

export function StatePanel({ title, body, state, compact }: StatePanelProps) {
  const config = stateConfigs[state] ?? stateConfigs.unavailable;

  return (
    <div
      aria-live={state === "syncing" ? "polite" : undefined}
      className={`surface ${
        compact ? "p-5" : "p-6 sm:p-8"
      }`}
    >
      <div className="flex gap-4 sm:gap-5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: config.bg, color: config.text }}
        >
          <CategoryGlyph color="currentColor" name={config.icon} size={18} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p
            className="text-[0.68rem] font-semibold uppercase tracking-[0.11em]"
            style={{ color: config.text }}
          >
            {config.label}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}
