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

/**
 * United Stables ($U), the token agents are paid in. The file is Trust
 * Wallet's registry logo for 0xcE24439F2D9C6a2289F741120FE202248B666666
 * (info.json: "United Stables", symbol U, 18 decimals), resized to 96px.
 */
export function ULogo({ size = 18 }: { size?: number }) {
  return (
    <Image
      alt="U"
      src="/u-logo.png"
      width={size}
      height={size}
      className="rounded-full object-contain"
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

/*
 * Every other token the wallet tracks (hooks/use-wallet-tokens.ts). Same source as u-logo.png: Trust
 * Wallet's registry logo for each BNB Chain contract address, resized to 96px (owner, 2026-10-17: USDT
 * showed a "U" letter and read as the U token).
 */
const TOKEN_LOGO_FILES: Record<string, string> = {
  USDT: "/tokens/usdt.png",
  USDC: "/tokens/usdc.png",
  FDUSD: "/tokens/fdusd.png",
  WBNB: "/tokens/wbnb.png",
  BTCB: "/tokens/btcb.png",
  ETH: "/tokens/eth.png",
  CAKE: "/tokens/cake.png",
  XVS: "/tokens/xvs.png",
};

/** Any token by symbol: BNB, U, the tracked tokens, and a letter disc for one with no file. */
export function TokenLogo({ symbol, size = 18 }: { symbol: string; size?: number }) {
  if (symbol === "BNB") return <BnbLogo size={size} />;
  if (symbol === "U") return <ULogo size={size} />;
  const file = TOKEN_LOGO_FILES[symbol];
  if (!file) {
    return (
      <span aria-hidden="true" className="pw-token__badge" style={{ height: size, width: size }}>
        {symbol.slice(0, 1)}
      </span>
    );
  }
  return (
    <Image
      alt={symbol}
      src={file}
      width={size}
      height={size}
      className="rounded-full object-contain"
      style={{ height: size, width: size }}
    />
  );
}

/** "All assets" - the total across every token. */
export function AllAssetsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}

export function BnbBadge({ label = "on BNB Smart Chain Mainnet" }: { label?: string }) {
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
