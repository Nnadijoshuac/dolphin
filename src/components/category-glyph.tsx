import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

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
  | "arrow-right";

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
  const common = {
    fill: "none",
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {name === "monitoring" ? (
        <>
          {/* Eye with radar waves & lens */}
          <Path d="M2 13s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" {...common} strokeWidth={2} />
          <Circle cx="12" cy="13" fill={color} r="3" />
          {/* Radar waves above */}
          <Path d="M15 4c2 .8 3.5 2.2 4.5 4" {...common} strokeWidth={1.8} />
          <Path d="M18 2c2.5 1.2 4.5 3.2 5.5 5.5" {...common} strokeWidth={1.8} />
          {/* Handle */}
          <Path d="M18 19l4 4" {...common} strokeWidth={2.8} />
        </>
      ) : null}

      {name === "grid-trading" ? (
        <>
          {/* Vertical brackets */}
          <Line x1="4" x2="4" y1="5" y2="19" {...common} strokeWidth={2.8} />
          <Line x1="20" x2="20" y1="5" y2="19" {...common} strokeWidth={2.8} />
          {/* Dashed boundary lines */}
          <Line strokeDasharray="3,2" x1="4" x2="20" y1="7" y2="7" {...common} strokeWidth={1.5} />
          <Line strokeDasharray="3,2" x1="4" x2="20" y1="17" y2="17" {...common} strokeWidth={1.5} />
          {/* Oscillating wave */}
          <Path d="M4 12c2.5-6 5.5-6 8 0s5.5 6 8 0" {...common} strokeWidth={2.4} />
        </>
      ) : null}

      {name === "health-factor" ? (
        <>
          {/* Shield */}
          <Path d="M12 21s7-3.8 7-9.5V5l-7-3-7 3v6.5C5 17.2 12 21 12 21Z" {...common} strokeWidth={2} />
          {/* Sword */}
          <Line x1="12" x2="12" y1="6" y2="15" {...common} strokeWidth={2.2} />
          <Line x1="9" x2="15" y1="9" y2="9" {...common} strokeWidth={2.2} />
          {/* Exclamation badge */}
          <Circle cx="18" cy="18" fill="#111215" r="4.5" />
          <Line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} x1="18" x2="18" y1="15" y2="18" />
          <Circle cx="18" cy="20.2" fill="#FFFFFF" r="0.8" />
        </>
      ) : null}

      {name === "yield" ? (
        <>
          {/* Sprout seedling with growth arrow */}
          <Path d="M12 21v-7c0-4 4-6 9-6-1 5-3 9-9 9" {...common} strokeWidth={2} />
          <Path d="M12 14c0-3-3-5-7-5 1 4 3 7 7 7" {...common} strokeWidth={2} />
          <Path d="M19 4l2 2-2 2" {...common} strokeWidth={2} />
          <Path d="M16 6h5" {...common} strokeWidth={2} />
        </>
      ) : null}

      {name === "discover" ? (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="m15.5 8.5-2.5 5-5 2.5 2.5-5 5-2.5Z" {...common} />
          <Circle cx="12" cy="12" fill={color} r="1" />
        </>
      ) : null}

      {name === "categories" ? (
        <>
          {/* 4 Square Tiles */}
          <Rect height="7" rx="2" width="7" x="4" y="4" {...common} />
          <Rect height="7" rx="2" width="7" x="13" y="4" {...common} />
          <Rect height="7" rx="2" width="7" x="4" y="13" {...common} />
          <Rect height="7" rx="2" width="7" x="13" y="13" {...common} />
        </>
      ) : null}

      {name === "search" ? (
        <>
          <Circle cx="11" cy="11" r="7" {...common} />
          <Line x1="16.5" x2="21" y1="16.5" y2="21" {...common} />
        </>
      ) : null}

      {name === "agents" ? (
        <>
          {/* Bot / Agent face with antenna */}
          <Rect height="12" rx="3.5" width="16" x="4" y="8" {...common} />
          <Line x1="12" x2="12" y1="4" y2="8" {...common} />
          <Circle cx="12" cy="3" fill={color} r="1.5" />
          <Circle cx="9" cy="13" fill={color} r="1.2" />
          <Circle cx="15" cy="13" fill={color} r="1.2" />
          <Line x1="9" x2="15" y1="16" y2="16" {...common} />
        </>
      ) : null}

      {name === "wallet" ? (
        <>
          <Rect height="14" rx="3" width="18" x="3" y="5" {...common} />
          <Path d="M15 10h6v4h-6a2 2 0 0 1 0-4Z" {...common} />
          <Circle cx="16.5" cy="12" fill={color} r="0.8" />
        </>
      ) : null}

      {name === "shield" ? (
        <>
          <Path
            d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11Z"
            {...common}
          />
          <Path d="m9 12 2 2 4-4" {...common} />
        </>
      ) : null}

      {name === "clock" ? (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M12 7v5l3 2" {...common} />
        </>
      ) : null}

      {name === "revoke" ? (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Line x1="6" x2="18" y1="6" y2="18" {...common} />
        </>
      ) : null}

      {name === "check" ? (
        <>
          <Circle cx="12" cy="12" fill={colors.gold} r="9" />
          <Path d="m8.5 12 2.5 2.5 5-5" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </>
      ) : null}

      {name === "copy" ? (
        <>
          <Rect height="10" rx="2" width="10" x="9" y="9" {...common} />
          <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" {...common} />
        </>
      ) : null}

      {name === "sparkle" ? (
        <>
          <Path
            d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"
            fill={color}
          />
        </>
      ) : null}

      {name === "layers" ? (
        <>
          <Path d="m12 2 10 5-10 5-10-5 10-5Z" {...common} />
          <Path d="m2 12 10 5 10-5" {...common} />
          <Path d="m2 17 10 5 10-5" {...common} />
        </>
      ) : null}

      {name === "info" ? (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Line x1="12" x2="12" y1="11" y2="16" {...common} />
          <Circle cx="12" cy="8" fill={color} r="1" />
        </>
      ) : null}

      {name === "chevron-right" ? (
        <Path d="m9 18 6-6-6-6" {...common} />
      ) : null}

      {name === "arrow-right" ? (
        <>
          <Line x1="5" x2="19" y1="12" y2="12" {...common} />
          <Path d="m12 5 7 7-7 7" {...common} />
        </>
      ) : null}
    </Svg>
  );
}
