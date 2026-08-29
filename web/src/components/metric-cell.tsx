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
      className="min-w-0 rounded-2xl border border-[#ECE8DE] bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E706B]">{label}</h3>
        <StatusBadge label={metric.status} tone={metric.status} />
      </div>

      {hasValue ? (
        <p className="mt-4 break-words text-2xl font-black tracking-tight text-[#111214]">
          {format(metric.value) || "None"}
        </p>
      ) : metric.status === "syncing" ? (
        <div aria-label="Metric syncing" className="mt-4">
          <div className="skeleton-sheen h-8 w-32 rounded-xl" />
        </div>
      ) : (
        <p className="mt-4 text-base font-bold text-[#A5A79F]">
          Unavailable
        </p>
      )}

      <div className="mt-4 space-y-1 border-t border-[#F3F0E8] pt-3 text-[11px] leading-5 text-[#6E706B]">
        <p>
          <span className="font-semibold text-[#111214]">Source:</span>{" "}
          {metric.source.url ? (
            <Link
              className="font-bold text-[#946B00] hover:underline"
              href={metric.source.url}
              rel="noreferrer"
              target="_blank"
            >
              {metric.source.label} ↗
            </Link>
          ) : (
            <span className="font-semibold text-[#303236]">
              {metric.source.label}
            </span>
          )}
        </p>
        {checkedAt && <p><span className="font-semibold text-[#111214]">Checked:</span> {checkedAt}</p>}
        {metric.methodology && <p><span className="font-semibold text-[#111214]">Method:</span> {metric.methodology}</p>}
        {!hasValue && metric.reason && <p><span className="font-semibold text-[#111214]">Note:</span> {metric.reason}</p>}
      </div>
    </article>
  );
}
