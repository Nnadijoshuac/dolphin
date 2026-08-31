import Link from "next/link";

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
    timeZone: "UTC",
  }).format(date);
}

export function MetricCell<T>({ label, metric, format }: MetricCellProps<T>) {
  const hasValue = metric.status === "live" || metric.status === "stale";
  const checkedAt = formatCheckedAt(metric.asOf);

  return (
    <article
      aria-live={metric.status === "syncing" ? "polite" : undefined}
      className="min-w-0 border-b border-r border-line bg-paper p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted">
          {label}
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 text-[0.68rem] font-semibold capitalize ${
            metric.status === "live"
              ? "text-success"
              : metric.status === "stale" || metric.status === "syncing"
                ? "text-accent-ink"
                : "text-faint"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              metric.status === "live"
                ? "bg-success"
                : metric.status === "stale" || metric.status === "syncing"
                  ? "bg-accent"
                  : "bg-faint"
            } ${metric.status === "syncing" ? "animate-pulse" : ""}`}
          />
          {metric.status}
        </span>
      </div>

      {hasValue ? (
        <p className="mt-5 break-words text-2xl font-semibold tracking-[-0.035em] text-ink">
          {format(metric.value) || "None"}
        </p>
      ) : metric.status === "syncing" ? (
        <div aria-label="Metric syncing" className="mt-4">
          <div className="skeleton h-8 w-32 rounded-md" />
        </div>
      ) : (
        <p className="mt-5 text-base font-medium text-faint">Unavailable</p>
      )}

      <div className="mt-5 space-y-1 border-t border-line pt-3 text-[0.7rem] leading-5 text-muted">
        <p>
          <span className="font-medium text-ink">Source:</span>{" "}
          {metric.source.url ? (
            <Link
              className="font-medium text-accent-ink underline-offset-4 hover:underline"
              href={metric.source.url}
              rel="noreferrer"
              target="_blank"
            >
              {metric.source.label} ↗
            </Link>
          ) : (
            <span>{metric.source.label}</span>
          )}
        </p>
        {checkedAt ? (
          <p>
            <span className="font-medium text-ink">Checked:</span> {checkedAt} UTC
          </p>
        ) : null}
        {!hasValue && metric.reason ? (
          <p>
            <span className="font-medium text-ink">Note:</span> {metric.reason}
          </p>
        ) : null}
        {metric.methodology ? (
          <details className="pt-1">
            <summary className="cursor-pointer font-medium text-ink underline-offset-4 hover:underline">
              Methodology
            </summary>
            <p className="mt-1 text-pretty">{metric.methodology}</p>
          </details>
        ) : null}
      </div>
    </article>
  );
}
