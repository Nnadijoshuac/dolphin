import type { LiveMetricStatus } from "@/types/agent";

type StatePanelProps = {
  title: string;
  body: string;
  state: LiveMetricStatus | "empty";
  compact?: boolean;
};

const stateLabels: Record<LiveMetricStatus | "empty", string> = {
  syncing: "Syncing",
  live: "Live",
  stale: "Stale",
  unavailable: "Unavailable",
  empty: "Empty",
};

export function StatePanel({ title, body, state, compact }: StatePanelProps) {
  return (
    <div
      aria-live={state === "syncing" ? "polite" : undefined}
      className={`border-y border-[var(--line)] ${compact ? "py-5" : "py-10 sm:py-12"}`}
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr] sm:items-start">
        <div>
          <span className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-[var(--muted)]">
            {stateLabels[state].toUpperCase()}
          </span>
          {state === "syncing" && (
            <div className="skeleton-sheen mt-3 h-1.5 w-20 rounded-full" />
          )}
        </div>
        <div>
          <h3 className="text-lg font-bold tracking-[-0.025em] text-[var(--ink)]">
            {title}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}
