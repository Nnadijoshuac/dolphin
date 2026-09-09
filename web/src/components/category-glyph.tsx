import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Compass01Icon from "@hugeicons/core-free-icons/Compass01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Dollar01Icon from "@hugeicons/core-free-icons/Dollar01Icon";
import FilterHorizontalIcon from "@hugeicons/core-free-icons/FilterHorizontalIcon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import MoreVerticalIcon from "@hugeicons/core-free-icons/MoreVerticalIcon";
import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Robot01Icon from "@hugeicons/core-free-icons/Robot01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import ShieldOffIcon from "@hugeicons/core-free-icons/ShieldOffIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Wallet01Icon from "@hugeicons/core-free-icons/Wallet01Icon";
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

/**
 * Interface icons come from Hugeicons; the six AGENT CATEGORY glyphs do not.
 *
 * ===========================================================================
 * WHY THE SPLIT
 * ===========================================================================
 * The generic interface marks (wallet, info, search, chevrons, close, …) were
 * hand-drawn here and had no reason to be: they are the same shapes every app
 * uses, drawn less consistently than a real icon set draws them, and each one
 * was a small amount of SVG to maintain and to get subtly wrong. Twenty-odd of
 * them added up to most of this file.
 *
 * The six CATEGORY glyphs — monitoring, grid-trading, rebalancing,
 * health-factor, yield, trading — are kept exactly as they were. They are not
 * generic: each encodes what its category of agent actually does (a radar eye,
 * a liquidity ladder, a health gauge, a candlestick series), and no
 * general-purpose icon set has a mark that carries that meaning. Swapping them
 * would trade Dolphin's own visual vocabulary for a stock approximation, on the
 * one axis where this product's identity actually lives.
 *
 * MIRRORS src/components/category-glyph.tsx in the mobile app, which made the
 * same switch first. Same glyph names, same Hugeicons mapping, same six
 * hand-drawn categories — so a category reads identically on both surfaces.
 * The only differences are the renderer (`@hugeicons/react` rather than
 * `@hugeicons/react-native`) and plain SVG elements rather than react-native-svg
 * ones. Keep them in step.
 *
 * ===========================================================================
 * IMPORT ONE FILE PER ICON. DO NOT IMPORT FROM THE BARREL.
 * ===========================================================================
 * `@hugeicons/core-free-icons`'s root export is the entire set — every icon in
 * the package in one module. Next and Turbopack do tree-shake, so a named
 * import from the barrel would probably be fine here in a way it is NOT under
 * Metro (see the mobile file's note); "probably fine" is a bundle-size
 * regression waiting for a config change, and the per-icon subpath costs
 * nothing to use. The package's `./*` export maps to one small file per icon.
 *
 * Each per-icon file default-exports the icon's element array, hence the
 * default imports.
 *
 * ===========================================================================
 * `@hugeicons/core-free-icons` IS PINNED TO EXACTLY 4.3.0. DO NOT RANGE IT.
 * ===========================================================================
 * 4.3.2 — the current latest — ships FOUR declaration files. 4.3.0 ships 6,029,
 * one per icon. The runtime JS is present in both; only the types were dropped,
 * which appears to be an upstream packaging regression rather than an intent.
 *
 * With 4.3.2 installed, every import above is an untyped module. On a developer
 * machine that is invisible, because TypeScript walks up and finds the Expo
 * app's copy of the same package in the repository root's node_modules — so
 * `tsc --noEmit` and `next build` both pass locally while reading types from a
 * project this one is required to build without. Vercel installs only web/, and
 * on 2026-09-08 it failed with 26 TS7016 errors on this exact file.
 *
 * Two things now hold that line, and both are needed:
 *   - the exact pin in package.json, so the types are actually here;
 *   - `npm run check:isolation`, which fails when anything under web/src
 *     resolves outside web/ — the general form of the bug, not just this
 *     instance of it.
 *
 * Before bumping this dependency, check that the new version still ships
 * `dist/types/<Icon>.d.ts`, and run `npm run check:isolation`.
 */
export type GlyphName =
  | AgentCategory
  | "discover"
  | "categories"
  | "search"
  | "agents"
  | "bot"
  | "wallet"
  | "shield"
  | "clock"
  | "panel-left"
  | "add"
  | "revoke"
  | "check"
  | "copy"
  | "sparkle"
  | "layers"
  | "filter"
  | "info"
  | "chevron-right"
  | "chevron-left"
  | "arrow-right"
  | "menu"
  | "close"
  | "receive"
  | "external"
  | "refresh"
  | "share"
  | "more"
  | "star"
  | "spanner"
  | "dollar";

/**
 * Every glyph name that is a Hugeicons mark. A name absent from this map falls
 * through to the hand-drawn category glyphs below, which is what keeps the two
 * systems from silently overlapping — and what makes an unknown category render
 * nothing rather than a wrong icon.
 */
const HUGEICONS: Partial<Record<GlyphName, IconSvgElement>> = {
  discover: Compass01Icon,
  categories: GridViewIcon,
  search: Search01Icon,
  agents: Robot01Icon,
  // `bot` is this app's older alias for the same thing. Both map to one mark
  // rather than to two similar ones.
  bot: Robot01Icon,
  wallet: Wallet01Icon,
  shield: Shield01Icon,
  clock: Clock01Icon,
  "panel-left": PanelLeftIcon,
  add: Add01Icon,
  revoke: ShieldOffIcon,
  check: Tick01Icon,
  copy: Copy01Icon,
  sparkle: SparklesIcon,
  layers: Layers01Icon,
  filter: FilterHorizontalIcon,
  info: InformationCircleIcon,
  "chevron-right": ArrowRight01Icon,
  "chevron-left": ArrowLeft01Icon,
  "arrow-right": ArrowRight02Icon,
  menu: Menu01Icon,
  close: Cancel01Icon,
  receive: ArrowDown01Icon,
  external: ArrowUpRight01Icon,
  refresh: Refresh01Icon,
  share: Share01Icon,
  more: MoreVerticalIcon,
  star: StarIcon,
  spanner: Wrench01Icon,
  dollar: Dollar01Icon,
};

type CategoryGlyphProps = {
  name: GlyphName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export function CategoryGlyph({
  name,
  size = 24,
  color = colors.ink,
  strokeWidth = 1.8,
}: CategoryGlyphProps) {
  const hugeicon = HUGEICONS[name];

  if (hugeicon) {
    /*
     * `color` is honoured here, which it was NOT by the old hand-drawn "check".
     * That one painted a hardcoded gold disc with a white tick and ignored the
     * prop entirely, so every call site passing a colour was silently
     * overridden — including the accent-coloured ticks in onboarding and the
     * trust list on Discover, which were asking for `currentColor` and getting
     * gold-on-gold.
     */
    return (
      <HugeiconsIcon
        color={color}
        icon={hugeicon}
        size={size}
        strokeWidth={strokeWidth}
      />
    );
  }

  const common = {
    fill: "none",
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  /*
   * One flat props object per element rather than `{...common} strokeWidth={n}`.
   * On the web that spread-then-override is harmless, but the mobile twin of
   * this file must avoid it — react-native-svg 15.15.4 paints nothing on
   * Android when a spread is followed by an override of a key the spread
   * already set. Written the same way in both so the two files stay diffable.
   */
  const stroked = (width: number) => ({ ...common, strokeWidth: width });

  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      {name === "monitoring" && (
        <>
          {/* Eye shape centred */}
          <path d="M3 13s3.2-5.5 9-5.5 9 5.5 9 5.5-3.2 5.5-9 5.5-9-5.5-9-5.5Z" {...stroked(1.8)} />
          <circle cx="12" cy="13" fill={color} r="2.6" />
          {/* Radar waves */}
          <path d="M14 4.5c1.8.8 3 2 3.8 3.5" {...stroked(1.5)} />
          <path d="M16 2.5c2.5 1.2 4.2 3 5 5" {...stroked(1.5)} />
          {/* Magnifying handle */}
          <path d="M17 18l3.5 3.5" {...stroked(2.2)} />
        </>
      )}

      {name === "grid-trading" && (
        <>
          <line x1="4.5" x2="4.5" y1="5.5" y2="18.5" {...stroked(2.2)} />
          <line x1="19.5" x2="19.5" y1="5.5" y2="18.5" {...stroked(2.2)} />
          <line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="7.5" y2="7.5" {...stroked(1.2)} />
          <line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="16.5" y2="16.5" {...stroked(1.2)} />
          <path d="M4.5 12c2.5-5.5 5-5.5 7.5 0s5 5.5 7.5 0" {...stroked(2)} />
        </>
      )}

      {name === "rebalancing" && (
        <>
          {/* Two cycle arrows around a centred LP-range bracket. Matches the
              mobile glyph, which was redrawn from the old sliders shape. */}
          <path d="M6 8a6 6 0 0 1 10.5-3.3" {...stroked(2)} />
          <path d="m16.5 2 1 3-3 .5" {...stroked(2)} />
          <path d="M18 16a6 6 0 0 1-10.5 3.3" {...stroked(2)} />
          <path d="m7.5 22-1-3 3-.5" {...stroked(2)} />
          <line x1="12" x2="12" y1="9" y2="15" {...stroked(1.6)} />
        </>
      )}

      {name === "health-factor" && (
        <>
          <path d="M11 20s6-3.2 6-8.5V5.5l-6-2.5-6 2.5v6C5 16.8 11 20 11 20Z" {...stroked(1.8)} />
          <line x1="11" x2="11" y1="6.5" y2="14.5" {...stroked(1.8)} />
          <line x1="8.5" x2="13.5" y1="9" y2="9" {...stroked(1.8)} />
          <circle cx="17.5" cy="17.5" fill="#111215" r="3.8" />
          <line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.4} x1="17.5" x2="17.5" y1="15.5" y2="17.5" />
          <circle cx="17.5" cy="19.4" fill="#FFFFFF" r="0.6" />
        </>
      )}

      {name === "yield" && (
        <>
          <path d="M11 20v-6.5c0-3.5 3.5-5.5 8-5.5-1 4.5-2.5 8-8 8" {...stroked(1.8)} />
          <path d="M11 13.5c0-2.8-2.8-4.5-6.5-4.5 1 3.8 2.8 6.5 6.5 6.5" {...stroked(1.8)} />
          <path d="M17.5 3.5l2 2-2 2" {...stroked(1.8)} />
          <path d="M14.5 5.5h5" {...stroked(1.8)} />
        </>
      )}

      {name === "trading" && (
        <>
          {/* Candlesticks — wick plus body. Filled/hollow/filled, the
              conventional down/up/down reading, so it stays legible small and
              cannot be confused with grid-trading's ladder. */}
          <line x1="6.5" x2="6.5" y1="5" y2="19" {...stroked(1.6)} />
          <rect fill={color} height="6" rx="1" width="4" x="4.5" y="9" />
          <line x1="12" x2="12" y1="3.5" y2="17" {...stroked(1.6)} />
          <rect height="7" rx="1" width="4" x="10" y="6.5" {...stroked(1.8)} />
          <line x1="17.5" x2="17.5" y1="7" y2="21" {...stroked(1.6)} />
          <rect fill={color} height="6" rx="1" width="4" x="15.5" y="11" />
        </>
      )}
    </svg>
  );
}
