/**
 * SET AND QUEST: one wallet's progress against BNB Chain's Set and Earn rules,
 * for the /set-and-quest page. (2026-10-01, from the organizer's published
 * qualification rules.)
 *
 * The rules, in short: HIRE at least 3 different agents, the hire event
 * emitted onchain, across at least 2 shortlisted marketplaces; and BUILD one
 * agent that is registered (ERC-8004, chain 56 or 97) and listed, discoverable
 * in a campaign category, live, hired by 3 wallets that are not yours, and
 * that has made 5 onchain actions on 3 separate days.
 *
 * Everything here is what DOLPHIN can see. Hires on other marketplaces, the
 * category-consistency judgement and the fair-play review happen on BNB
 * Chain's side after the campaign closes, so they are not reported as passed.
 *
 * Public data only - the same hire records the tracking API already publishes,
 * and counts of a Dolphin Wallet's recorded actions. Bounded reads throughout.
 */

import { v } from "convex/values";
import { getAddress, isAddress } from "viem";

import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { BSC_CHAIN_ID } from "./model/agent";

/** The four categories the campaign accepts, as Dolphin's category slugs. */
const CAMPAIGN_CATEGORY: Record<string, string> = {
  yield: "Yield",
  "grid-trading": "Grid",
  grid: "Grid",
  rebalancing: "Rebalancing",
  "health-factor": "Health factor",
};

const HIRES_NEEDED = 3;
const OTHER_HIRERS_NEEDED = 3;
const ACTIONS_NEEDED = 5;
const ACTION_DAYS_NEEDED = 3;

async function agentByKey(ctx: QueryCtx, agentKey: string): Promise<Doc<"agents"> | null> {
  return ctx.db.query("agents").withIndex("by_key", (q) => q.eq("agentKey", agentKey)).unique();
}

export const progress = query({
  args: { wallet: v.string() },
  handler: async (ctx, { wallet }) => {
    if (!isAddress(wallet, { strict: false })) return null;
    const address = getAddress(wallet);
    const lower = address.toLowerCase();

    /* ─────────────── hire track ─────────────── */

    const hireRows = await ctx.db.query("agentHires").withIndex("by_wallet", (q) => q.eq("walletAddress", address)).take(200);
    const hires = [];
    for (const hire of hireRows) {
      const agent = await agentByKey(ctx, hire.agentKey);
      const job = hire.paymentJobId
        ? await ctx.db.query("agentJobs").withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", hire.paymentJobId!)).unique()
        : null;
      hires.push({
        agentKey: hire.agentKey,
        agentName: agent?.name ?? job?.agentName ?? `Agent ${hire.agentKey.split(":").pop()}`,
        category: agent?.categorySlug ?? null,
        // A hire counts from its onchain hire event: an ERC-8183 job. A free
        // hire is a Dolphin record with nothing onchain behind it.
        onchain: job !== null,
        paidFrom: job?.altanaWalletAddress ?? null,
        jobStatus: job?.jobStatus ?? null,
        transactionHash: job?.transactionHash ?? null,
        hiredAt: hire.hiredAt,
      });
    }
    hires.sort((a, b) => b.hiredAt.localeCompare(a.hiredAt));
    const onchainAgents = new Set(hires.filter((h) => h.onchain).map((h) => h.agentKey));

    /* ─────────────── build track ─────────────── */

    const builtRows = await ctx.db.query("builtAgents").withIndex("by_owner", (q) => q.eq("ownerAddress", address)).order("desc").take(20);
    const agents = [];
    for (const built of builtRows.filter((row) => row.status === "registered" && row.agentKey)) {
      const agentKey = built.agentKey!;
      const listing = await agentByKey(ctx, agentKey);
      const verification = await ctx.db.query("agentVerification").withIndex("by_key", (q) => q.eq("agentKey", agentKey)).unique();

      // Hired by others: completed onchain jobs from wallets that are not the builder's.
      const ownAltana = new Set<string>();
      const draft = await ctx.db.get(built.draftId);
      const keys = await ctx.db.query("agentTradeKeys").withIndex("by_draft", (q) => q.eq("draftId", built.draftId)).take(20);
      for (const key of keys) ownAltana.add(key.altanaWalletAddress.toLowerCase());
      const jobs = await ctx.db.query("agentJobs").withIndex("by_agent_wallet", (q) => q.eq("agentKey", agentKey)).take(500);
      const otherHirers = new Set<string>();
      for (const job of jobs) {
        if (job.jobStatus !== "COMPLETED") continue;
        const payer = (job.hirerWalletAddress ?? job.altanaWalletAddress).toLowerCase();
        if (payer === lower || ownAltana.has(job.altanaWalletAddress.toLowerCase())) continue;
        otherHirers.add(payer);
      }

      // Onchain actions: trades the agent made from its owner's Dolphin Wallet.
      const names = new Set([built.name, draft?.name].filter((n): n is string => Boolean(n)));
      const actionDays = new Set<string>();
      let actions = 0;
      for (const altana of ownAltana) {
        const rows = await ctx.db
          .query("walletActions")
          .withIndex("by_wallet", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", getAddress(altana)))
          .order("desc")
          .take(500);
        for (const row of rows) {
          if (row.kind !== "agent" || !row.agentName || !names.has(row.agentName)) continue;
          actions++;
          actionDays.add(row.executedAt.slice(0, 10));
        }
      }

      const listed = listing?.status === "live" || listing?.status === "degraded";
      const checks = {
        registered: true,
        listed,
        campaignCategory: Boolean(CAMPAIGN_CATEGORY[built.category]),
        live: verification?.state === "live",
        hiredByOthers: otherHirers.size >= OTHER_HIRERS_NEEDED,
        executes: actions >= ACTIONS_NEEDED && actionDays.size >= ACTION_DAYS_NEEDED,
      };
      agents.push({
        name: built.name,
        hash: built.hash,
        agentKey,
        tokenId: built.tokenId,
        chainId: built.chainId,
        network: built.network,
        category: built.category,
        categoryLabel: CAMPAIGN_CATEGORY[built.category] ?? null,
        registeredAt: built.registeredAt,
        listingStatus: listing?.status ?? null,
        lastLiveAt: verification?.lastOkAt ?? null,
        otherHirers: otherHirers.size,
        actions,
        actionDays: actionDays.size,
        checks,
        passed: Object.values(checks).filter(Boolean).length,
      });
    }
    // The agent closest to qualifying first.
    agents.sort((a, b) => b.passed - a.passed || (b.registeredAt ?? "").localeCompare(a.registeredAt ?? ""));

    return {
      wallet: address,
      hire: {
        hires,
        onchainAgents: onchainAgents.size,
        needed: HIRES_NEEDED,
        onDolphin: onchainAgents.size > 0,
      },
      build: {
        agents,
        needed: { otherHirers: OTHER_HIRERS_NEEDED, actions: ACTIONS_NEEDED, actionDays: ACTION_DAYS_NEEDED },
        drafting: builtRows.some((row) => row.status === "awaiting-signature"),
      },
    };
  },
});
