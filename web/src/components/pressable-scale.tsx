"use client";

import type { ReactNode, CSSProperties } from "react";

type PressableScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  containerStyle?: CSSProperties;
  className?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  disabled?: boolean;
};

export function PressableScale({
  children,
  onPress,
  containerStyle,
  className = "",
  accessibilityLabel,
  disabled,
}: PressableScaleProps) {
  return (
    <button
      aria-label={accessibilityLabel}
      className={`pressable-scale ${className}`}
      disabled={disabled}
      onClick={onPress}
      style={{
        border: "none",
        cursor: disabled ? "default" : "pointer",
        background: "none",
        padding: 0,
        textAlign: "left",
        ...containerStyle,
      }}
      type="button"
    >
      {children}
    </button>
  );
}
