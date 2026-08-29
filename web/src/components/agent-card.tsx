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
    : "Verified Operator";

  return (
    <Link
      className={`pressable-scale group relative flex flex-col justify-between rounded-3xl border border-[#ECE8DE] bg-white p-6 no-underline shadow-[0_2px_12px_rgba(17,18,20,0.04)] hover:border-[#F5B300]/40 hover:shadow-[0_12px_32px_rgba(17,18,20,0.08)] ${className}`}
      href={`/agent/${agent.tokenId}`}
    >
      <div>
        {/* Top Bar: Icon + Category Badge + Token ID */}
        <div className="flex items-start justify-between gap-4">
          <AgentIcon category={agent.category} size={64} uri={agent.iconUrl} />
          <div className="flex flex-col items-end gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide"
              style={{
                backgroundColor: pillStyle.bg,
                color: pillStyle.text,
                border: `1px solid ${pillStyle.border}`,
              }}
            >
              <CategoryGlyph color={pillStyle.text} name={agent.category} size={12} strokeWidth={2.4} />
              {categoryConfig.label}
            </span>
            <span className="font-mono text-[10.5px] font-semibold text-[#A5A79F]">
              ID #{agent.tokenId}
            </span>
          </div>
        </div>

        {/* Agent Info: Name + Tagline */}
        <div className="mt-5">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black tracking-tight text-[#111214] group-hover:text-[#946B00] transition-colors">
              {agent.name}
            </h3>
            <span title="ERC-8004 Verified on BSC">
              <CategoryGlyph color="#F5B300" name="shield" size={15} strokeWidth={2.5} />
            </span>
          </div>

          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#6E706B]">
            {agent.tagline}
          </p>
        </div>

        {/* Verified Skills Tags */}
        {agent.verifiedSkills && agent.verifiedSkills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {agent.verifiedSkills.slice(0, 3).map((skill) => (
              <span
                className="rounded-lg border border-[#ECE8DE] bg-[#FBF9F4] px-2.5 py-1 text-[11px] font-semibold text-[#303236]"
                key={skill}
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Card Footer: Publisher & CTA */}
      <div className="mt-6 flex items-center justify-between border-t border-[#F3F0E8] pt-4">
        <div className="min-w-0">
          <span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#A5A79F]">
            PUBLISHER
          </span>
          <span className="block truncate font-mono text-xs font-bold text-[#303236]">
            {displayPublisher}
          </span>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl bg-[#F5B300] px-4 py-2 text-xs font-black text-[#111214] shadow-sm group-hover:bg-[#E2A500] transition-colors">
          <span>View Proof</span>
          <CategoryGlyph color="#111214" name="arrow-right" size={13} strokeWidth={2.5} />
        </div>
      </div>
    </Link>
  );
}
