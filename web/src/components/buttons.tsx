import type { ReactNode, CSSProperties } from "react";
import { colors, shadows } from "@/constants/theme";

type ButtonVariant = "primary" | "gold" | "destructive";
type ButtonSize = "default" | "large";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  style?: CSSProperties;
  iconRight?: ReactNode;
};

const variantStyles: Record<ButtonVariant, { bg: string; color: string; hoverBg: string }> = {
  primary: { bg: colors.ink, color: "#FFFFFF", hoverBg: "#2A2B30" },
  gold: { bg: colors.gold, color: colors.ink, hoverBg: colors.goldHover },
  destructive: { bg: "#FEE2E2", color: "#B91C1C", hoverBg: "#FECACA" },
};

export function Button({
  label,
  onPress,
  onClick,
  variant = "primary",
  size = "default",
  disabled = false,
  style: customStyle,
  iconRight,
}: ButtonProps) {
  const vs = variantStyles[variant];
  const handleClick = onPress || onClick;

  return (
    <button
      className={`
        pressable-scale w-full rounded-2xl font-bold transition-all duration-200
        flex items-center justify-center gap-2
        ${size === "large" ? "py-4 text-[16px]" : "py-3.5 text-[15px]"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
      disabled={disabled}
      onClick={handleClick}
      style={{
        backgroundColor: vs.bg,
        color: vs.color,
        boxShadow: variant === "gold" ? shadows.goldGlow : shadows.subtle,
        border: "none",
        ...customStyle,
      }}
      type="button"
    >
      <span>{label}</span>
      {iconRight}
    </button>
  );
}
