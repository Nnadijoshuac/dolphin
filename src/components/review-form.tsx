import { useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/buttons";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii } from "@/constants/theme";
import {
  usePublishReviewOnChain,
  useReviewEligibility,
  useSubmitReview,
  type ReviewOutcome,
} from "@/hooks/use-agent-reviews";
import { convexClient } from "@/providers/convex-provider";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * Leaving a review, on the screen where the user has actually been using the
 * agent.
 *
 * ---------------------------------------------------------------------------
 * TWO QUESTIONS, NOT FIVE STARS
 * ---------------------------------------------------------------------------
 * See convex/agentReviews.ts for the full reasoning. Short version: a star
 * average over a marketplace this size reorders on one opinion, and "how did
 * you feel" is the wrong question about software that moves money. "Did it do
 * what it said" and "would you pay for it again" are answerable in one tap
 * each, comparable between agents, and hard to be vague about.
 *
 * The comment is optional and last, deliberately. It is the part nobody has to
 * write, and the two answers above it carry the signal on their own - which is
 * also why a review with no comment is a complete review here rather than an
 * empty one.
 *
 * ---------------------------------------------------------------------------
 * THE FORM IS NEVER OFFERED WHEN IT WOULD FAIL
 * ---------------------------------------------------------------------------
 * Eligibility comes from the backend, which is also where it is enforced, so
 * the reason shown is the real one: not signed in, never hired this agent, or
 * hired it too recently are three different things to be told, and a single
 * "you can't do that" would be useless in all three cases.
 */

const OUTCOMES: readonly { value: ReviewOutcome; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "partially", label: "Partly" },
  { value: "no", label: "No" },
];

const COMMENT_MAX_LENGTH = 280;

export function ReviewForm({ tokenId }: { tokenId: string }) {
  // Same guard as every other Convex-backed component: the hooks throw without
  // a provider, and a build with no EXPO_PUBLIC_CONVEX_URL has none.
  if (!convexClient) return null;
  return <BackendReviewForm tokenId={tokenId} />;
}

function BackendReviewForm({ tokenId }: { tokenId: string }) {
  const eligibility = useReviewEligibility(tokenId);
  const submitReview = useSubmitReview();

  const existing = eligibility?.existing ?? null;
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [wouldHireAgain, setWouldHireAgain] = useState<boolean | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  /*
   * The stored review is the starting point until the user touches a control.
   *
   * Held as "null means not edited" rather than seeded into state by an effect:
   * eligibility arrives asynchronously, and copying it into state when it lands
   * is react-hooks/set-state-in-effect under eslint-plugin-react-hooks 7 (the
   * rule that also reshaped the root layout's hydration read and the wallet
   * session). Deriving it also means an edit in progress is never clobbered by
   * a background refetch.
   */
  const selectedOutcome = outcome ?? existing?.outcome ?? null;
  const selectedWouldHireAgain = wouldHireAgain ?? existing?.wouldHireAgain ?? null;
  const commentValue = comment ?? existing?.comment ?? "";

  if (eligibility === undefined) return null;

  if (!eligibility.eligible) {
    // An existing review with lapsed eligibility (signed out, say) still shows,
    // because it is the user's own words and hiding them would be strange.
    return existing ? (
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.surface, borderColor: colors.line }}
      >
        <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
          Your review
        </Text>
        <Text className="mt-1.5 text-[12px] leading-[18px]" style={{ color: colors.muted }}>
          {summarise(existing.outcome, existing.wouldHireAgain)}
          {existing.comment ? ` “${existing.comment}”` : ""}
        </Text>
        <Text className="mt-2 text-[11px] leading-4" style={{ color: colors.faint }}>
          {eligibility.reason}
        </Text>
      </View>
    ) : (
      <StatePanel
        body={eligibility.reason ?? "You cannot review this agent yet."}
        compact
        state="empty"
        title="Review not available yet"
      />
    );
  }

  const canSubmit =
    selectedOutcome !== null && selectedWouldHireAgain !== null && status !== "saving";

  const handleSubmit = async () => {
    if (selectedOutcome === null || selectedWouldHireAgain === null) return;
    setStatus("saving");
    setError(null);
    try {
      await submitReview({
        tokenId,
        outcome: selectedOutcome,
        wouldHireAgain: selectedWouldHireAgain,
        comment: commentValue.trim().length > 0 ? commentValue.trim() : null,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus("saved");
    } catch (cause) {
      setStatus("idle");
      setError(toUserMessage(cause, "Could not save your review."));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <View
      className="rounded-2xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.line }}
    >
      <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
        {existing ? "Update your review" : "Review this agent"}
      </Text>
      <Text className="mt-1 text-[12px] leading-[18px]" style={{ color: colors.muted }}>
        Only wallets that hired this agent can review it, and yours is one. Your
        address is shown with the review.
      </Text>

      <Text className="mt-4 text-[12px] font-bold" style={{ color: colors.ink }}>
        Did it do what it said it would?
      </Text>
      <View className="mt-2 flex-row gap-2">
        {OUTCOMES.map((option) => (
          <Choice
            key={option.value}
            label={option.label}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setOutcome(option.value);
              setStatus("idle");
            }}
            selected={selectedOutcome === option.value}
          />
        ))}
      </View>

      <Text className="mt-4 text-[12px] font-bold" style={{ color: colors.ink }}>
        Would you hire it again?
      </Text>
      <View className="mt-2 flex-row gap-2">
        {[
          { value: true, label: "Yes" },
          { value: false, label: "No" },
        ].map((option) => (
          <Choice
            key={String(option.value)}
            label={option.label}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setWouldHireAgain(option.value);
              setStatus("idle");
            }}
            selected={selectedWouldHireAgain === option.value}
          />
        ))}
      </View>

      <Text className="mt-4 text-[12px] font-bold" style={{ color: colors.ink }}>
        Anything else? <Text style={{ color: colors.muted }}>Optional</Text>
      </Text>
      <TextInput
        className="mt-2 rounded-xl border p-3 text-[13px]"
        maxLength={COMMENT_MAX_LENGTH}
        multiline
        onChangeText={(next) => {
          setComment(next);
          setStatus("idle");
        }}
        placeholder="What happened when you used it?"
        placeholderTextColor={colors.faint}
        style={{ borderColor: colors.line, color: colors.ink, minHeight: 72 }}
        value={commentValue}
      />
      <Text className="mt-1 text-right text-[11px]" style={{ color: colors.faint }}>
        {commentValue.length}/{COMMENT_MAX_LENGTH}
      </Text>

      {error ? (
        <Text className="mt-2 text-[12px] leading-4" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      {status === "saved" ? (
        <Text className="mt-2 text-[12px] leading-4" style={{ color: colors.success }}>
          Saved. It is on this agent&apos;s page now, and you can change it any time.
        </Text>
      ) : null}

      <View className="mt-4">
        <Button
          disabled={!canSubmit}
          label={
            status === "saving"
              ? "Saving…"
              : existing
                ? "Update review"
                : "Post review"
          }
          loading={status === "saving"}
          onPress={() => void handleSubmit()}
        />
      </View>

      {/*
       * Publishing on-chain is offered only once a review exists, because it
       * publishes THAT review. Never automatic and never bundled into the save
       * button: it spends the user's own BNB, and a control that spends money
       * has to be its own deliberate decision.
       */}
      {existing ? (
        <PublishOnChain
          existingTxHash={existing.onChainTxHash}
          outcome={existing.outcome}
          tokenId={tokenId}
          wouldHireAgain={existing.wouldHireAgain}
        />
      ) : null}
    </View>
  );
}

/**
 * The optional second step: mirror this review into the ERC-8004 Reputation
 * Registry, from the reviewer's own wallet.
 *
 * WHY OFFER IT AT ALL. Dolphin already declared the registry's address in
 * constants and had never once read or written it. Publishing there turns this
 * app from a consumer of the standard into a contributor to it: the review
 * becomes portable, survives Dolphin, and is readable by any other ERC-8004
 * client. That is the actual argument for putting a review on a public chain
 * rather than in a database, and it is the only one worth spending someone's
 * gas on.
 *
 * WHAT IS SAID PLAINLY, BEFORE THE BUTTON. It costs real BNB. It cannot be
 * deleted. And the comment does NOT go on-chain - only the two structured
 * answers do, because Dolphin hosts no off-chain JSON to point a feedbackURI at
 * and will not publish a URL to a file that does not exist
 * (services/reputation-registry.ts).
 */
function PublishOnChain({
  tokenId,
  outcome,
  wouldHireAgain,
  existingTxHash,
}: {
  tokenId: string;
  outcome: ReviewOutcome;
  wouldHireAgain: boolean;
  existingTxHash: string | null;
}) {
  const publish = usePublishReviewOnChain();
  const [status, setStatus] = useState<"idle" | "publishing">("idle");
  const [error, setError] = useState<string | null>(null);

  if (existingTxHash) {
    return (
      <View
        className="mt-4 rounded-xl border p-3"
        style={{ backgroundColor: colors.goldMuted, borderColor: colors.goldBorder }}
      >
        <Text className="text-[12px] font-bold" style={{ color: colors.goldDark }}>
          Published to the ERC-8004 registry
        </Text>
        <Text className="mt-1 text-[11px] leading-4" style={{ color: colors.muted }}>
          This review is on BNB Smart Chain and any other ERC-8004 client can read
          it.
        </Text>
        <PressableScale
          accessibilityLabel="View the transaction on BscScan"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void Linking.openURL(`https://bscscan.com/tx/${existingTxHash}`);
          }}
          containerStyle={{ marginTop: 8 }}
        >
          <Text className="text-[11px] font-bold" style={{ color: colors.goldDark }}>
            View transaction →
          </Text>
        </PressableScale>
      </View>
    );
  }

  const handlePublish = async () => {
    setStatus("publishing");
    setError(null);
    try {
      await publish({ tokenId, outcome, wouldHireAgain });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(toUserMessage(cause, "Could not publish this review on-chain."));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setStatus("idle");
    }
  };

  return (
    <View
      className="mt-4 border-t pt-4"
      style={{ borderColor: colors.lineLight }}
    >
      <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
        Publish this on-chain
      </Text>
      <Text className="mt-1 text-[11px] leading-4" style={{ color: colors.muted }}>
        Writes your two answers into the ERC-8004 Reputation Registry on BNB
        Smart Chain, so any other client of the standard can read them and the
        review outlives Dolphin.
      </Text>
      <Text className="mt-2 text-[11px] leading-4" style={{ color: colors.muted }}>
        It costs gas in real BNB, it cannot be deleted afterwards, and your
        written comment stays in Dolphin — only the two answers are published.
      </Text>

      {error ? (
        <Text className="mt-2 text-[11px] leading-4" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      <View className="mt-3">
        <Button
          disabled={status === "publishing"}
          label={status === "publishing" ? "Confirm in your wallet…" : "Publish on-chain"}
          loading={status === "publishing"}
          onPress={() => void handlePublish()}
          variant="secondary"
        />
      </View>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flex: 1 }}
      containerStyle={{
        alignItems: "center",
        backgroundColor: selected ? colors.gold : colors.surfaceSubtle,
        borderColor: selected ? colors.goldBorder : colors.line,
        borderRadius: radii.small,
        borderWidth: 1,
        justifyContent: "center",
        paddingVertical: 11,
      }}
    >
      <Text
        className="text-[13px]"
        style={{
          color: selected ? colors.ink : colors.muted,
          fontWeight: selected ? "700" : "500",
        }}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function summarise(outcome: ReviewOutcome, wouldHireAgain: boolean): string {
  const did =
    outcome === "yes"
      ? "It did what it said."
      : outcome === "partially"
        ? "It partly did what it said."
        : "It did not do what it said.";
  return `${did} ${wouldHireAgain ? "Would hire again." : "Would not hire again."}`;
}
