import { useQuery } from "convex/react";
import { Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { api } from "../../convex/_generated/api";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import { useAgentsByKeys } from "@/hooks/use-agents";
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
 *   agentHires  hire records, keyed by the IDENTITY wallet
 *               (convex/agentHires.ts getHiredAgentsForWallet). A paid hire
 *               points back to its ERC-8183 job; a free hire has no amount, so
 *               it renders with no figure rather than a zero - a zero would
 *               read as "cost nothing to me" the same way a failed balance read
 *               does, and the two must not look alike.
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
  /** Null while the catalog row has not resolved, or for an agent that is gone. */
  category: AgentCategory | null;
  /**
   * The agent's own icon, resolved from the catalog by token id. Null when the
   * catalog has not loaded or does not carry this agent, in which case AgentIcon
   * draws the category mark - the same fallback every other list in the app
   * takes, rather than a second kind of placeholder unique to this one.
   */
  iconUrl: string | null;
  /**
   * Seed for the deterministic avatar AgentIcon draws when `iconUrl` is null,
   * which is the common case here: most agents publish no icon of their own.
   * Null when the catalog has not resolved this agent at all, and the category
   * mark is drawn instead.
   */
  iconSeed: string | null;
  detail: string;
  amount: string | null;
  sortAt: number;
  onPress: (() => void) | null;
};

/**
 * One record, drawn straight onto the page.
 *
 * NO CARD AROUND THE LIST, no rules between rows. The discover screen is the
 * pattern this follows: its agent rows are transparent, separated by spacing
 * alone, and the icon plus the type hierarchy is what makes a row a row. A
 * bordered surface here was drawing a box around content that never needed one
 * - and it sat directly beneath the account card, so the page read as a stack
 * of boxes rather than as a balance with a list under it.
 */
function ActivityRow({
  item,
  hidden,
}: {
  item: ActivityItem;
  hidden: boolean;
}) {
  const body = (
    <View
      className="flex-row items-center gap-3.5 px-1"
      style={{ paddingVertical: 10 }}
    >
      <AgentIcon
        category={item.category ?? "general"}
        seed={item.iconSeed}
        size={48}
        uri={item.iconUrl}
      />

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

  /*
   * The catalog, purely to put each agent's OWN face on its row.
   *
   * No extra network cost in practice: this is the same TanStack query the
   * discover, search and my-agents screens already hold, keyed identically, so
   * by the time anyone reaches the wallet tab it is served from cache. A row
   * renders as soon as its record arrives whether or not the catalog has - the
   * icon is the only thing that waits on it.
   */
  // Only the agents this feed actually names, not the whole catalog. The
  // catalog is paginated now, so an agent a user hired may not be on page one -
  // and reading every agent to resolve a handful of icons never made sense.
  const catalog = useAgentsByKeys([
    ...(jobs ?? []).map((job) => job.agentKey),
    ...(hires ?? []).map((hire) => hire.agentKey),
  ]);
  const agentFor = (agentKey: string) => catalog.get(agentKey) ?? null;

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
      // Still the denormalised name, NOT the catalog's. The row is a record of
      // a payment, so it names the agent as it was named when the money moved.
      // Only the icon is resolved live, because the row never stored one.
      title: job.agentName,
      // The job row no longer denormalises a category, and it should not: a
      // category is a property of the agent that can change, while this row is
      // a receipt. Read live from the catalog when it is there.
      category: agentFor(job.agentKey)?.category ?? null,
      iconUrl: agentFor(job.agentKey)?.iconUrl ?? null,
      iconSeed: agentFor(job.agentKey)?.iconSeed ?? null,
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
    const agent = agentFor(hire.agentKey);
    items.push({
      key: `hire-${hire.agentKey}`,
      // A hire row carries no denormalised name, so it used to show the token
      // id - resolving one was a second network read for a label. The catalog
      // is now read anyway for the icon, so the name comes with it for free.
      // It falls back to the id rather than to nothing when the catalog has not
      // arrived or does not carry this agent.
      title: agent?.name ?? `Agent ${hire.agentKey}`,
      category: agent?.category ?? null,
      iconUrl: agent?.iconUrl ?? null,
      iconSeed: agent?.iconSeed ?? null,
      detail: [
        hire.paymentJobId ? "Hired - paid" : "Hired - no payment",
        date,
      ].filter(Boolean).join(" - "),
      amount: null,
      sortAt: Date.parse(hire.hiredAt) || 0,
      onPress: () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/manage/[id]", params: { id: hire.agentKey } });
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
          style={{ color: colors.inkSecondary }}
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
            <Text className="text-[13px] font-bold underline" style={{ color: colors.ink }}>
              See all
            </Text>
          </PressableScale>
        ) : null}
      </View>

      {visible.length > 0 ? (
        <View className="gap-1">
          {visible.map((item) => (
            <ActivityRow hidden={hidden} item={item} key={item.key} />
          ))}
        </View>
      ) : (
        /*
         * "Loading" is not "none". Telling someone they have no activity before
         * the answer arrives is a claim, not a placeholder - the same
         * distinction altana-wallet-card makes about sessions.
         *
         * Unboxed like the rows it stands in for: a bordered empty card was the
         * most prominent thing on the page in the state everybody starts in.
         */
        <View className="items-center px-4 py-8">
          <View
            className="mb-3 h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.line,
              borderWidth: 1,
            }}
          >
            <CategoryGlyph color={colors.ink} name="clock" size={20} strokeWidth={2.2} />
          </View>
          <Text className="text-center text-[15px] font-bold tracking-[-0.2px]" style={{ color: colors.ink }}>
            {isLoading ? "Checking your activity…" : "No agent activity yet"}
          </Text>
          <Text
            className="mt-1.5 max-w-[320px] text-center text-[12.5px] leading-[18px]"
            style={{ color: colors.inkSecondary }}
          >
            {isLoading
              ? "Reading hire and payment records."
              : "Agents you hire and payments you make will appear here. Dolphin shows only records it has verified on-chain — it does not index your wallet's other transactions."}
          </Text>
        </View>
      )}
    </View>
  );
}
