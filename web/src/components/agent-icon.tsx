import { colors } from "@/constants/theme";
import { CategoryGlyph } from "@/components/category-glyph";
import type { AgentCategory } from "@/types/agent";

type AgentIconProps = {
  category: AgentCategory;
  size?: number;
  uri?: string | null;
};

const categoryBgColors: Record<AgentCategory, string> = {
  monitoring: "#F5F3EC",
  "grid-trading": "#FAF5E6",
  "health-factor": "#F9F3F0",
  yield: "#F0F7F2",
};

export function AgentIcon({ category, size = 48, uri }: AgentIconProps) {
  if (uri) {
    return (
      <div
        className="overflow-hidden rounded-2xl border"
        style={{
          width: size,
          height: size,
          borderColor: "rgba(17,18,20,0.06)",
          flexShrink: 0,
        }}
      >
        <img
          alt=""
          src={uri}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-2xl border"
      style={{
        width: size,
        height: size,
        backgroundColor: categoryBgColors[category] ?? "#F5F3EC",
        borderColor: "rgba(17,18,20,0.04)",
        flexShrink: 0,
      }}
    >
      <CategoryGlyph
        color={colors.ink}
        name={category}
        size={size * 0.45}
        strokeWidth={2}
      />
    </div>
  );
}
