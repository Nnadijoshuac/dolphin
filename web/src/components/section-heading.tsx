import { colors } from "@/constants/theme";

export function SectionHeading({ title }: { title: string }) {
  return (
    <h3
      className="mb-3 text-[11px] font-bold uppercase tracking-[1.5px]"
      style={{ color: colors.muted }}
    >
      {title}
    </h3>
  );
}
