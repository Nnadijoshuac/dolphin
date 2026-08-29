import type { ReactNode } from "react";
import { colors, shadows } from "@/constants/theme";

type SurfaceProps = {
  children: ReactNode;
  gradient?: boolean;
};

export function Surface({ children, gradient }: SurfaceProps) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        backgroundColor: gradient ? colors.surfaceSubtle : colors.surface,
        borderColor: colors.line,
        boxShadow: shadows.subtle,
      }}
    >
      {children}
    </div>
  );
}
