import type { ReactNode } from "react";
import { useState } from "react";
import { Text, View, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { McpUseButton } from "@/components/mcp-connect";
import { PearlButton } from "@/components/pearl-button";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgentReviews } from "@/hooks/use-agent-reviews";
import { convexClient } from "@/providers/convex-provider";
import { assessHireability } from "@/services/hireability";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import type { Agent, AgentCategory, LiveMetric } from "@/types/agent";

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
const SECTION_GAP = 24;
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

/* ─────────────── removed 2026-09-07 ─────────────── */
/*
 * LiveStats, Retention and TrackRecord lived here and are gone with the three
 * sections that rendered them (see the note in the page body).
 *
 * ONE CONSEQUENCE, RECORDED RATHER THAN DISCOVERED LATER: the telemetry panel
 * was also what CAUSED stats to be collected. useAgentCategoryStats refreshed
 * on view and convex/categoryStats.ts appended an observation as a by-product,
 * which is what fed the track-record chart. With the panel gone nothing calls
 * it, so no new observations accumulate and the chart could not fill even if
 * it were re-added tomorrow.
 *
 * That is the correct trade while no category has a wired reader - collecting
 * nothing costs nothing - but whoever wires one must restore the refresh as
 * well as the section, or they will wire a reader that is never called.
 */

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

  if (!reviews || reviews.total === 0) {
    return null;
  }

  const { outcomes } = reviews;

  return (
    <Section
      caption="From wallets that hired this agent, signed in, and kept it for at least a day."
      title="Reviews"
    >
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
    </Section>
  );
}

/** A titled block of label/value rows. The only shape inside Details. */
function FactGroup({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <View>
      <Text
        className="mb-2 text-[11px] font-bold uppercase tracking-[0.9px]"
        style={{ color: colors.faint }}
      >
        {title}
      </Text>
      <Card style={{ paddingBottom: 7 }}>
        {rows.map(([label, value], index) => (
          <FactRow isFirst={index === 0} key={label} label={label} value={value} />
        ))}
      </Card>
    </View>
  );
}

/** A date a person can read, or an honest absence. */
function formatDay(value: string | null): string {
  if (!value) return "Not reported";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "Not reported";
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Dolphin's own verdict, in words rather than an enum. */
function statusLabel(status: Agent["status"]): string {
  switch (status) {
    case "live":
      return "Answering";
    case "degraded":
      return "Failing recently";
    default:
      return "Not answering";
  }
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
  const priceText = (() => {
    if (agent.protocol === "mcp") return "Free to Connect";
    if (agent.pricing?.display) return agent.pricing.display;
    if (agent.pricing?.amountRaw && Number(agent.pricing.amountRaw) > 0) {
      return `${formatTokenAmount(
        agent.pricing.amountRaw,
        agent.pricing.tokenDecimals || 18,
      )} ${agent.pricing.tokenSymbol || "BNB"}`;
    }
    if (price === null) return "Price not reported yet";
    if (Number(price.amount) === 0) return "Free to hire";
    if (Number(price.amount) > 1_000_000_000) {
      return `${formatTokenAmount(price.amount, 18)} ${price.token || "BNB"}`;
    }
    return `${price.amount} ${price.token} per hire`;
  })();

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
    <View style={{ paddingHorizontal: GUTTER, paddingTop: 4 }}>
      {/* ── 1. identity & value proposition ────────────────────────────── */}
      <View className="flex-row items-start gap-3.5">
        <View style={{ ...shadows.card }}>
          <AgentIcon category={agent.category} size={72} uri={agent.iconUrl} />
        </View>

        <View className="min-w-0 flex-1 pt-0.5">
          {/* Metadata badges row */}
          <View className="flex-row items-center flex-wrap gap-1.5 mb-1.5">
            <View
              className="rounded-full px-2.5 py-0.5"
              style={{ backgroundColor: colors.surfaceSubtle }}
            >
              <Text className="text-[11px] font-bold text-zinc-600">
                {categoryLabels[agent.category]}
              </Text>
            </View>

            <View
              className="rounded-full px-2.5 py-0.5"
              style={{
                backgroundColor:
                  agent.protocol === "mcp" ? colors.lilac : colors.goldSoft,
              }}
            >
              <Text
                className="text-[11px] font-bold"
                style={{
                  color:
                    agent.protocol === "mcp" ? colors.lilacInk : colors.goldDark,
                }}
              >
                {agent.protocol === "mcp" ? "MCP Server" : "A2A Agent"}
              </Text>
            </View>
          </View>

          <Text
            className="text-[22px] font-black leading-[27px] tracking-[-0.5px]"
            numberOfLines={2}
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>

          <View className="mt-1 flex-row items-center gap-1.5">
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
            <Text className="text-[12px] font-medium text-zinc-400">
              · #{agent.tokenId}
            </Text>
          </View>
        </View>
      </View>

      {/* Immediate 1-sentence value proposition */}
      {agent.tagline ? (
        <Text
          className="mt-3.5 text-[14.5px] font-medium leading-[21px]"
          style={{ color: colors.ink }}
        >
          {agent.tagline}
        </Text>
      ) : null}

      {/* ── 2. the action (hire / use) ─────────────────────────────────── */}
      <View style={{ marginTop: 16 }}>
        {hireability.hireable ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderRadius: CARD_RADIUS,
              borderWidth: 1,
              padding: 16,
              ...shadows.subtle,
            }}
          >
            <View className="flex-row items-center justify-between mb-3.5">
              <View>
                <Text className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  Hire Price
                </Text>
                <Text className="text-[18px] font-black text-ink mt-0.5">
                  {priceText}
                </Text>
              </View>
              <View
                className="flex-row items-center gap-1.5 px-3 py-1 rounded-full"
                style={{ backgroundColor: colors.mint }}
              >
                <CategoryGlyph color={colors.mintInk} name="shield" size={12} strokeWidth={2.4} />
                <Text className="text-[11.5px] font-bold" style={{ color: colors.mintInk }}>
                  Escrow Protected
                </Text>
              </View>
            </View>

            <PearlButton
              accessibilityLabel={actionLabel}
              label={actionLabel}
              onPress={onHire}
              size="lg"
              style={{ width: "100%" }}
            />

            <Text
              className="mt-2.5 text-center text-[11.5px]"
              style={{ color: colors.muted }}
            >
              Secured on BNB Chain · Funds released on verified completion
            </Text>
          </View>
        ) : agent.protocol === "mcp" ? (
          <McpUseButton agent={agent} />
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
                  className="mt-1 text-[12px] leading-[18px]"
                  style={{ color: colors.muted }}
                >
                  {hireability.reason}
                </Text>
              </View>
            </View>
          </Card>
        )}
      </View>

      {/* ── 3. overview & capabilities ─────────────────────────────────── */}
      <Section title="Overview">
        <Text
          className="text-[14px] leading-[22px]"
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

        {agent.skills.length > 0 ? (
          <View className="mt-3.5 flex-row flex-wrap gap-2">
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

      {/* ── 4. reviews (only rendered if reviews exist) ────────────────── */}
      <Reviews agent={agent} />

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
          {/*
           * TWO GROUPS, EVERY ROW A FACT THAT IS ACTUALLY POPULATED.
           *
           * This opened on four MetricCells - reputation, feedback records,
           * endpoint health, x402 support - and three of them earn no reader's
           * attention: reputation is unavailable or zero across the catalog,
           * the feedback count measures activity rather than quality, and x402
           * is not the rail anything here is paid over. A disclosure whose
           * first screen is mostly "Not reported" teaches the reader not to
           * open it again.
           *
           * What is left is what somebody checking Dolphin's work would
           * actually want: who this agent is on-chain, and what Dolphin did to
           * verify it. Grouped and labelled, because the assumption is that
           * nobody reads this - and the ones who do should find it in seconds.
           */}
          <FactGroup
            rows={[
              ["ERC-8004 token", `#${agent.tokenId}`],
              ["Identity registry", shortAddress(agent.registryAddress)],
              ["Publisher", shortAddress(agent.publisherAddress)],
              ["Agent wallet", shortAddress(agent.agentWallet)],
              ["Chain", "BNB Smart Chain · 56"],
              ["Registered", formatDay(agent.registeredAt)],
            ]}
            title="Identity"
          />

          <FactGroup
            rows={[
              ["Protocol", agent.protocol === "mcp" ? "MCP" : "A2A"],
              ["Dolphin status", statusLabel(agent.status)],
              ["Last checked", formatDay(agent.verifiedAt)],
              ["Endpoint", agent.services[0]?.endpoint ?? "Not reported"],
            ]}
            title="Verification"
          />

          <Card>
            <Text className="text-[12px] leading-[18px]" style={{ color: colors.muted }}>
              {booleanMetricText(
                registeredMetric,
                `Token #${agent.tokenId} is registered on BNB Smart Chain, checked directly against the registry contract.`,
                `Token #${agent.tokenId} was not found in the registry contract.`,
              )}{" "}
              Dolphin never asks for a private key or a seed phrase.
            </Text>
          </Card>
        </View>
      ) : null}
    </View>
  );
}
