import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

type GlyphName = AgentCategory | "discover" | "search" | "agents" | "wallet";

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
          <Path d="M3 12h3l2.2-5 3.2 10 2.5-6 1.7 3H21" {...common} />
          <Circle cx="12" cy="12" r="9" {...common} />
        </>
      ) : null}
      {name === "grid-trading" ? (
        <>
          <Rect height="16" rx="2" width="16" x="4" y="4" {...common} />
          <Line x1="9.3" x2="9.3" y1="4" y2="20" {...common} />
          <Line x1="14.7" x2="14.7" y1="4" y2="20" {...common} />
          <Line x1="4" x2="20" y1="9.3" y2="9.3" {...common} />
          <Line x1="4" x2="20" y1="14.7" y2="14.7" {...common} />
        </>
      ) : null}
      {name === "health-factor" ? (
        <>
          <Path d="M12 21s-7.5-4.4-7.5-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 3.1C19.5 16.6 12 21 12 21Z" {...common} />
          <Path d="M8 12h2l1-2.4 2 5 1.2-2.6H16" {...common} />
        </>
      ) : null}
      {name === "yield" ? (
        <>
          <Path d="M6 19c0-7.5 4.1-11.6 12.2-13.1C17.1 14 13 18 6 19Z" {...common} />
          <Path d="M6 19c2.7-4 5.7-6.7 9.1-8.2" {...common} />
          <Path d="M6 19v2" {...common} />
        </>
      ) : null}
      {name === "discover" ? (
        <>
          <Circle cx="12" cy="12" r="8.5" {...common} />
          <Path d="m14.8 9.2-1.5 4.1-4.1 1.5 1.5-4.1 4.1-1.5Z" {...common} />
        </>
      ) : null}
      {name === "search" ? (
        <>
          <Circle cx="10.6" cy="10.6" r="6.4" {...common} />
          <Line x1="15.4" x2="20" y1="15.4" y2="20" {...common} />
        </>
      ) : null}
      {name === "agents" ? (
        <>
          <Rect height="13" rx="3" width="16" x="4" y="7" {...common} />
          <Path d="M9 7V5.8A2.2 2.2 0 0 1 11.2 3h1.6A2.2 2.2 0 0 1 15 5.2V7" {...common} />
          <Circle cx="9" cy="13" r="1" fill={color} />
          <Circle cx="15" cy="13" r="1" fill={color} />
          <Path d="M9.5 16.5h5" {...common} />
        </>
      ) : null}
      {name === "wallet" ? (
        <>
          <Rect height="14" rx="3" width="18" x="3" y="5" {...common} />
          <Path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z" {...common} />
          <Circle cx="16.5" cy="12.5" fill={color} r=".8" />
        </>
      ) : null}
    </Svg>
  );
}

