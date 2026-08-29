import type { LiveMetricStatus } from "@/types/agent";

type StatePanelProps = {
  title: string;
  body: string;
  state: LiveMetricStatus | "empty";
  compact?: boolean;
};

const stateConfigs: Record<
  LiveMetricStatus | "empty",
  { label: string; bg: string; border: string; text: string; icon: "sparkle" | "shield" | "info" | "close" }
> = {
  syncing: {
    label: "Syncing",
    bg: "#FEF5D6",
    border: "#F3E3A6",
    text: "#946B00",
    icon: "sparkle",
  },
  live: {
    label: "Live",
    bg: "#DCEFE4",
    border: "#BFE0CC",
    text: "#1C6A44",
    icon: "shield",
  },
  stale: {
    label: "Stale",
    bg: "#FEF5D6",
    border: "#F3E3A6",
    text: "#946B00",
    icon: "info",
  },
  unavailable: {
    label: "Unavailable",
    bg: "#F5F3EB",
    border: "#ECE8DE",
    text: "#6E706B",
    icon: "info",
  },
  empty: {
    label: "Empty",
    bg: "#F5F3EB",
    border: "#ECE8DE",
    text: "#6E706B",
    icon: "info",
  },
};

export function StatePanel({ title, body, state, compact }: StatePanelProps) {
  const config = stateConfigs[state] ?? stateConfigs.unavailable;

  return (
    <div
      aria-live={state === "syncing" ? "polite" : undefined}
      className={`rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm ${
        compact ? "py-4 sm:py-5" : "py-8 sm:py-10"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="shrink-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
            style={{
              backgroundColor: config.bg,
              borderColor: config.border,
              color: config.text,
              borderWidth: 1,
            }}
          >
            {state === "syncing" && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#F5B300]" />
            )}
            {config.label}
          </span>
        </div>
        <div>
          <h3 className="text-lg font-black tracking-tight text-[#111214]">
            {title}
          </h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#6E706B]">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}
