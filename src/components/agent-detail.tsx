import type { ReactNode } from "react";
import { useState } from "react";
import { Text, View, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { McpUseButton } from "@/components/mcp-connect";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgentReviews } from "@/hooks/use-agent-reviews";
import { convexClient } from "@/providers/convex-provider";
import { assessHireability } from "@/services/hireability";
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
        ) : agent.protocol === "mcp" ? (
          /*
             AN MCP AGENT HAS NOT FAILED ANYTHING, AND ITS ACTION IS ONE BUTTON.

             This branch was a card explaining the protocol and ending on
             "Running its tools from inside Dolphin is not wired up yet" - a dead
             end in front of 26 of the 28 live agents. It then became that card
             plus an endpoint and a config block, which was accurate and still
             three things to read before the reader could act.

             What an MCP agent needs is its link. Tap Use, it is on the
             clipboard. See components/mcp-connect.tsx.
          */
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

      {/*
       * ── 5-6. WAS: telemetry, retention, and the track-record chart ──────
       *
       * REMOVED 2026-09-07, on the owner's rule: anything that is not
       * functioning, or that does not help the reader make a clear decision,
       * must go.
       *
       * All three were permanently empty for the overwhelming majority of the
       * catalog, and empty in three different ways that each cost a reader a
       * scroll to discover:
       *
       *   telemetry     `liveStats` is null for every category with no wired
       *                 protocol reader, which since categories became open is
       *                 most of them. An MCP agent has never had one.
       *   retention     counted from agentHires. An MCP agent cannot BE hired,
       *                 so 26 of 28 read "No hires yet" forever - which is the
       *                 exact "reads as a failure" problem the protocol split
       *                 was introduced to fix.
       *   track record  needs two observations of a category metric, and there
       *                 is no reader producing them for most categories.
       *
       * Their sources are untouched and still queried nowhere else, so any of
       * the three is a re-add of one <Section> once something is actually
       * feeding it. Deleting the section is not deleting the capability.
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
