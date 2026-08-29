"use client";

import Link from "next/link";
import { CategoryGlyph } from "@/components/category-glyph";
import { colors, shadows } from "@/constants/theme";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

type AgentCardProps = {
  agent: Agent;
};

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link
      href={`/agent/${agent.tokenId}`}
      className="pressable-scale block rounded-3xl border bg-white p-4 no-underline transition-shadow duration-200 hover:shadow-lg"
      style={{
        borderColor: "rgba(17,18,20,0.06)",
        boxShadow: shadows.subtle,
      }}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border"
          style={{
            backgroundColor: "#F5F3EC",
            borderColor: "rgba(17,18,20,0.04)",
          }}
        >
          <CategoryGlyph
            color={colors.ink}
            name={agent.category}
            size={38}
            strokeWidth={2.2}
          />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3
            className="text-[17px] font-bold tracking-tight truncate"
            style={{ color: colors.ink }}
          >
            {agent.name}
          </h3>

          <p
            className="mt-1 line-clamp-2 text-[13px] leading-[18px]"
            style={{ color: "#4A4B4F" }}
          >
            {agent.tagline}
          </p>

          {/* Category tag */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span className="text-[12px] font-medium text-zinc-500">
              {categoryLabels[agent.category]}
            </span>
          </div>

          {/* Status & CTA */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CategoryGlyph color="#8C8E88" name="sparkle" size={13} />
              <span className="text-[11.5px] font-medium text-zinc-500">
                Syncing BSC data
              </span>
            </div>

            <span
              className="flex items-center justify-center rounded-xl px-4 py-1.5 text-[13px] font-bold text-black"
              style={{
                backgroundColor: colors.gold,
                minWidth: 64,
                boxShadow: shadows.subtle,
              }}
            >
              View
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
