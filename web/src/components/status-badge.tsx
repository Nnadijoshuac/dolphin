"use client";

type StatusBadgeProps = {
  label: string;
  tone: string;
};

const toneStyles: Record<string, { bg: string; text: string; border: string }> = {
  live: {
    bg: "#DCEFE4",
    text: "#1C6A44",
    border: "#BFE0CC",
  },
  indexed: {
    bg: "#DDE9F8",
    text: "#295C92",
    border: "#C6D8EE",
  },
  neutral: {
    bg: "#F5F3EB",
    text: "#6E706B",
    border: "#ECE8DE",
  },
  unavailable: {
    bg: "#F5F3EB",
    text: "#8A8D84",
    border: "#ECE8DE",
  },
  syncing: {
    bg: "#FEF5D6",
    text: "#946B00",
    border: "#F3E3A6",
  },
  stale: {
    bg: "#FEF5D6",
    text: "#946B00",
    border: "#F3E3A6",
  },
  preview: {
    bg: "#FEF5D6",
    text: "#946B00",
    border: "#F3E3A6",
  },
  gold: {
    bg: "#FEF5D6",
    text: "#946B00",
    border: "#F3E3A6",
  },
  lilac: {
    bg: "#E9E1F4",
    text: "#65478A",
    border: "#D8CAE8",
  },
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const current = toneStyles[tone] ?? toneStyles.neutral;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.06em]"
      style={{
        backgroundColor: current.bg,
        color: current.text,
        border: `1px solid ${current.border}`,
      }}
    >
      {tone === "live" && (
        <span className="h-1.5 w-1.5 rounded-full bg-[#1C6A44]" />
      )}
      {tone === "syncing" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F5B300]" />
      )}
      {label.toUpperCase()}
    </span>
  );
}
