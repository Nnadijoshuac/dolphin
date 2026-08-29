/* Dynamic registry artwork can come from publisher-controlled hosts that are
 * intentionally not allowlisted in Next config, so a native image preserves
 * compatibility with the shared catalog here. */
/* eslint-disable @next/next/no-img-element */

import { CategoryGlyph } from "@/components/category-glyph";
import type { AgentCategory } from "@/types/agent";

type AgentIconProps = {
  category: AgentCategory;
  size?: number;
  uri?: string | null;
};

export function AgentIcon({ category, size = 48, uri }: AgentIconProps) {
  const dimensions = { width: size, height: size, flexShrink: 0 };

  if (uri) {
    return (
      <div
        className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface-subtle)]"
        style={dimensions}
      >
        <img
          alt=""
          className="h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          src={uri}
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface-subtle)]"
      style={dimensions}
    >
      <CategoryGlyph
        color="var(--ink)"
        name={category}
        size={size * 0.43}
        strokeWidth={1.8}
      />
    </div>
  );
}
