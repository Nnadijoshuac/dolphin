import type { AgentCategory } from "@/types/agent";
import { colors } from "@/constants/theme";

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
    <svg height={size} viewBox="0 0 24 24" width={size}>
      {name === "monitoring" && (
        <>
          <path d="M3 13s3.2-5.5 9-5.5 9 5.5 9 5.5-3.2 5.5-9 5.5-9-5.5-9-5.5Z" {...common} strokeWidth={1.8} />
          <circle cx="12" cy="13" fill={color} r="2.6" />
          <path d="M14 4.5c1.8.8 3 2 3.8 3.5" {...common} strokeWidth={1.5} />
          <path d="M16 2.5c2.5 1.2 4.2 3 5 5" {...common} strokeWidth={1.5} />
          <path d="M17 18l3.5 3.5" {...common} strokeWidth={2.2} />
        </>
      )}

      {name === "grid-trading" && (
        <>
          <line x1="4.5" x2="4.5" y1="5.5" y2="18.5" {...common} strokeWidth={2.2} />
          <line x1="19.5" x2="19.5" y1="5.5" y2="18.5" {...common} strokeWidth={2.2} />
          <line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="7.5" y2="7.5" {...common} strokeWidth={1.2} />
          <line strokeDasharray="3,2" x1="4.5" x2="19.5" y1="16.5" y2="16.5" {...common} strokeWidth={1.2} />
          <path d="M4.5 12c2.5-5.5 5-5.5 7.5 0s5 5.5 7.5 0" {...common} strokeWidth={2} />
        </>
      )}

      {name === "health-factor" && (
        <>
          <path d="M11 20s6-3.2 6-8.5V5.5l-6-2.5-6 2.5v6C5 16.8 11 20 11 20Z" {...common} strokeWidth={1.8} />
          <line x1="11" x2="11" y1="6.5" y2="14.5" {...common} strokeWidth={1.8} />
          <line x1="8.5" x2="13.5" y1="9" y2="9" {...common} strokeWidth={1.8} />
          <circle cx="17.5" cy="17.5" fill="#111215" r="3.8" />
          <line stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.4} x1="17.5" x2="17.5" y1="15.5" y2="17.5" />
          <circle cx="17.5" cy="19.4" fill="#FFFFFF" r="0.6" />
        </>
      )}

      {name === "yield" && (
        <>
          <path d="M11 20v-6.5c0-3.5 3.5-5.5 8-5.5-1 4.5-2.5 8-8 8" {...common} strokeWidth={1.8} />
          <path d="M11 13.5c0-2.8-2.8-4.5-6.5-4.5 1 3.8 2.8 6.5 6.5 6.5" {...common} strokeWidth={1.8} />
          <path d="M17.5 3.5l2 2-2 2" {...common} strokeWidth={1.8} />
          <path d="M14.5 5.5h5" {...common} strokeWidth={1.8} />
        </>
      )}

      {name === "discover" && (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="m15.5 8.5-2.5 5-5 2.5 2.5-5 5-2.5Z" {...common} />
          <circle cx="12" cy="12" fill={color} r="1" />
        </>
      )}

      {name === "categories" && (
        <>
          <rect height="7" rx="2" width="7" x="4" y="4" {...common} />
          <rect height="7" rx="2" width="7" x="13" y="4" {...common} />
          <rect height="7" rx="2" width="7" x="4" y="13" {...common} />
          <rect height="7" rx="2" width="7" x="13" y="13" {...common} />
        </>
      )}

      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="7" {...common} />
          <line x1="16.5" x2="21" y1="16.5" y2="21" {...common} />
        </>
      )}

      {name === "agents" && (
        <>
          <rect height="12" rx="3.5" width="16" x="4" y="8" {...common} />
          <line x1="12" x2="12" y1="4" y2="8" {...common} />
          <circle cx="12" cy="3" fill={color} r="1.5" />
          <circle cx="9" cy="13" fill={color} r="1.2" />
          <circle cx="15" cy="13" fill={color} r="1.2" />
          <line x1="9" x2="15" y1="16" y2="16" {...common} />
        </>
      )}

      {name === "wallet" && (
        <>
          <rect height="14" rx="3" width="18" x="3" y="5" {...common} />
          <path d="M15 10h6v4h-6a2 2 0 0 1 0-4Z" {...common} />
          <circle cx="16.5" cy="12" fill={color} r="0.8" />
        </>
      )}

      {name === "shield" && (
        <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11Z" {...common}>
          <path d="m9 12 2 2 4-4" {...common} />
        </path>
      )}

      {name === "clock" && (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M12 7v5l3 2" {...common} />
        </>
      )}

      {name === "revoke" && (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <line x1="6" x2="18" y1="6" y2="18" {...common} />
        </>
      )}

      {name === "check" && (
        <>
          <circle cx="12" cy="12" fill={colors.gold} r="9" />
          <path d="m8.5 12 2.5 2.5 5-5" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </>
      )}

      {name === "sparkle" && (
        <path
          d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"
          fill={color}
        />
      )}

      {name === "layers" && (
        <>
          <path d="m12 2 10 5-10 5-10-5 10-5Z" {...common} />
          <path d="m2 12 10 5 10-5" {...common} />
          <path d="m2 17 10 5 10-5" {...common} />
        </>
      )}

      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <line x1="12" x2="12" y1="11" y2="16" {...common} />
          <circle cx="12" cy="8" fill={color} r="1" />
        </>
      )}

      {name === "chevron-right" && (
        <path d="m9 18 6-6-6-6" {...common} />
      )}

      {name === "arrow-right" && (
        <>
          <line x1="5" x2="19" y1="12" y2="12" {...common} />
          <path d="m12 5 7 7-7 7" {...common} />
        </>
      )}
    </svg>
  );
}
