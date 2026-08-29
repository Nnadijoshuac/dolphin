import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import type { LiveMetric } from "@/types/agent";

type MetricCellProps<T> = {
  label: string;
  metric: LiveMetric<T>;
  format: (value: T) => string;
};

function formatCheckedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MetricCell<T>({ label, metric, format }: MetricCellProps<T>) {
  const hasValue = metric.status === "live" || metric.status === "stale";
  const checkedAt = formatCheckedAt(metric.asOf);

  return (
    <article
      aria-live={metric.status === "syncing" ? "polite" : undefined}
      className="min-w-0 border-t border-[var(--line)] p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-xs font-bold text-[var(--muted)]">{label}</h3>
        <StatusBadge label={metric.status} tone={metric.status} />
      </div>

      {hasValue ? (
        <p className="mt-5 break-words text-2xl font-black tracking-[-0.045em] text-[var(--ink)]">
          {format(metric.value) || "None"}
        </p>
      ) : metric.status === "syncing" ? (
        <div className="mt-5" aria-label="Metric syncing">
          <div className="skeleton-sheen h-7 w-28 rounded-lg" />
        </div>
      ) : (
        <p className="mt-5 text-lg font-bold text-[var(--faint)]">
          Unavailable
        </p>
      )}

      <div className="mt-5 space-y-1.5 border-t border-[var(--line-light)] pt-4 text-[11px] leading-5 text-[var(--muted)]">
        <p>
          Source: {metric.source.url ? (
            <Link
              className="font-semibold text-[var(--ink-secondary)] underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--accent-ink)]"
              href={metric.source.url}
              rel="noreferrer"
              target="_blank"
            >
              {metric.source.label}
            </Link>
          ) : (
            <span className="font-semibold text-[var(--ink-secondary)]">
              {metric.source.label}
            </span>
          )}
        </p>
        {checkedAt && <p>Checked: {checkedAt}</p>}
        {metric.methodology && <p>Method: {metric.methodology}</p>}
        {!hasValue && metric.reason && <p>Reason: {metric.reason}</p>}
      </div>
    </article>
  );
}
