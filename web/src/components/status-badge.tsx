import { colors } from "@/constants/theme";

type StatusBadgeProps = {
  label: string;
  tone: string;
};

const toneStyles: Record<string, { bg: string; color: string; border: string }> = {
  live: { bg: "#DCEFE4", color: "#1C6A44", border: "#B4DFC6" },
  indexed: { bg: "#DDE9F8", color: "#295C92", border: "#B8D4F0" },
  neutral: { bg: "#F5F3EB", color: "#6E706B", border: "#ECE8DE" },
  unavailable: { bg: "#F5F3EB", color: "#6E706B", border: "#ECE8DE" },
  syncing: { bg: "#FFF9E6", color: "#946B00", border: "#F3E3A6" },
  stale: { bg: "#FFF3CD", color: "#856404", border: "#FFE69C" },
  preview: { bg: "#FEF5D6", color: "#946B00", border: "#F3E3A6" },
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const style = toneStyles[tone] ?? toneStyles.neutral;

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider border"
      style={{
        backgroundColor: style.bg,
        color: style.color,
        borderColor: style.border,
      }}
    >
      {label}
    </span>
  );
}
