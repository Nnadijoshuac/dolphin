import { Linking, Pressable, Text, View } from "react-native";
import { useQuery as useConvexQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { colors } from "@/constants/theme";
import { useJobDelivery } from "@/hooks/use-job-delivery";
import { useAltanaWallet } from "@/wallet/altana-provider";
import type { AgentJobRow } from "@/wallet/altana-types";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import {
  DELIVERY_TIMEOUT_MS,
  deliveryCopy,
  hasDeliverable,
  type DeliveryState,
} from "@/wallet/erc8183-job";

/**
 * What happened to a paid hire after the money moved - the mobile counterpart
 * to the website's job-delivery-status.tsx.
 *
 * MIRRORED BY HAND. Both read the same Convex rows and the same
 * erc8183-job.ts state machine, so a job cannot be "delivered" on one product
 * and "working" on the other. Only the markup differs.
 *
 * Renders NOTHING when there is no paid job for this agent, so it is safe to
 * drop into any surface showing a hire: the free-hire path is untouched and
 * shows no delivery UI at all, because nothing was bought.
 */

/** Tone per state, so one state cannot read as "good" here and "bad" on web. */
const STATE_TONE: Record<DeliveryState, "live" | "wait" | "warn"> = {
  working: "wait",
  overdue: "warn",
  delivered: "live",
  settled: "live",
  rejected: "warn",
  expired: "warn",
  unfunded: "warn",
};

const TONE_COLOR: Record<"live" | "wait" | "warn", string> = {
  live: colors.success,
  wait: colors.gold,
  warn: colors.danger,
};

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}

/** Unix seconds -> a date a person can check. Never a relative guess. */
function formatDeadline(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "an unread date";
  return new Date(unixSeconds * 1000).toLocaleString();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="flex-row items-start justify-between gap-3 border-b py-2.5"
      style={{ borderColor: colors.line }}
    >
      <Text className="text-[11px]" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text
        className="flex-1 text-right text-[11px] font-semibold"
        style={{ color: colors.ink }}
      >
        {value}
      </Text>
    </View>
  );
}

export function JobDeliveryCard({ tokenId }: { tokenId: string }) {
  const altana = useAltanaWallet();

  // Paid jobs are keyed by the Dolphin Wallet that funded them, so with no
  // wallet on this device there is nothing to look up.
  const jobs = useConvexQuery(
    api.agentPayments.getJobsForAgent,
    altana.address
      ? { tokenId, altanaWalletAddress: altana.address }
      : "skip",
  ) as AgentJobRow[] | undefined;

  // getJobsForAgent returns newest first, so the head is the current purchase.
  const job = jobs?.[0] ?? null;
  const delivery = useJobDelivery(job);

  if (!job) return null;

  const copy = delivery.state ? deliveryCopy(delivery.state) : null;
  const tone = delivery.state ? STATE_TONE[delivery.state] : "wait";
  const delivered = delivery.onChain ? hasDeliverable(delivery.onChain) : false;

  /*
   * Link preference: the funding transaction when there is one, because that
   * is the most checkable artefact of the purchase. Falling back to the escrow
   * contract still lands the reader somewhere they can verify the job
   * themselves, which a status dot alone never does.
   */
  const explorerHref = job.transactionHash
    ? `https://bscscan.com/tx/${job.transactionHash}`
    : `https://bscscan.com/address/${job.escrowContract}`;

  return (
    <View
      className="mt-3 rounded-2xl border p-3.5"
      style={{ backgroundColor: colors.surface, borderColor: colors.line }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: TONE_COLOR[tone] }}
          />
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            {copy?.label ?? (delivery.isFirstLoad ? "Reading job…" : "Job status")}
          </Text>
          <Text className="text-[10px]" style={{ color: colors.faint }}>
            #{job.jobId}
          </Text>
        </View>

        <Pressable accessibilityRole="button" onPress={delivery.refresh}>
          <Text className="text-[11px] font-semibold" style={{ color: colors.muted }}>
            Check now
          </Text>
        </Pressable>
      </View>

      {copy && (
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
          {copy.body}
        </Text>
      )}

      {/*
       * A failed poll is reported as a connection note, never as a job state.
       * The escrow is exactly as funded as it was a moment ago; only our
       * ability to read it lapsed.
       */}
      {delivery.isReconnecting && (
        <Text className="mt-1.5 text-[10px] leading-4" style={{ color: colors.faint }}>
          Could not reach the chain on the last check — still trying. The status
          above is the last confirmed reading, not a failure of the job.
        </Text>
      )}

      <View className="mt-3 border-t" style={{ borderColor: colors.line }}>
        <Row
          label="Paid"
          value={`${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`}
        />
        <Row label="Ordered" value={formatElapsed(delivery.elapsedMs)} />

        {/*
         * The real, on-chain deadline - shown only once actually read.
         * DELIVERY_TIMEOUT_MS is a presentation threshold and is never printed
         * as though it were a contractual deadline.
         */}
        {delivery.onChain && !delivered && (
          <Row
            label="Refundable after"
            value={formatDeadline(delivery.onChain.expiredAt)}
          />
        )}
      </View>

      {/*
       * THE DELIVERY EVIDENCE. A 32-byte commitment the agent wrote on-chain,
       * not the deliverable's content - and labelled as exactly that. The
       * content lives at a URL published in an event that could not be found
       * on this chain (see erc8183-job.ts), so calling this "the result" would
       * be a claim Dolphin cannot support.
       */}
      {delivery.onChain && delivered && (
        <View className="mt-2.5">
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            Deliverable hash
          </Text>
          <Text
            className="mt-1 text-[10px] leading-4"
            selectable
            style={{ color: colors.inkSecondary, fontFamily: "monospace" }}
          >
            {delivery.onChain.deliverable}
          </Text>
        </View>
      )}

      <Pressable
        accessibilityRole="link"
        className="mt-3"
        onPress={() => void Linking.openURL(explorerHref)}
      >
        <Text className="text-[11px] font-semibold" style={{ color: colors.muted }}>
          View on BscScan ↗
        </Text>
      </Pressable>

      {delivery.state === "overdue" && (
        <Text className="mt-2.5 text-[10px] leading-4" style={{ color: colors.faint }}>
          Dolphin stopped expecting delivery after{" "}
          {Math.round(DELIVERY_TIMEOUT_MS / 60_000)} minutes, which is twice the
          slowest completion time the agents in this catalog quote for
          themselves. It is still checking once a minute.
        </Text>
      )}
    </View>
  );
}
