"use client";

import Link from "next/link";
import { useQuery } from "convex/react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { agentRouteId } from "@/constants/agents";
import { formatUnits } from "viem";

import { agentPaymentsApi, builtAgentsApi, walletActionsApi, type WalletMovement } from "@/convex/api";
import { useAgentsByKeys } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { convexClient } from "@/providers/convex-provider";
import type { AgentCategory } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { usePaymentRates } from "@/hooks/use-payment-rates";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { formatUsd } from "@/wallet/token-usd";
import { useWallet } from "@/wallet/wallet-provider";

const DEFAULT_MAX_ROWS = 6;

function formatDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/** "0.05 U", "0.0000647 BNB": small amounts keep four significant digits, as on the trade ticket. */
function describeMovement(movement: WalletMovement): string {
  if (movement.amountRaw === null) return movement.symbol;
  const raw = BigInt(movement.amountRaw);
  const text = formatUnits(raw, movement.decimals);
  if (raw === BigInt(0) || !text.startsWith("0.")) {
    return `${formatTokenAmount(raw, movement.decimals)} ${movement.symbol}`;
  }
  const fraction = text.slice(2);
  const zeros = fraction.length - fraction.replace(/^0+/, "").length;
  return `0.${fraction.slice(0, zeros + 4).replace(/0+$/, "")} ${movement.symbol}`;
}

type ActivityItem = {
  key: string;
  title: string;
  agentKey: string;
  category: AgentCategory | null;
  iconUrl: string | null;
  iconSeed: string | null;
  detail: string;
  amount: string | null;
  href: string;
  external: boolean;
  sortAt: number;
};

function ActivityEmpty({
  loading = false,
  unavailable = false,
  mobile = false,
}: {
  loading?: boolean;
  unavailable?: boolean;
  mobile?: boolean;
}) {
  const className = mobile ? "mobile-activity-empty" : "wallet-activity-empty";
  return (
    <div className={className}>
      <span>
        <CategoryGlyph name="clock" size={mobile ? 23 : 20} />
      </span>
      <h3>
        {unavailable
          ? "Activity unavailable"
          : loading
            ? "Checking activity..."
            : "No agent activity yet"}
      </h3>
      <p>
        {unavailable
          ? "Activity cannot be read right now."
          : loading
            ? "Reading hire and payment records."
            : "Hires, payments, trades and withdrawals will appear here."}
      </p>
    </div>
  );
}

function ActivityRow({
  hidden,
  item,
  mobile,
}: {
  hidden: boolean;
  item: ActivityItem;
  mobile: boolean;
}) {
  const body = (
    <>
      <span className={mobile ? "mobile-activity-icon" : "wallet-activity-icon"}>
        <AgentIcon
          category={item.category ?? "monitoring"}
          seed={item.iconSeed}
          size={mobile ? 48 : 44}
          uri={item.iconUrl}
        />
      </span>
      <div>
        <h3>{item.title}</h3>
        <p>{item.detail}</p>
      </div>
      {item.amount ? <strong>{hidden ? "...." : item.amount}</strong> : null}
    </>
  );

  const className = mobile ? "mobile-activity-row" : "wallet-activity-row interactive";

  if (item.external) {
    return (
      <a className={className} href={item.href} rel="noreferrer" target="_blank">
        {body}
      </a>
    );
  }

  return (
    <Link className={className} href={item.href}>
      {body}
    </Link>
  );
}

export function AgentActivity({
  hidden = false,
  maxRows = DEFAULT_MAX_ROWS,
  mobile = false,
}: {
  hidden?: boolean;
  maxRows?: number;
  mobile?: boolean;
}) {
  if (!convexClient) {
    return (
      <section className={mobile ? "mobile-wallet-activity" : "wallet-activity"} id="activity">
        <header>
          <div>
            {!mobile ? <p className="eyebrow">History</p> : null}
            <h2>Agent activity</h2>
          </div>
        </header>
        <ActivityEmpty mobile={mobile} unavailable />
      </section>
    );
  }

  return <AgentActivityContent hidden={hidden} maxRows={maxRows} mobile={mobile} />;
}

function AgentActivityContent({
  hidden,
  maxRows,
  mobile,
}: {
  hidden: boolean;
  maxRows: number;
  mobile: boolean;
}) {
  const identity = useWallet();
  const dolphin = useAltanaWallet();

  const identityAddress = identity.isConnected ? identity.address : null;
  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;
  const hires = useHiredAgents(identityAddress);
  const jobs = useQuery(
    agentPaymentsApi.agentPayments.getJobsForAltanaWallet,
    dolphinAddress ? { altanaWalletAddress: dolphinAddress } : "skip",
  );
  /* Trades, withdrawals and agent-built transactions (convex/walletActions.ts). */
  const actions = useQuery(
    walletActionsApi.walletActions.forWallet,
    dolphinAddress ? { altanaWalletAddress: dolphinAddress } : "skip",
  );
  /* Agents this wallet put on-chain (convex/builtAgents.ts): a registration is an action too. */
  const published = useQuery(
    builtAgentsApi.builtAgents.forOwner,
    identityAddress ? { ownerAddress: identityAddress } : "skip",
  );

  const agents = useAgentsByKeys([
    ...(hires ?? []).map((hire) => hire.agentKey),
    ...(jobs ?? []).map((job) => job.agentKey),
    ...(actions ?? []).flatMap((row) => (row.agentKey ? [row.agentKey] : [])),
  ]);

  /*
   * One rate per DISTINCT payment token, resolved before the loop.
   *
   * Rules of hooks: a rate cannot be fetched per row inside a `for`. This also
   * happens to be what you would want anyway — a list of twenty jobs paid in
   * $U should read the $U price once, and two rows denominated in the same
   * token must never disagree about what it is worth.
   */
  const prices = usePaymentRates(
    (jobs ?? []).map((job) => ({
      token: job.paymentToken,
      decimals: job.paymentTokenDecimals,
    })),
  );

  const items: ActivityItem[] = [];

  for (const job of jobs ?? []) {
    const agent = agents.get(job.agentKey);
    /*
     * Dollars where a rate is readable, the token amount otherwise. `prices`
     * is keyed by token address and resolved above the loop, because a hook
     * cannot be called inside one — see the note on usePaymentRates.
     */
    let amount: string | null = null;
    try {
      const rate = prices.get(job.paymentToken.toLowerCase()) ?? null;
      amount = rate
        ? formatUsd(BigInt(job.budgetRaw), job.paymentTokenDecimals, rate)
        : `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`;
    } catch {
      amount = null;
    }
    /*
     * Dated by when the payment was RECORDED. verifiedAt moves every time the
     * job is re-read, so after a refund it showed the refund's day on the
     * payment row (seen 2026-09-26 on job 56783).
     */
    const paidAt = new Date(job._creationTime).toISOString();
    const refunded = Boolean(job.refundTransactionHash);
    items.push({
      key: `job:${job.jobId}`,
      title: job.agentName,
      agentKey: job.agentKey,
      category: agent?.category ?? null,
      iconUrl: agent?.iconUrl ?? null,
      iconSeed: agent?.iconSeed ?? null,
      detail: [
        refunded ? "Paid - refunded" : `Paid - ${job.jobStatus.toLowerCase()}`,
        formatDate(paidAt),
      ]
        .filter(Boolean)
        .join(" - "),
      amount: amount ? `−${amount}` : null,
      href: job.transactionHash
        ? `https://bscscan.com/tx/${job.transactionHash}`
        : `/manage/${agentRouteId(job.agentKey)}`,
      external: Boolean(job.transactionHash),
      sortAt: job._creationTime,
    });

    // The refund is its own row: a second transaction, money coming back.
    if (job.refundTransactionHash) {
      const refundedAt = job.refundedAt ?? job.verifiedAt;
      items.push({
        key: `refund:${job.jobId}`,
        title: `Refund from ${job.agentName}`,
        agentKey: job.agentKey,
        category: agent?.category ?? null,
        iconUrl: agent?.iconUrl ?? null,
        iconSeed: agent?.iconSeed ?? null,
        detail: [`Job #${job.jobId} - refunded`, formatDate(refundedAt)].filter(Boolean).join(" - "),
        amount: amount ? `+${amount}` : null,
        href: `https://bscscan.com/tx/${job.refundTransactionHash}`,
        external: true,
        sortAt: Date.parse(refundedAt) || 0,
      });
    }
  }

  for (const hire of hires ?? []) {
    const agent = agents.get(hire.agentKey);
    items.push({
      key: `hire:${hire.agentKey}:${hire.hiredAt}`,
      title: agent?.name ?? `Agent ${hire.agentKey}`,
      agentKey: hire.agentKey,
      category: agent?.category ?? null,
      iconUrl: agent?.iconUrl ?? null,
      iconSeed: agent?.iconSeed ?? null,
      detail: [
        hire.paymentJobId ? "Hired - paid" : "Hired - no payment",
        formatDate(hire.hiredAt),
      ]
        .filter(Boolean)
        .join(" - "),
      amount: null,
      href: `/manage/${agentRouteId(hire.agentKey)}`,
      external: false,
      sortAt: Date.parse(hire.hiredAt) || 0,
    });
  }

  /*
   * EVERY OTHER ACTION THE WALLET TOOK (owner's rule, 2026-09-26): trades,
   * withdrawals, and transactions an agent built. Amounts are what the
   * receipt showed moving; an amount the chain does not show (a BNB
   * withdrawal) is left off rather than filled in.
   */
  for (const action of actions ?? []) {
    const agent = action.agentKey ? agents.get(action.agentKey) : undefined;
    const sent = action.sent.map(describeMovement);
    const received = action.received.map(describeMovement);
    const symbols = (list: WalletMovement[]) => list.map((movement) => movement.symbol).join(" + ");
    const date = formatDate(action.executedAt);

    let title: string;
    let detail: string;
    let amount: string | null;
    if (action.kind === "trade") {
      title =
        action.purpose === "hire"
          ? `Bought ${symbols(action.received)} to pay an agent`
          : `Swapped ${symbols(action.sent)} for ${symbols(action.received)}`;
      detail = [`Sold ${sent.join(" + ")}`, "PancakeSwap", date].filter(Boolean).join(" - ");
      amount = received.length ? `+${received.join(" + ")}` : null;
    } else if (action.kind === "withdraw") {
      title = `Withdrew ${symbols(action.sent)}`;
      detail = [
        action.counterparty ? `To ${action.counterparty.slice(0, 6)}…${action.counterparty.slice(-4)}` : null,
        date,
      ]
        .filter(Boolean)
        .join(" - ");
      amount = action.sent.every((movement) => movement.amountRaw !== null) ? `−${sent.join(" + ")}` : null;
    } else {
      title = action.agentName ?? agent?.name ?? "Agent transaction";
      detail = [
        sent.length || received.length ? "Signed its transaction" : "Signed its transaction - nothing moved",
        date,
      ]
        .filter(Boolean)
        .join(" - ");
      amount =
        [sent.length ? `−${sent.join(" + ")}` : null, received.length ? `+${received.join(" + ")}` : null]
          .filter(Boolean)
          .join(" ") || null;
    }

    items.push({
      key: `action:${action.transactionHash}`,
      title,
      agentKey: action.agentKey ?? "",
      category: agent?.category ?? (action.kind === "trade" ? "trading" : "payments"),
      iconUrl: agent?.iconUrl ?? null,
      iconSeed: agent?.iconSeed ?? action.kind,
      detail,
      amount,
      href: `https://bscscan.com/tx/${action.transactionHash}`,
      external: true,
      sortAt: Date.parse(action.executedAt) || 0,
    });
  }

  for (const agent of published ?? []) {
    if (agent.status !== "registered" || !agent.registeredAt) continue;
    items.push({
      key: `published:${agent.hash}`,
      title: `Put ${agent.name} on-chain`,
      agentKey: agent.agentKey ?? "",
      category: agent.category,
      iconUrl: agent.iconUrl,
      iconSeed: agent.hash,
      detail: [`${agent.networkLabel} - #${agent.tokenId}`, formatDate(agent.registeredAt)].filter(Boolean).join(" - "),
      amount: null,
      href: `/agent/${agent.hash}`,
      external: false,
      sortAt: Date.parse(agent.registeredAt) || 0,
    });
  }

  items.sort((a, b) => b.sortAt - a.sortAt);
  const visible = items.slice(0, maxRows);
  const loading =
    (identityAddress !== null && hires === undefined) ||
    (dolphinAddress !== null && (jobs === undefined || actions === undefined));

  return (
    <section className={mobile ? "mobile-wallet-activity" : "wallet-activity"} id="activity">
      <header>
        <div>
          {!mobile ? <p className="eyebrow">History</p> : null}
          <h2>Agent activity</h2>
        </div>
        {items.length > maxRows ? (
          <Link href="/my-agents">See all</Link>
        ) : dolphinAddress ? (
          /* Everything, including swaps and activity outside Dolphin. */
          <a
            href={`https://bscscan.com/address/${dolphinAddress}#tokentxns`}
            rel="noreferrer"
            target="_blank"
          >
            BscScan ↗
          </a>
        ) : null}
      </header>

      {visible.length > 0 ? (
        <div className={mobile ? undefined : "wallet-activity-list"}>
          {visible.map((item) => (
            <ActivityRow hidden={hidden} item={item} key={item.key} mobile={mobile} />
          ))}
        </div>
      ) : (
        <ActivityEmpty loading={Boolean(loading)} mobile={mobile} />
      )}
    </section>
  );
}
