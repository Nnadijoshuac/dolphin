import type { ReactNode } from "react";
import { useState } from "react";
import { Text, View, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii, shadows } from "@/constants/theme";
import { syncingLiveStats } from "@/data/editorial-agents";
import {
  useAgentCategoryStats,
  useAgentRetention,
  useAgentStatsHistory,
} from "@/hooks/use-category-stats";
import { useAgentReviews } from "@/hooks/use-agent-reviews";
import { convexClient } from "@/providers/convex-provider";
import { assessHireability } from "@/services/hireability";
import type {
  Agent,
  AgentCategory,
  AgentLiveStats,
  LiveMetric,
} from "@/types/agent";

/**
 * The agent detail page.
 *
 * ---------------------------------------------------------------------------
 * ONE SET OF TOKENS, USED EVERYWHERE ON THIS SCREEN
 * ---------------------------------------------------------------------------
 * This page had drifted into three card radii (14 / 18 / 24), four vertical
 * gaps, two nested horizontal scrollers and section headings that carried their
 * own horizontal padding on top of their parent's - so every heading sat 40pt
 * in while its own content sat at 20pt. Nothing below sets a radius, an inset or
 * a gap of its own: `Card`, `Section` and the three constants are the only
 * places those exist, which is what makes the page read as one surface rather
 * than as a pile of unrelated boxes.
 *
 * The page owns its horizontal inset ONCE, at the root. Sections never re-pad.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS REMOVED, AND WHY IT HAD TO BE (AGENTS.md §5)
 * ---------------------------------------------------------------------------
 * The previous version rendered, as if measured:
 *
 *   "4.9" trust rating          twice, hardcoded. No rating of any kind exists.
 *   five filled gold stars      hardcoded.
 *   92% / 8% / 0% / 0% / 0%     a star histogram. There is no per-star data in
 *                               the schema, or anywhere upstream of it.
 *   "Onchain audit: Verified"   nothing has been audited. The word was chosen
 *                               from `registered`, which means only that a token
 *                               exists in the ERC-8004 registry.
 *   "N+ Executions"             the length of the recentActivity array, which is
 *                               a page of indexed events, not a lifetime count.
 *   "BNB x402 Streaming"        printed flat, while x402Supported is a live
 *                               metric that is frequently unavailable.
 *   "Altana Passkey Protected / session delegation grants execution budget"
 *                               session execution is feature-gated OFF
 *                               (FEATURE_SESSION_EXECUTION in altana-policy.ts).
 *                               No agent can spend from a Dolphin Wallet today,
 *                               so this described a capability that is not
 *                               shipped.
 *
 * Every one of those is a plausible-looking number or claim presented as live
 * data about a real agent on a real chain, which is the single thing this
 * project's data-integrity rule exists to prevent. They are replaced by the
 * metrics that DO exist - reputation, feedback count, endpoint status, x402
 * support, registry verification - each rendered through MetricCell, which
 * already knows how to say "Syncing" and "Not reported" instead of inventing a
 * value. Where a section had no real source at all, the section is gone.
 *
 * A watchlist/bookmark button was removed for the same family of reason: it was
 * local useState with no store behind it, so it forgot the tap on unmount. The
 * codebase has deleted controls wired to nothing twice before (the website's
 * Send button, the recoverability panel's dead action) rather than leave them
 * looking live.
 */

/* ─────────────── tokens ─────────────── */

/** The page's single horizontal inset. Set once, at the root, never again. */
const GUTTER = 20;
/** The single vertical rhythm between sections. */
const SECTION_GAP = 30;
/** The single card radius on this page. */
const CARD_RADIUS = radii.large;

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
  trading: "Trading",
};

function shortAddress(value: string | null) {
  if (!value) return "Not reported";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatList(value: string[]) {
  return value.length > 0 ? value.join(", ") : "None";
}

/* ─────────────── primitives ─────────────── */

/**
 * The one card shape on this page. Every boxed thing is this, at this radius,
 * with this border and this shadow - so "a card" means one thing visually and
 * the eye stops cataloguing differences that carry no meaning.
 */
function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderRadius: CARD_RADIUS,
        borderWidth: 1,
        padding: 18,
        ...shadows.subtle,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

/**
 * A section: one heading, one body, one gap below. No horizontal padding of its
 * own - the page already applied it, and applying it twice is what pushed every
 * heading out of line with the content it labelled.
 */
function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <Text
        className="text-[17px] font-bold tracking-[-0.3px]"
        style={{ color: colors.ink }}
      >
        {title}
      </Text>
      {caption ? (
        <Text
          className="mt-1 text-[12px] leading-[17px]"
          style={{ color: colors.muted }}
        >
          {caption}
        </Text>
      ) : null}
      <View className="mt-3">{children}</View>
    </View>
  );
}

/** One label/value line inside a card. The only row shape on this page. */
function FactRow({
  label,
  value,
  isFirst = false,
}: {
  label: string;
  value: string;
  isFirst?: boolean;
}) {
  return (
    <View
      className="flex-row items-center justify-between gap-3"
      style={{
        borderTopColor: colors.lineLight,
        borderTopWidth: isFirst ? 0 : 1,
        paddingBottom: 11,
        paddingTop: isFirst ? 0 : 11,
      }}
    >
      <Text className="text-[12px] shrink-0" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text
        className="flex-1 text-right text-[12px] font-semibold"
        ellipsizeMode="middle"
        numberOfLines={1}
        style={{ color: colors.ink }}
      >
        {value}
      </Text>
    </View>
  );
}

/** A small pill. One shape, two tones - accented when the fact is verified. */
function Pill({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <View
      className="rounded-full px-3 py-1.5"
      style={{
        backgroundColor: accent ? colors.goldSoft : colors.surfaceSubtle,
        borderColor: accent ? colors.goldBorder : colors.line,
        borderWidth: 1,
      }}
    >
      <Text
        className="text-[12px] font-semibold"
        style={{ color: accent ? colors.goldDark : colors.inkSecondary }}
      >
        {label}
      </Text>
    </View>
  );
}

/* ─────────────── live stats ─────────────── */

function LiveStats({ agent }: { agent: Agent }) {
  if (!convexClient) {
    return <LiveStatsView stats={agent.liveStats} />;
  }

  return <BackendLiveStats agent={agent} />;
}

function BackendLiveStats({ agent }: { agent: Agent }) {
  const cached = useAgentCategoryStats(
    agent.tokenId,
    agent.category,
    agent.agentWallet,
  );
  const stats = cached?.stats ?? syncingLiveStats(agent.category);

  return <LiveStatsView stats={stats} />;
}

/**
 * The category's four metrics, two per row.
 *
 * Every cell is a MetricCell, which is the app's one presentation of a
 * LiveMetric and the reason an unread number reads as "Syncing" or "Not
 * reported" rather than as a figure.
 */
function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <Card>
      <View className="flex-row flex-wrap gap-y-5">
        {stats.category === "monitoring" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Alert frequency" metric={stats.alertFrequency} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={formatList} label="Assets watched" metric={stats.assetsWatched} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Last alert" metric={stats.lastAlertAt} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="False positives" metric={stats.falsePositiveRate} />
            </View>
          </>
        ) : null}
        {stats.category === "rebalancing" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Rebalance efficiency" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="LP positions" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "grid-trading" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Grid levels" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "health-factor" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Positions watched" metric={stats.positionsMonitored} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toFixed(2)} label="Average health" metric={stats.averageHealthFactor} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Liquidations prevented" metric={stats.liquidationsPrevented} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `${value} ms`} label="Response latency" metric={stats.responseLatencyMs} />
            </View>
          </>
        ) : null}
        {stats.category === "yield" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(2)}%`} label="Current APY" metric={stats.currentApy} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `$${value.toLocaleString()}`} label="TVL managed" metric={stats.tvlManagedUsd} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={formatList} label="Protocols" metric={stats.protocolsUsed} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Vault rebalance cadence" metric={stats.rebalanceFrequency} />
            </View>
          </>
        ) : null}
        {stats.category === "trading" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Trades executed" metric={stats.tradesExecuted} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Realized P&L" metric={stats.realizedPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={formatList} label="Markets traded" metric={stats.marketsTraded} />
            </View>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/* ─────────────── retention ─────────────── */

/**
 * How many people who hired this agent kept it.
 *
 * The first signal in this app that actually distinguishes one agent from
 * another: reputation is unavailable or zero across the catalog, feedback count
 * measures activity rather than quality, and every agent costs the same. This
 * is computed from Dolphin's own hire records (convex/agentRetention.ts), needs
 * nothing from the user, and is hard to forge now that a hire needs a signature.
 *
 * A percentage is shown only when the denominator can carry one. "100%" over a
 * single hire is true arithmetic and a false impression, so below the threshold
 * the raw counts are shown instead, and with no hire old enough the section
 * says so rather than showing a zero.
 */
function Retention({ agent }: { agent: Agent }) {
  if (!convexClient) return null;
  return <BackendRetention agent={agent} />;
}

function BackendRetention({ agent }: { agent: Agent }) {
  const retention = useAgentRetention(agent.tokenId);

  if (retention === undefined) {
    return (
      <StatePanel
        body="Reading Dolphin's hire records for this agent."
        compact
        state="syncing"
        title="Loading retention"
      />
    );
  }

  if (retention.totalHires === 0) {
    return (
      <StatePanel
        body="Nobody has hired this agent through Dolphin yet, so there is nothing to measure. This says nothing about the agent — only that Dolphin has no record of its own to report."
        compact
        state="empty"
        title="No hires yet"
      />
    );
  }

  const describe = (
    window: { eligible: number; retained: number; rate: number | null },
    label: string,
  ) => {
    if (window.eligible === 0) {
      return { label, value: "Not yet", detail: `No hire is ${label} old` };
    }
    if (window.rate === null) {
      return {
        label,
        value: `${window.retained}/${window.eligible}`,
        detail: "Too few to rate",
      };
    }
    return {
      label,
      value: `${Math.round(window.rate * 100)}%`,
      detail: `of ${window.eligible} hires`,
    };
  };

  const cells = [
    describe(retention.day7, "7 days"),
    describe(retention.day30, "30 days"),
  ];

  return (
    <Card>
      <View className="flex-row flex-wrap gap-y-5">
        {cells.map((cell, index) => (
          <View
            className={index % 2 === 0 ? "w-1/2 pr-2.5" : "w-1/2 pl-2.5"}
            key={cell.label}
          >
            <Text
              className="text-[11px] font-bold uppercase tracking-[0.8px]"
              style={{ color: colors.faint }}
            >
              Kept after {cell.label}
            </Text>
            <Text
              className="mt-1.5 text-[20px] font-bold"
              style={{ color: colors.ink }}
            >
              {cell.value}
            </Text>
            <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
              {cell.detail}
            </Text>
          </View>
        ))}
      </View>

      <View
        className="mt-4 flex-row items-center justify-between border-t pt-3"
        style={{ borderColor: colors.lineLight }}
      >
        <Text className="text-[12px]" style={{ color: colors.muted }}>
          Hires through Dolphin
        </Text>
        <Text className="text-[12px] font-semibold" style={{ color: colors.ink }}>
          {retention.activeHires} active of {retention.totalHires}
        </Text>
      </View>
    </Card>
  );
}

/* ─────────────── reviews ─────────────── */

/**
 * What people who actually hired this agent said about it.
 *
 * Structured outcomes rather than stars - see convex/agentReviews.ts for why,
 * and note that this file's own header lists a fabricated "4.9" and a fake star
 * histogram among the things deleted from this page. Putting that shape back
 * with real data underneath would answer the wrong question about software that
 * moves money.
 *
 * Every review here comes from a wallet that proved it holds its key, hired
 * this agent, and kept it for at least a day. A review whose hire went through
 * an escrow is marked, because real money changing hands is a materially
 * stronger signal than a free trial and the page should say so.
 */
function Reviews({ agent }: { agent: Agent }) {
  if (!convexClient) return null;
  return <BackendReviews agent={agent} />;
}

function BackendReviews({ agent }: { agent: Agent }) {
  const reviews = useAgentReviews(agent.tokenId);

  if (reviews === undefined) {
    return (
      <StatePanel
        body="Reading reviews left by wallets that hired this agent."
        compact
        state="syncing"
        title="Loading reviews"
      />
    );
  }

  if (reviews.total === 0) {
    return (
      <StatePanel
        body="Nobody who hired this agent has reviewed it yet. Only wallets that hired it can, which is what will make these worth reading."
        compact
        state="empty"
        title="No reviews yet"
      />
    );
  }

  const { outcomes } = reviews;

  return (
    <View className="gap-3">
      <Card>
        <View className="flex-row flex-wrap gap-y-5">
          <View className="w-1/2 pr-2.5">
            <Text
              className="text-[11px] font-bold uppercase tracking-[0.8px]"
              style={{ color: colors.faint }}
            >
              Would hire again
            </Text>
            <Text
              className="mt-1.5 text-[20px] font-bold"
              style={{ color: colors.ink }}
            >
              {reviews.wouldHireAgainRate === null
                ? `${reviews.wouldHireAgainCount}/${reviews.total}`
                : `${Math.round(reviews.wouldHireAgainRate * 100)}%`}
            </Text>
            <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
              {reviews.wouldHireAgainRate === null
                ? "Too few to rate"
                : `of ${reviews.total} reviews`}
            </Text>
          </View>
          <View className="w-1/2 pl-2.5">
            <Text
              className="text-[11px] font-bold uppercase tracking-[0.8px]"
              style={{ color: colors.faint }}
            >
              Did what it said
            </Text>
            <Text
              className="mt-1.5 text-[20px] font-bold"
              style={{ color: colors.ink }}
            >
              {outcomes.yes}
              <Text className="text-[13px]" style={{ color: colors.muted }}>
                {` yes · ${outcomes.partially} partly · ${outcomes.no} no`}
              </Text>
            </Text>
          </View>
        </View>

        {reviews.paidReviews > 0 ? (
          <View
            className="mt-4 border-t pt-3"
            style={{ borderColor: colors.lineLight }}
          >
            <Text className="text-[11px] leading-4" style={{ color: colors.muted }}>
              {reviews.paidReviews} of {reviews.total}{" "}
              {reviews.paidReviews === 1 ? "review is" : "reviews are"} from a hire
              that paid this agent through an on-chain escrow.
            </Text>
          </View>
        ) : null}
      </Card>

      {reviews.reviews.map((review) => (
        <Card key={`${review.walletAddress}-${review.updatedAt}`}>
          <View className="flex-row items-center justify-between gap-3">
            <Text
              className="shrink text-[12px] font-semibold"
              numberOfLines={1}
              style={{ color: colors.ink }}
            >
              {shortAddress(review.walletAddress)}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {review.paidJobId ? <Pill accent label="Paid hire" /> : null}
              {review.onChainTxHash ? <Pill accent label="On-chain" /> : null}
            </View>
          </View>

          <Text
            className="mt-2 text-[13px] font-semibold leading-[19px]"
            style={{ color: colors.ink }}
          >
            {review.outcome === "yes"
              ? "Did what it said"
              : review.outcome === "partially"
                ? "Partly did what it said"
                : "Did not do what it said"}
            {" · "}
            {review.wouldHireAgain ? "Would hire again" : "Would not hire again"}
          </Text>

          {review.comment ? (
            <Text
              className="mt-2 text-[13px] leading-[20px]"
              style={{ color: colors.muted }}
            >
              {review.comment}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

/* ─────────────── track record ─────────────── */

/**
 * The chart, sourced from convex/categoryStats.ts's stored observations.
 *
 * Split out for the same reason LiveStats is: the history query is a Convex
 * hook, and convex/react's hooks throw without a provider, so a build with no
 * EXPO_PUBLIC_CONVEX_URL must not mount one. That build has no stored
 * observations by definition, which is exactly what the no-backend branch says.
 */
function TrackRecord({ agent }: { agent: Agent }) {
  if (!convexClient) {
    return (
      <StatePanel
        body="This build has no Dolphin backend configured, so no readings have been stored to chart."
        compact
        state="unavailable"
        title="Track record unavailable"
      />
    );
  }

  return <BackendTrackRecord agent={agent} />;
}

function BackendTrackRecord({ agent }: { agent: Agent }) {
  const history = useAgentStatsHistory(agent.tokenId, agent.category);

  return (
    <PerformancePanel
      isLoading={history === undefined}
      metricLabel={history?.metricLabel ?? null}
      points={history?.points ?? []}
    />
  );
}

/* ─────────────── the page ─────────────── */

type AgentDetailProps = {
  agent: Agent;
  onHire: () => void;
  actionLabel?: string;
};

/** A LiveMetric<boolean> as a sentence, never as a bare claim. */
function booleanMetricText(
  metric: LiveMetric<boolean>,
  whenTrue: string,
  whenFalse: string,
) {
  if (metric.status === "live" || metric.status === "stale") {
    return metric.value ? whenTrue : whenFalse;
  }
  return metric.status === "syncing" ? "Checking…" : "Could not be checked";
}

export function AgentDetail({
  agent,
  onHire,
  actionLabel = "Hire Agent",
}: AgentDetailProps) {
  const [expandedAbout, setExpandedAbout] = useState(false);
  const hireability = assessHireability(agent);

  const registeredMetric = agent.registryVerification.registered;
  const isRegistered =
    registeredMetric.status === "live" && registeredMetric.value;

  /*
   * The price, resolved the same way components/hire-sheet.tsx resolves it,
   * so the page and the sheet cannot state different prices for one agent. An unresolved price is
   * a sentence, not a zero - "free" and "not read yet" must not look alike,
   * because one of them is a commitment.
   */
  const price =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;
  const priceText =
    price === null
      ? "Price not reported yet"
      : Number(price.amount) === 0
        ? "Free to hire"
        : `${price.amount} ${price.token} per hire`;

  const MAX_PREVIEW_LENGTH = 220;
  const description = agent.description;
  const isLongDescription = description.length > MAX_PREVIEW_LENGTH;
  const displayedDescription = expandedAbout
    ? description
    : description.slice(0, MAX_PREVIEW_LENGTH);

  const handleToggleAbout = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedAbout((previous) => !previous);
  };

  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
      {/* ── 1. identity ────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-4">
        <AgentIcon category={agent.category} size={84} uri={agent.iconUrl} />

        <View className="min-w-0 flex-1">
          <Text
            className="text-[22px] font-bold leading-[27px] tracking-[-0.5px]"
            numberOfLines={2}
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>

          <View className="mt-1.5 flex-row items-center gap-1.5">
            <Text
              className="shrink text-[13px] font-bold"
              numberOfLines={1}
              style={{ color: colors.goldDark }}
            >
              {agent.publisher}
            </Text>
            {isRegistered ? (
              <CategoryGlyph
                color={colors.goldDark}
                name="check"
                size={13}
                strokeWidth={2.4}
              />
            ) : null}
          </View>

          {/*
           * One meta line, and every part of it is a fact this record carries.
           * It replaces two lines of category-agnostic marketing copy
           * ("Decentralized Finance · Autonomous Agent") that was identical for
           * every agent in the directory and therefore told a reader nothing.
           */}
          <Text
            className="mt-1 text-[12px]"
            numberOfLines={1}
            style={{ color: colors.muted }}
          >
            {categoryLabels[agent.category]} · ERC-8004 #{agent.tokenId}
          </Text>
        </View>
      </View>

      {/* ── 2. the action ──────────────────────────────────────────────── */}
      {/*
       * The button is offered only when a hire would actually do something.
       *
       * Every agent used to get "Hire — Free", which wrote a database row and
       * contacted nobody. Hireability is now a property of the agent
       * (src/services/hireability.ts), mirroring the two conditions
       * convex/agentPayments.ts's requestQuote refuses on - so this can never
       * offer a button that the backend would reject.
       */}
      <View style={{ marginTop: 22 }}>
        {hireability.hireable ? (
          <>
            <PressableScale
              accessibilityLabel={actionLabel}
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onHire();
              }}
              containerStyle={{
                alignItems: "center",
                backgroundColor: colors.gold,
                borderRadius: radii.pill,
                height: 52,
                justifyContent: "center",
                ...shadows.goldGlow,
              }}
            >
              <Text
                className="text-[15px] font-bold tracking-[-0.2px]"
                style={{ color: colors.ink }}
              >
                {actionLabel}
              </Text>
            </PressableScale>

            <Text
              className="mt-2.5 text-center text-[12px]"
              style={{ color: colors.muted }}
            >
              {priceText}
            </Text>
          </>
        ) : (
          <Card style={{ backgroundColor: colors.surfaceSubtle }}>
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color={colors.muted} name="info" size={17} />
              </View>
              <View className="min-w-0 flex-1">
                <Text
                  className="text-[14px] font-bold"
                  style={{ color: colors.ink }}
                >
                  Not hireable yet
                </Text>
                <Text
                  className="mt-1.5 text-[12px] leading-[18px]"
                  style={{ color: colors.muted }}
                >
                  {hireability.reason}
                </Text>
                <Text
                  className="mt-2 text-[12px] leading-[18px]"
                  style={{ color: colors.muted }}
                >
                  {hireability.nextStep}
                </Text>
              </View>
            </View>
          </Card>
        )}
      </View>

      {/* ── 4. about ───────────────────────────────────────────────────── */}
      <Section title="About this agent">
        <Text
          className="text-[14px] font-semibold leading-[21px]"
          style={{ color: colors.ink }}
        >
          {agent.tagline}
        </Text>

        {/*
         * The toggle is a nested <Text>, not a control beside the paragraph, so
         * it flows as the last word of the description and wraps with it: the
         * ellipsis, a space, then "Show more" on the same line. As a sibling
         * PressableScale it sat on its own line under the block, which read as a
         * second element rather than as the end of the sentence it continues.
         *
         * Nested Text takes onPress directly on both platforms; suppressHighlighting
         * stops iOS flashing a grey box over the run, which at this size covers
         * the tail of the paragraph rather than just the link.
         */}
        <Text
          className="mt-2 text-[14px] leading-[23px]"
          style={{ color: colors.muted }}
        >
          {displayedDescription}
          {isLongDescription ? (
            <Text>
              {expandedAbout ? " " : "… "}
              <Text
                accessibilityLabel={expandedAbout ? "Show less" : "Show more"}
                accessibilityRole="button"
                className="text-[14px] font-bold"
                onPress={handleToggleAbout}
                style={{ color: colors.goldDark }}
                suppressHighlighting
              >
                {expandedAbout ? "Show less" : "Show more"}
              </Text>
            </Text>
          ) : null}
        </Text>

        {/*
         * Skills only. The three decorative hashtags that used to lead this row
         * (#Category, #ERC-8004, #BNBChain) restated the meta line two blocks
         * above and the registry table below, so the row's real content - what
         * this agent claims it can do, and whether that claim was verified - was
         * the part a reader reached last.
         */}
        {agent.skills.length > 0 ? (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {agent.skills.map((skill) => (
              <Pill
                accent={skill.evidence === "verified"}
                key={`${skill.name}-${skill.evidence}`}
                label={skill.name}
              />
            ))}
          </View>
        ) : null}
      </Section>

      {/* ── 5. live telemetry ──────────────────────────────────────────── */}
      <Section title={`${categoryLabels[agent.category]} telemetry`}>
        <LiveStats agent={agent} />
      </Section>

      {/* ── 5b. retention ──────────────────────────────────────────────── */}
      {/*
       * Placed immediately after telemetry and before the chart, because it is
       * the one number on this page that compares this agent to another one.
       * Everything above it describes the agent; this describes what happened
       * to the people who hired it.
       */}
      <Section
        caption="Dolphin's own record of whether people who hired this agent kept it. Marketplace-derived, not published by the agent."
        title="Retention"
      >
        <Retention agent={agent} />
      </Section>

      {/* ── 6. track record ────────────────────────────────────────────── */}
      <Section
        caption="Every reading Dolphin has taken of this agent's headline metric, kept rather than overwritten. Each point is one protocol read at the time it was taken."
        title="Track record"
      >
        <TrackRecord agent={agent} />
      </Section>

      {/*
       * ── 7. WAS: recent on-chain activity ─────────────────────────────
       *
       * REMOVED 2026-09-06. `recentActivity` is hardcoded `[]` in
       * convex/lib/agentCatalog.ts and src/data/editorial-agents.ts, and
       * nothing in the codebase has ever written it. So this section rendered
       * "Activity not published - no auditable execution events were returned
       * by the current data sources" for 100% of agents, permanently, implying
       * a source that had been consulted and had come back empty. No source was
       * ever consulted, because none is wired.
       *
       * That is the same class of defect as the fake numbers listed at the top
       * of this file: a truthful-sounding sentence creating a false impression
       * about a real agent. It goes for the same reason they went.
       *
       * TO BRING IT BACK, it needs an actual source, and two real ones exist:
       * ERC-8004 identity-registry logs for this tokenId (registration,
       * metadata updates, ownership transfers - readable with viem's getLogs,
       * no API key), and ERC-8183 kernel jobs whose provider is this agent's
       * wallet, which is the far more valuable signal because it is work the
       * agent was actually paid for. Both are getLogs range-limited on the
       * public BSC dataseed endpoints, so either needs its range strategy
       * settled before it is promised in the UI. Tracked in Agent/TODO.md.
       */}

      {/* ── 7. reviews ─────────────────────────────────────────────────── */}
      {/*
       * Takes the slot the deleted activity feed used to occupy, and it is the
       * right occupant: this is the section a reader of a marketplace page
       * looks for, and until now the page had nothing to put in it but
       * fabrications (see this file's header).
       */}
      <Section
        caption="From wallets that hired this agent, signed in, and kept it for at least a day. Not star ratings — see what the agent was actually asked to do."
        title="Reviews"
      >
        <Reviews agent={agent} />
      </Section>

      {/* ── 8. everything technical, folded away ───────────────────────── */}
      {/*
       * WAS three separate sections: "At a glance" (four registry metrics),
       * "Safety" (three statements about custody) and "Registry record" (seven
       * address rows). Together they were more than half the page's length, and
       * a first-time reader met them before deciding anything.
       *
       * None of it is deleted, because all of it is true and some of it is the
       * point of the product - an ERC-8004 marketplace that would not show you
       * the registry record is hiding its own evidence. It is collapsed instead:
       * the reader who wants to check Dolphin's work opens it, and the reader
       * deciding whether to hire is not made to scroll past a contract address
       * to reach the reviews.
       */}
      <Details agent={agent} />
    </View>
  );
}

function Details({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const registeredMetric = agent.registryVerification.registered;

  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <PressableScale
        accessibilityLabel="Details and registry record"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setOpen((previous) => !previous);
        }}
        containerStyle={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderRadius: CARD_RADIUS,
          borderWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          padding: 16,
        }}
      >
        <Text className="text-[14px] font-semibold" style={{ color: colors.ink }}>
          Details & registry record
        </Text>
        <CategoryGlyph
          color={colors.muted}
          name={open ? "chevron-left" : "chevron-right"}
          size={15}
        />
      </PressableScale>

      {open ? (
        <View className="mt-3 gap-3">
          <Card>
            <View className="flex-row flex-wrap gap-y-5">
              <View className="w-1/2 pr-2.5">
                <MetricCell
                  format={(value) => value.toFixed(1)}
                  label="Reputation"
                  metric={agent.reputationScore}
                />
              </View>
              <View className="w-1/2 pl-2.5">
                <MetricCell
                  format={(value) => value.toLocaleString()}
                  label="Feedback records"
                  metric={agent.feedbackCount}
                />
              </View>
              <View className="w-1/2 pr-2.5">
                <MetricCell
                  format={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
                  label="Endpoint"
                  metric={agent.endpointStatus}
                />
              </View>
              <View className="w-1/2 pl-2.5">
                <MetricCell
                  format={(value) => (value ? "Supported" : "Not supported")}
                  label="x402 payments"
                  metric={agent.x402Supported}
                />
              </View>
            </View>
          </Card>

          <Card style={{ paddingBottom: 7 }}>
            {(
              [
                ["ERC-8004 token", `#${agent.tokenId}`],
                ["Identity registry", shortAddress(agent.registryAddress)],
                ["Publisher", shortAddress(agent.publisherAddress)],
                ["Agent wallet", shortAddress(agent.agentWallet)],
                ["Chain", "BNB Smart Chain · 56"],
                ["Registered", agent.registeredAt ?? "Not reported"],
                ["Classification", agent.classificationSource.replaceAll("-", " ")],
              ] as const
            ).map(([label, value], index) => (
              <FactRow
                isFirst={index === 0}
                key={label}
                label={label}
                value={value}
              />
            ))}
          </Card>

          <Card>
            <Text className="text-[12px] leading-[18px]" style={{ color: colors.muted }}>
              {booleanMetricText(
                registeredMetric,
                `Token #${agent.tokenId} is registered on BNB Smart Chain, checked directly against the registry contract.`,
                `Token #${agent.tokenId} was not found in the registry contract.`,
              )}{" "}
              Dolphin never asks for a private key or a seed phrase, and nothing
              in it can spend from your wallet on an agent&apos;s behalf.
            </Text>
          </Card>
        </View>
      ) : null}
    </View>
  );
}
