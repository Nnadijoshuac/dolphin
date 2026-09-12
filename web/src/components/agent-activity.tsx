"use client";

import Link from "next/link";
import { useQuery } from "convex/react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { agentRouteId } from "@/constants/agents";
import { agentPaymentsApi } from "@/convex/api";
import { useAgentsByKeys } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { convexClient } from "@/providers/convex-provider";
import type { AgentCategory } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
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
            : "Hires and payments to agents will appear here."}
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

  const agents = useAgentsByKeys([
    ...(hires ?? []).map((hire) => hire.agentKey),
    ...(jobs ?? []).map((job) => job.agentKey),
  ]);

  const items: ActivityItem[] = [];

  for (const job of jobs ?? []) {
    const agent = agents.get(job.agentKey);
    let amount: string | null = null;
    try {
      amount = `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`;
    } catch {
      amount = null;
    }
    items.push({
      key: `job:${job.jobId}`,
      title: job.agentName,
      agentKey: job.agentKey,
      category: agent?.category ?? null,
      iconUrl: agent?.iconUrl ?? null,
      iconSeed: agent?.iconSeed ?? null,
      detail: [`Paid - ${job.jobStatus.toLowerCase()}`, formatDate(job.verifiedAt)]
        .filter(Boolean)
        .join(" - "),
      amount,
      href: job.transactionHash
        ? `https://bscscan.com/tx/${job.transactionHash}`
        : `/manage/${agentRouteId(job.agentKey)}`,
      external: Boolean(job.transactionHash),
      sortAt: Date.parse(job.verifiedAt) || 0,
    });
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

  items.sort((a, b) => b.sortAt - a.sortAt);
  const visible = items.slice(0, maxRows);
  const loading =
    (identityAddress !== null && hires === undefined) ||
    (dolphinAddress !== null && jobs === undefined);

  return (
    <section className={mobile ? "mobile-wallet-activity" : "wallet-activity"} id="activity">
      <header>
        <div>
          {!mobile ? <p className="eyebrow">History</p> : null}
          <h2>Agent activity</h2>
        </div>
        {items.length > maxRows ? <Link href="/my-agents">See all</Link> : null}
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
