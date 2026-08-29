"use client";

import { useRouter } from "next/navigation";
import { colors } from "@/constants/theme";
import { CategoryGlyph } from "@/components/category-glyph";

type NavigationButtonProps = {
  kind?: "back" | "close";
  onPress?: () => void;
};

export function NavigationButton({ kind = "back", onPress }: NavigationButtonProps) {
  const router = useRouter();
  const handleClick = onPress ?? (() => router.back());

  return (
    <button
      aria-label={kind === "close" ? "Close" : "Go back"}
      className="pressable-scale flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200"
      onClick={handleClick}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        cursor: "pointer",
      }}
      type="button"
    >
      {kind === "close" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : (
        <CategoryGlyph name="chevron-right" size={16} color={colors.ink} strokeWidth={2.5} />
      )}
    </button>
  );
}
