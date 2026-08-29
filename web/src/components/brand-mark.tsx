"use client";

import Image from "next/image";
import { colors } from "@/constants/theme";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      alt="Dolphin"
      src="/dolphin-logo.png"
      width={size}
      height={size}
      className="object-contain"
      priority
      style={{ height: size, width: size }}
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
