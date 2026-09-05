import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Compass01Icon from "@hugeicons/core-free-icons/Compass01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Robot01Icon from "@hugeicons/core-free-icons/Robot01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import ShieldOffIcon from "@hugeicons/core-free-icons/ShieldOffIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Wallet01Icon from "@hugeicons/core-free-icons/Wallet01Icon";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

/**
 * Interface icons come from Hugeicons; the six AGENT CATEGORY glyphs do not.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SPLIT
 * ---------------------------------------------------------------------------
 * The generic interface marks below (wallet, info, copy, chevrons, …) were
 * hand-drawn here and had no reason to be: they are the same shapes every app
 * uses, drawn less consistently than a real icon set would draw them, and each
 * one was a small amount of SVG to maintain.
 *
 * The six category glyphs - monitoring, grid-trading, rebalancing,
 * health-factor, yield, trading - are kept exactly as they were. They are not
 * generic: each encodes what its category of agent actually does (a radar eye,
 * a liquidity ladder, a health gauge), and no general-purpose icon set has a
 * mark that carries that meaning. Swapping them would trade Dolphin's own
 * visual vocabulary for a stock approximation.
 *
 * ---------------------------------------------------------------------------
 * IMPORT ONE FILE PER ICON. DO NOT IMPORT FROM THE BARREL.
 * ---------------------------------------------------------------------------
 * `@hugeicons/core-free-icons` resolves to dist/cjs/index.js under Metro, which
 * is 6.86 MB of icon data - every icon in the set. Metro does not tree-shake
 * across modules by default, so a single named import from the barrel would
 * pull all of it into the bundle. The package's `./*` subpath export maps to
 * one ~1 KB file per icon, so the twenty below cost roughly 20 KB together.
 *
 * Each per-icon file is `module.exports = <array>` in CJS and `export default`
 * in ESM, hence the default imports.
 */
export type GlyphName =
  | AgentCategory
  | "discover"
  | "categories"
  | "search"
  | "agents"
  | "wallet"
  | "shield"
  | "clock"
  | "revoke"
  | "check"
  | "copy"
  | "sparkle"
  | "layers"
  | "info"
  | "chevron-right"
  | "chevron-left"
  | "close"
  | "arrow-right"
  // Added with the Hugeicons switch: these three were previously drawn as raw
  // Unicode characters (↓ ↗ ↻) in wallet-overview.tsx because this file had no
  // equivalent. They are real icons now, so the text fallbacks can go.
  | "receive"
  | "external"
  | "refresh";

/**
 * Every glyph name that is now a Hugeicons mark. A name absent from this map
 * falls through to the hand-drawn category glyphs below, which is what keeps
 * the two systems from silently overlapping.
 */
const HUGEICONS: Partial<Record<GlyphName, IconSvgElement>> = {
  discover: Compass01Icon,
  categories: GridViewIcon,
  search: Search01Icon,
  agents: Robot01Icon,
  wallet: Wallet01Icon,
  shield: Shield01Icon,
  clock: Clock01Icon,
  revoke: ShieldOffIcon,
  check: Tick01Icon,
  copy: Copy01Icon,
  sparkle: SparklesIcon,
  layers: Layers01Icon,
  info: InformationCircleIcon,
  "chevron-right": ArrowRight01Icon,
  "chevron-left": ArrowLeft01Icon,
  close: Cancel01Icon,
  "arrow-right": ArrowRight02Icon,
  receive: ArrowDown01Icon,
  external: ArrowUpRight01Icon,
  refresh: Refresh01Icon,
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
     * That one hardcoded a gold disc with a white tick and ignored the prop
     * entirely, so call sites passing a colour (altana-wallet-card passes green
     * when a copy succeeds) were silently overridden. They now get the colour
     * they asked for.
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

  // Build ONE flat props object per element. Do not write
  // {...common} strokeWidth={n}: a JSX spread followed by an override of a
  // key the spread already set makes react-native-svg 15.15.4 paint nothing on
  // Android under React Native 0.86's Props 2.0. That pattern appeared on 21
  // lines, all of them inside the five category glyphs - and those were exactly
  // the five that rendered blank on Android while every other glyph in this
  // file, which never used the pattern, rendered correctly.
  const stroked = (width: number) => ({ ...common, strokeWidth: width });

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {name === "monitoring" ? (
        <>
          {/* Eye shape centered */}
          <Path d="M3 13s3.2-5.5 9-5.5 9 5.5 9 5.5-3.2 5.5-9 5.5-9-5.5-9-5.5Z" {...stroked(1.8)} />
          <Circle cx="12" cy="13" fill={color} r="2.6" />
          {/* Radar waves above centered */}
          <Path d="M14 4.5c1.8.8 3 2 3.8 3.5" {...stroked(1.5)} />
          <Path d="M16 2.5c2.5 1.2 4.2 3 5 5" {...stroked(1.5)} />
          {/* Magnifying handle */}
          <Path d="M17 18l3.5 3.5" {...stroked(2.2)} />
        </>
      ) : null}

      {name === "grid-trading" ? (
        <>
          <Line x1="4.5" x2="4.5" y1="5.5" y2="18.5" {...stroked(2.2)} />
          <Line x1="19.5" x2="19.5" y1="5.5" y2="18.5" {...stroked(2.2)} />
          <Line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="7.5" y2="7.5" {...stroked(1.2)} />
          <Line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="16.5" y2="16.5" {...stroked(1.2)} />
          <Path d="M4.5 12c2.5-5.5 5-5.5 7.5 0s5 5.5 7.5 0" {...stroked(2)} />
        </>
      ) : null}

      {name === "rebalancing" ? (
        <>
          {/* Two cycle arrows around a centered LP-range bracket */}
          <Path d="M6 8a6 6 0 0 1 10.5-3.3" {...stroked(2)} />
          <Path d="m16.5 2 1 3-3 .5" {...stroked(2)} />
          <Path d="M18 16a6 6 0 0 1-10.5 3.3" {...stroked(2)} />
          <Path d="m7.5 22-1-3 3-.5" {...stroked(2)} />
          <Line x1="12" x2="12" y1="9" y2="15" {...stroked(1.6)} />
        </>
      ) : null}

      {name === "health-factor" ? (
        <>
          <Path d="M11 20s6-3.2 6-8.5V5.5l-6-2.5-6 2.5v6C5 16.8 11 20 11 20Z" {...stroked(1.8)} />
          <Line x1="11" x2="11" y1="6.5" y2="14.5" {...stroked(1.8)} />
          <Line x1="8.5" x2="13.5" y1="9" y2="9" {...stroked(1.8)} />
          <Circle cx="17.5" cy="17.5" fill="#111215" r="3.8" />
          <Line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.4} x1="17.5" x2="17.5" y1="15.5" y2="17.5" />
          <Circle cx="17.5" cy="19.4" fill="#FFFFFF" r="0.6" />
        </>
      ) : null}

      {name === "yield" ? (
        <>
          <Path d="M11 20v-6.5c0-3.5 3.5-5.5 8-5.5-1 4.5-2.5 8-8 8" {...stroked(1.8)} />
          <Path d="M11 13.5c0-2.8-2.8-4.5-6.5-4.5 1 3.8 2.8 6.5 6.5 6.5" {...stroked(1.8)} />
          <Path d="M17.5 3.5l2 2-2 2" {...stroked(1.8)} />
          <Path d="M14.5 5.5h5" {...stroked(1.8)} />
        </>
      ) : null}

      {name === "trading" ? (
        <>
          {/* Candlesticks - wick plus body. Filled/hollow/filled, the
              conventional down/up/down reading, so it stays legible at 18px
              and cannot be confused with grid-trading's ladder. */}
          <Line x1="6.5" x2="6.5" y1="5" y2="19" {...stroked(1.6)} />
          <Rect fill={color} height="6" rx="1" width="4" x="4.5" y="9" />
          <Line x1="12" x2="12" y1="3.5" y2="17" {...stroked(1.6)} />
          <Rect height="7" rx="1" width="4" x="10" y="6.5" {...stroked(1.8)} />
          <Line x1="17.5" x2="17.5" y1="7" y2="21" {...stroked(1.6)} />
          <Rect fill={color} height="6" rx="1" width="4" x="15.5" y="11" />
        </>
      ) : null}

    </Svg>
  );
}
