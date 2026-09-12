"use client";

import Image from "next/image";

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

  /*
   * ---------------------------------------------------------------------------
   * THE LOGO FOLLOWS THE THEME (2026-09-12).
   * ---------------------------------------------------------------------------
   * dolphin-logo.png is PURE BLACK on transparent — measured, not assumed: of
   * its 384,697 opaque pixels the maximum luminance is 1 out of 255. So every
   * plain `<BrandMark size={n} />` was painting a black dolphin onto a #131410
   * canvas in dark mode. Same bug as the icon default in category-glyph.tsx,
   * and for the same reason: an asset with a baked-in colour cannot follow a
   * palette.
   *
   * The inversion is done in CSS rather than here because only CSS can see the
   * theme — this component renders once and has no idea which palette is
   * active. `.brand-mark--auto` is `filter: none` in light and
   * `brightness(0) invert(1)` in dark.
   *
   * The explicit `color` / `inverted` props still win, and they have to: the
   * mobile tab bar sits on an always-black pill regardless of theme and passes
   * #FFE7FF, which must NOT flip to black when someone switches to light mode.
   * Auto is only for the callers that did not say.
   * ---------------------------------------------------------------------------
   */
  const forced = isWhite || isBlack;

  return (
    <Image
      alt="Dolphin"
      src="/dolphin-logo.png"
      width={size}
      height={size}
      className={`object-contain ${forced ? "" : "brand-mark--auto"} ${className}`}
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
        /*
         * var(--accent-ink), not colors.goldDark. Same dark-mode bug as the
         * icon default in category-glyph.tsx: constants/theme.ts is a
         * LIGHT-ONLY palette from before dark mode existed, and goldDark is the
         * literal "#654B00" — a dark brown that does not move with the theme,
         * so this label was brown-on-near-black in dark. --accent-ink is the
         * token that flips (dark brown on light, light gold on dark).
         */
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--accent-ink)" }}
      >
        {label}
      </span>
    </div>
  );
}
