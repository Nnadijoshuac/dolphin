/* eslint-disable @next/next/no-img-element */
import { CategoryGlyph } from "@/components/category-glyph";
import type { AgentCategory } from "@/types/agent";

const categoryBgColors: Record<AgentCategory, { bg: string; border: string; glyphColor: string }> = {
  rebalancing: { bg: "#FEF5D6", border: "#F3E3A6", glyphColor: "#946B00" },
  "grid-trading": { bg: "#DDE9F8", border: "#C6D8EE", glyphColor: "#295C92" },
  "health-factor": { bg: "#DCEFE4", border: "#BFE0CC", glyphColor: "#1C6A44" },
  yield: { bg: "#E9E1F4", border: "#D8CAE8", glyphColor: "#65478A" },
  monitoring: { bg: "#F5F3EB", border: "#ECE8DE", glyphColor: "#303236" },
  trading: { bg: "#F7DFD8", border: "#EFCDC2", glyphColor: "#964C3C" },
};

type AgentIconProps = {
  category: AgentCategory;
  size?: number;
  uri?: string | null;
};

export function AgentIcon({ category, size = 48, uri }: AgentIconProps) {
  const config = categoryBgColors[category] ?? categoryBgColors.monitoring;
  const dimensions = { width: size, height: size, flexShrink: 0 };

  return (
    <div
      aria-hidden="true"
      className="relative flex items-center justify-center overflow-hidden rounded-[14px] border"
      style={{
        ...dimensions,
        backgroundColor: config.bg,
        borderColor: config.border,
      }}
    >
      <CategoryGlyph
        color={config.glyphColor}
        name={category}
        size={size * 0.44}
        strokeWidth={2}
      />
      {uri ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          src={uri}
        />
      ) : null}
    </div>
  );
}
