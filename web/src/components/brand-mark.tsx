"use client";

import Image from "next/image";
import { colors } from "@/constants/theme";

export function BrandMark({
  size = 32,
  color,
  inverted = false,
  className = "",
}: {
  size?: number;
  color?: string;
  inverted?: boolean;
  className?: string;
}) {
  const isWhite =
    inverted ||
    color === "#FFFFFF" ||
    color === "white" ||
    color === "#FFE7FF" ||
    color === "#ffe7ff";
  const isBlack =
    color === "#121316" ||
    color === "#141416" ||
    color === "#111215" ||
    color === "#080808" ||
    color === "#000000";

  return (
    <Image
      alt="Dolphin"
      src="/dolphin-logo.png"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      priority
      style={{
        height: size,
        width: size,
        filter: isWhite
          ? "brightness(0) invert(1)"
          : isBlack
          ? "brightness(0)"
          : undefined,
      }}
    />
  );
}

export function BnbLogo({ size = 18 }: { size?: number }) {
  return (
    <Image
      alt="BNB"
      src="/bnb-logo.png"
      width={size}
      height={size}
      className="object-contain"
      style={{ height: size, width: size }}
    />
  );
}

export function BnbBadge({ label = "on BNB Smart Chain" }: { label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <BnbLogo size={16} />
      <span
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: colors.goldDark }}
      >
        {label}
      </span>
    </div>
  );
}
