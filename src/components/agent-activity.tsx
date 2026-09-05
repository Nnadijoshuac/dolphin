import { useQuery } from "convex/react";
import { Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { api } from "../../convex/_generated/api";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import { useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import type { AgentCategory } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * Agent activity - this screen's answer to the reference's "recent
 * transactions" list.
 *
 * ---------------------------------------------------------------------------
 * EVERY ROW IS A RECORD THAT ALREADY EXISTED
 * ---------------------------------------------------------------------------
 * Nothing here is synthesised for the sake of filling the list. Two real
 * sources, both already backing other screens:
 *
 *   agentJobs   ERC-8183 escrow jobs, keyed by the DOLPHIN wallet that paid
 *               (convex/agentPayments.ts getJobsForAltanaWallet). These are the
 *               true transactions: each carries a budget read back off the
 *               chain, the token it was denominated in, and the hash that
 *               settled it. The agent's name is denormalised onto the row at
 *               payment time, so the name shown is the name that was shown when
 *               the money moved - not whatever the directory says today.
 *
 *   agentHires  free read-only hires, keyed by the IDENTITY wallet
 *               (convex/agentHires.ts getHiredAgentsForWallet). These moved no
 *               funds, so they render with no amount rather than a zero - a
 *               zero would read as "cost nothing to me" the same way a failed
 *               balance read does, and the two must not look alike.
 *
 * The two are keyed by DIFFERENT wallets, which is the whole reason this
 * component reads both rather than one: Dolphin pays from the passkey account
 * and identifies you by the MetaMask one. A feed built from either alone would
 * silently omit half of what the user did.
 *
 * NO AMOUNT IS EVER INVENTED. A job whose budget could not be formatted shows
 * the row without a figure rather than a placeholder (AGENTS.md §5).
 */

const MAX_ROWS = 4;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "25 July 2026" from an ISO string.
 *
 * Hand-rolled rather than toLocaleDateString: Hermes ships a cut-down Intl and
 * its date formatting varies by build, so the same record could render
 * differently on two devices. An unparseable date returns null and the caller
 * drops the date segment instead of printing "Invalid Date".
 */
function formatDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

type ActivityItem = {
  key: string;
  title: string;
  category: AgentCategory;
  detail: string;
  amount: string | null;
  sortAt: number;
  onPress: (() => void) | null;
};

function ActivityRow({
  item,
  hidden,
  isLast,
}: {
  item: ActivityItem;
  hidden: boolean;
  isLast: boolean;
}) {
  const body = (
    <View
      className="flex-row items-center gap-3 px-4"
      style={{
        borderBottomColor: colors.line,
        borderBottomWidth: isLast ? 0 : 1,
        paddingVertical: 14,
      }}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{ backgroundColor: colors.surfaceSubtle, height: 44, width: 44 }}
      >
        <CategoryGlyph color={colors.muted} name={item.category} size={19} />
      </View>

      <View className="flex-1">
        <Text
          className="text-[15px] font-bold"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {item.title}
        </Text>
        <Text
          className="mt-0.5 text-[12px]"
          numberOfLines={1}
          style={{ color: colors.muted }}
        >
          {item.detail}
        </Text>
      </View>

      {item.amount ? (
        <Text
          className="text-[14px] font-bold"
          style={{ color: colors.ink }}
        >
          {hidden ? "••••" : item.amount}
        </Text>
      ) : null}
    </View>
  );

  if (!item.onPress) return body;

  return (
    <PressableScale
      accessibilityLabel={`${item.title} — ${item.detail}`}
      accessibilityRole="button"
      onPress={item.onPress}
    >
      {body}
    </PressableScale>
  );
}

export function AgentActivity({ hidden }: { hidden: boolean }) {
  const router = useRouter();
  const identity = useWallet();
  const altana = useAltanaWallet();

  const altanaAddress = altana.status === "connected" ? altana.address : null;

  /*
   * Both queries follow the same precondition my-agents.tsx already relies on:
   * they are called from a subtree under ConvexClientProvider, and skip
   * themselves when there is no address to key on rather than querying for one.
   */
  const jobs = useQuery(
    api.agentPayments.getJobsForAltanaWallet,
    altanaAddress ? { altanaWalletAddress: altanaAddress } : "skip",
  );
  const hires = useHiredAgents(identity.address);

  const items: ActivityItem[] = [];

  for (const job of jobs ?? []) {
    const date = formatDate(job.verifiedAt);
    let amount: string | null = null;
    try {
      amount = `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`;
    } catch {
      // An unformattable budget is left off rather than guessed at.
      amount = null;
    }
    items.push({
      key: `job-${job.jobId}`,
      title: job.agentName,
      category: job.category,
      detail: [`Paid · ${job.jobStatus.toLowerCase()}`, date].filter(Boolean).join(" · "),
      amount,
      sortAt: Date.parse(job.verifiedAt) || 0,
      onPress: job.transactionHash
        ? () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void Linking.openURL(`https://bscscan.com/tx/${job.transactionHash}`);
          }
        : null,
    });
  }

  for (const hire of hires ?? []) {
    const date = formatDate(hire.hiredAt);
    items.push({
      key: `hire-${hire.tokenId}`,
      // Hire rows carry no denormalised name, so the token id is what is
      // truthfully known here. Resolving it against the directory would mean a
      // second network read for a label.
      title: `Agent #${hire.tokenId}`,
      category: hire.category,
      detail: ["Hired · no payment", date].filter(Boolean).join(" · "),
      amount: null,
      sortAt: Date.parse(hire.hiredAt) || 0,
      onPress: () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/manage/[id]", params: { id: hire.tokenId } });
      },
    });
  }

  items.sort((a, b) => b.sortAt - a.sortAt);
  const visible = items.slice(0, MAX_ROWS);

  const isLoading =
    (altanaAddress && jobs === undefined) ||
    (identity.address && hires === undefined);

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between">
        <Text
          className="text-[12px] font-bold uppercase tracking-[1.2px]"
          style={{ color: colors.muted }}
        >
          Agent activity
        </Text>
        {items.length > MAX_ROWS ? (
          <PressableScale
            accessibilityLabel="See all agent activity"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/my-agents");
            }}
          >
            <Text className="text-[13px] font-bold" style={{ color: colors.goldDark }}>
              See all
            </Text>
          </PressableScale>
        ) : null}
      </View>

      <View
        className="overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.line,
          ...shadows.subtle,
        }}
      >
        {visible.length > 0 ? (
          visible.map((item, index) => (
            <ActivityRow
              hidden={hidden}
              isLast={index === visible.length - 1}
              item={item}
              key={item.key}
            />
          ))
        ) : (
          /*
           * "Loading" is not "none". Telling someone they have no activity
           * before the answer arrives is a claim, not a placeholder - the same
           * distinction altana-wallet-card makes about sessions.
           */
          <View className="px-4 py-6">
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              {isLoading ? "Checking your activity…" : "No agent activity yet"}
            </Text>
            <Text
              className="mt-1.5 text-[12px] leading-[18px]"
              style={{ color: colors.muted }}
            >
              {isLoading
                ? "Reading hire and payment records."
                : "Agents you hire and payments you make will appear here. Dolphin shows only records it has verified on-chain — it does not index your wallet's other transactions."}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
