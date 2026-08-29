type StatusBadgeProps = {
  label: string;
  tone: string;
};

const toneClasses: Record<string, string> = {
  live:
    "border-[color-mix(in_srgb,var(--success)_32%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
  indexed:
    "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--info-soft)] text-[var(--info)]",
  neutral: "border-[var(--line)] bg-[var(--neutral-soft)] text-[var(--muted)]",
  unavailable:
    "border-[var(--line)] bg-[var(--neutral-soft)] text-[var(--muted)]",
  syncing:
    "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  stale:
    "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  preview:
    "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] ${
        toneClasses[tone] ?? toneClasses.neutral
      }`}
    >
      {label.toUpperCase()}
    </span>
  );
}
