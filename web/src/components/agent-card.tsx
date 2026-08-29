"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { AGENT_CATEGORIES } from "@/constants/agents";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryPillStyles: Record<AgentCategory, { bg: string; text: string; border: string }> = {
  rebalancing: { bg: "#FEF5D6", text: "#946B00", border: "#F3E3A6" },
  "grid-trading": { bg: "#DDE9F8", text: "#295C92", border: "#C6D8EE" },
  "health-factor": { bg: "#DCEFE4", text: "#1C6A44", border: "#BFE0CC" },
  yield: { bg: "#E9E1F4", text: "#65478A", border: "#D8CAE8" },
  monitoring: { bg: "#F5F3EB", text: "#4A4B4F", border: "#ECE8DE" },
};

type AgentCardProps = {
  agent: Agent;
  className?: string;
};

export function AgentCard({ agent, className = "" }: AgentCardProps) {
  const categoryConfig =
    AGENT_CATEGORIES.find((c) => c.slug === agent.category) ?? AGENT_CATEGORIES[0];
  const pillStyle = categoryPillStyles[agent.category] ?? categoryPillStyles.monitoring;

  // Shorten publisher address
  const displayPublisher = agent.publisher
    ? agent.publisher.startsWith("0x") && agent.publisher.length > 16
      ? `${agent.publisher.slice(0, 6)}...${agent.publisher.slice(-4)}`
      : agent.publisher
    : "Verified Publisher";

  // App Store rating display (e.g. 4.9 or score)
  const ratingScore = agent.reputationScore !== undefined && typeof agent.reputationScore === "number"
    ? (agent.reputationScore / 20).toFixed(1)
    : "4.9";

  return (
    <Link
      className={`pressable-scale group relative flex flex-col justify-between rounded-3xl border border-[#ECE8DE] bg-white p-6 no-underline shadow-[0_2px_12px_rgba(17,18,20,0.04)] hover:border-[#F5B300]/50 hover:shadow-[0_12px_32px_rgba(17,18,20,0.08)] ${className}`}
      href={`/agent/${agent.tokenId}`}
    >
      <div>
        {/* App Store Top Header: Icon + Details + GET CTA */}
        <div className="flex items-start gap-4">
          <AgentIcon category={agent.category} size={64} uri={agent.iconUrl} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-lg font-black tracking-tight text-[#111214] group-hover:text-[#946B00] transition-colors">
                {agent.name}
              </h3>
              <span title="ERC-8004 Verified on BSC">
                <CategoryGlyph color="#1C6A44" name="shield" size={14} strokeWidth={2.4} />
              </span>
            </div>

            <p className="mt-0.5 truncate text-xs font-semibold text-[#6E706B]">
              {categoryConfig.label} • {displayPublisher}
            </p>

            {/* App Store Rating & Status Row */}
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="flex items-center gap-1 font-black text-[#946B00]">
                <span>★</span>
                <span>{ratingScore}</span>
              </span>
              <span className="text-[#A5A79F]">•</span>
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase"
                style={{
                  backgroundColor: pillStyle.bg,
                  color: pillStyle.text,
                }}
              >
                {categoryConfig.label}
              </span>
            </div>
          </div>
        </div>

        {/* Tagline / Pitch */}
        <p className="mt-4 line-clamp-2 text-xs leading-relaxed text-[#4A4B4F]">
          {agent.tagline}
        </p>

        {/* Verified Skills / Feature Tags */}
        {agent.verifiedSkills && agent.verifiedSkills.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {agent.verifiedSkills.slice(0, 2).map((skill) => (
              <span
                className="rounded-lg border border-[#ECE8DE] bg-[#FBF9F4] px-2 py-0.5 text-[10.5px] font-semibold text-[#303236]"
                key={skill}
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Card Footer: Pricing & App Store GET button */}
      <div className="mt-5 flex items-center justify-between border-t border-[#F3F0E8] pt-3.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-mono text-[11px] font-semibold text-[#A5A79F]">
            #{agent.tokenId}
          </span>
          <span className="text-[#A5A79F]">•</span>
          <span className="font-extrabold uppercase tracking-wider text-[#1C6A44]">
            Free Proof
          </span>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-[#F5B300] px-4 py-1.5 text-xs font-black text-[#111214] shadow-sm group-hover:bg-[#E2A500] transition-colors">
          <span>GET</span>
        </div>
      </div>
    </Link>
  );
}
