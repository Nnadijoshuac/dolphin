"use client";

import { useQuery } from "convex/react";

import { blockSummary } from "@/components/agent-canvas";
import { draftGaps, type AgentDraft } from "@/components/agent-draft-panel";
import { strategyApi, type TradingRuleView } from "@/convex/api";

/**
 * WHAT I BUILT, FROM WHAT WAS SAVED (owner, 2026-10-03; UI review point 2).
 *
 * The builder's reply is the model's prose, and prose can be wrong: "5x, $100 a trade" while
 * the saved rule says 2x and $50. This card is drawn only from the saved draft and its rules,
 * so it cannot disagree with what the agent will do. "Needs your attention" lists only real
 * gaps - what draftGaps says is missing, and the warnings and pauses the rule engine itself
 * reported - never a generic checklist.
 */
const TRIGGERS = new Set(["schedule", "price", "walletWatch", "signal"]);
const VENUE: Record<TradingRuleView["venue"], string> = {
  "dolphin-wallet": "Dolphin Wallet",
  "binance-wallet": "Binance Wallet",
  "binance-spot": "Binance spot",
  "binance-futures": "Binance futures",
};

const money = (usd: number) => `$${usd.toLocaleString("en", { maximumFractionDigits: 2 })}`;

export function BuiltSummary({ conversationKey, draft, onReview }: { conversationKey: string; draft: AgentDraft; onReview?: () => void }) {
  const view = useQuery(strategyApi.strategy.forConversation, { conversationKey });
  if (view === undefined || !draft.name?.trim()) return null;

  const blocks = draft.blocks ?? [];
  const rules = view.rules;
  const when = blocks.filter((block) => TRIGGERS.has(block.type)).map((block) => blockSummary(block).title);
  const risk = blocks.find((block) => block.type === "risk");
  const swap = blocks.some((block) => block.type === "swap");

  const doLines = [
    ...rules.map(
      (rule) =>
        `${rule.action === "short" ? "Short" : "Buy"} ${rule.market} · ${VENUE[rule.venue]}${rule.leverage > 1 ? ` · ${rule.leverage}x` : ""} · ${money(rule.sizeUsd)}`,
    ),
    ...(swap ? [`Buy / sell on PancakeSwap · ${draft.paperMode === false ? "live, with your trade key" : "on paper"}`] : []),
  ];
  const riskLines = [
    ...(risk && risk.type === "risk" ? [`${money(risk.config.maxTradeUsd)} a trade · at most ${risk.config.maxTradesPerDay} a day`] : []),
    ...rules.filter((rule) => rule.stopLossPct !== null).map((rule) => `${rule.market} stop-loss ${rule.stopLossPct}%`),
    ...(view.dailyLossLimitUsd !== null ? [`Stops for the day after ${money(view.dailyLossLimitUsd)} lost`] : []),
  ];
  const tools = [
    ...draft.tools.map((tool) => tool.toolName),
    ...(draft.knowledgeToolCount ? [`${draft.knowledgeToolCount} document tool${draft.knowledgeToolCount === 1 ? "" : "s"}`] : []),
  ];

  const attention = [
    ...draftGaps(draft).map((gap) => `Add ${gap}`),
    ...rules.flatMap((rule) => rule.warnings),
    ...rules.flatMap((rule) => (rule.lastError ? [rule.lastError] : [])),
  ];

  const sections: { label: string; lines: string[] }[] = [
    { label: "When", lines: when },
    { label: "Rules", lines: rules.map((rule) => rule.words) },
    { label: "Does", lines: doLines },
    { label: "Limits", lines: riskLines },
    { label: "Tools", lines: tools },
    { label: "Thinks with", lines: draft.brain ? [draft.brain.model] : [] },
  ].filter((section) => section.lines.length > 0);
  if (sections.length === 0) return null;

  return (
    <div className="built-summary">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">What I built</p>
      <p className="mt-0.5 text-[0.98rem] font-semibold tracking-[-0.01em] text-ink">{draft.name}</p>
      <dl className="mt-2.5 space-y-2">
        {sections.map((section) => (
          <div className="grid grid-cols-[5.5rem_1fr] gap-x-3" key={section.label}>
            <dt className="pt-px text-[0.72rem] font-medium text-muted">{section.label}</dt>
            <dd className="min-w-0 space-y-0.5">
              {section.lines.map((line) => (
                <p className="text-[0.84rem] leading-snug text-ink" key={line}>
                  {line}
                </p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {rules.length > 0 ? (
        <p className="mt-2.5 text-[0.72rem] leading-snug text-muted">Rules trade on paper inside Dolphin. Real orders run only on your own server.</p>
      ) : null}
      {attention.length > 0 ? (
        <div className="mt-3 border-t border-line/60 pt-2.5">
          <p className="text-[0.72rem] font-semibold text-ink">
            {attention.length === 1 ? "1 thing needs your attention" : `${attention.length} things need your attention`}
          </p>
          <ul className="mt-1 space-y-1">
            {attention.map((line) => (
              <li className="flex gap-2 text-[0.8rem] leading-snug text-ink-soft" key={line}>
                <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {onReview ? (
        <button className="mt-3 rounded-full border border-line px-3 py-1 !text-[12px] font-semibold text-ink lg:hidden" onClick={onReview} type="button">
          Review agent
        </button>
      ) : null}
    </div>
  );
}
