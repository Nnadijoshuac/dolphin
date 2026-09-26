/**
 * THE TRACKING API'S READS: what Set and Earn needs that it cannot read on chain.
 *
 * Served over HTTP by convex/http.ts. The quest counts a wallet that hired an
 * agent in each of yield, grid, rebalancing and health factor, and that built
 * and listed an agent of its own. Paid hires are on chain (the ERC-8183
 * kernel's JobCreated / JobFunded), but which CATEGORY an agent is in, whether a
 * free hire happened, and whether an agent is LISTED here are Dolphin's own
 * records - so they are published here, read-only.
 *
 * TWO WALLETS PER PAID HIRE, and that is the trap this file exists to handle.
 * A user connects an ordinary wallet (the "hirer"), but an escrow is funded by
 * their Altana smart account, so the kernel's `client` is the Altana address. A
 * checker keyed on the connected wallet and one keyed on chain events see
 * different addresses for the same hire. Every response carries both, and a
 * query by either finds the same hires.
 *
 * Public data only: catalog listings and hire records that are already shown
 * on agent pages. Never sessions, nonces, or anything from walletSessions.
 */

import { v } from "convex/values";
import { getAddress, isAddress } from "viem";

import type { Doc } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { BSC_CHAIN_ID } from "./model/agent";
import { parseTeamWallets } from "./lib/usageRank";

/** Dolphin category slug -> the quest's name for it. */
export const QUEST_CATEGORY: Record<string, "yield" | "grid" | "rebalancing" | "health-factor"> = {
  yield: "yield",
  "grid-trading": "grid",
  rebalancing: "rebalancing",
  "health-factor": "health-factor",
};
const QUEST_CATEGORIES = ["yield", "grid", "rebalancing", "health-factor"] as const;

const MAX_ROWS = 200;

/** Checksummed, as agentHires and agentJobs store it, or null when not an address. */
export function checksum(address: string): string | null {
  const trimmed = address.trim();
  return isAddress(trimmed, { strict: false }) ? getAddress(trimmed) : null;
}

type HireRecord = {
  agentKey: string;
  tokenId: string;
  agentName: string | null;
  category: string | null;
  questCategory: (typeof QUEST_CATEGORIES)[number] | null;
  hirerWallet: string;
  hiredAt: string;
  status: "active" | "cancelled";
  paid: boolean;
  job: {
    jobId: string;
    jobStatus: string;
    escrowContract: string;
    clientWallet: string;
    budgetRaw: string;
    paymentToken: string;
    paymentTokenSymbol: string;
    transactionHash: string | null;
    verifiedAt: string;
  } | null;
};

/** Every connected wallet a query address stands for: itself, and any hirer behind it as an Altana account. */
async function hirerWalletsFor(ctx: QueryCtx, wallet: string): Promise<string[]> {
  const wallets = new Set([wallet]);
  const asAltana = await ctx.db
    .query("agentJobs")
    .withIndex("by_altana_wallet", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", wallet))
    .take(MAX_ROWS);
  for (const job of asAltana) if (job.hirerWalletAddress) wallets.add(checksum(job.hirerWalletAddress) ?? job.hirerWalletAddress);
  return [...wallets];
}

async function agentFor(ctx: QueryCtx, agentKey: string): Promise<Doc<"agents"> | null> {
  return ctx.db
    .query("agents")
    .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
    .unique();
}

async function hiresFor(ctx: QueryCtx, wallet: string): Promise<HireRecord[]> {
  const records: HireRecord[] = [];
  for (const hirer of await hirerWalletsFor(ctx, wallet)) {
    const hires = await ctx.db
      .query("agentHires")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", hirer))
      .take(MAX_ROWS);
    for (const hire of hires) {
      const agent = await agentFor(ctx, hire.agentKey);
      const job = hire.paymentJobId
        ? await ctx.db
            .query("agentJobs")
            .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", hire.paymentJobId!))
            .unique()
        : null;
      records.push({
        agentKey: hire.agentKey,
        tokenId: hire.agentKey.split(":").pop() ?? hire.agentKey,
        agentName: agent?.name ?? job?.agentName ?? null,
        category: agent?.categorySlug ?? null,
        questCategory: agent ? (QUEST_CATEGORY[agent.categorySlug] ?? null) : null,
        hirerWallet: hire.walletAddress,
        hiredAt: hire.hiredAt,
        status: hire.status,
        paid: job !== null,
        job: job
          ? {
              jobId: job.jobId,
              jobStatus: job.jobStatus,
              escrowContract: job.escrowContract,
              clientWallet: job.altanaWalletAddress,
              budgetRaw: job.budgetRaw,
              paymentToken: job.paymentToken,
              paymentTokenSymbol: job.paymentTokenSymbol,
              transactionHash: job.transactionHash,
              verifiedAt: job.verifiedAt,
            }
          : null,
      });
    }
  }
  return records.sort((a, b) => a.hiredAt.localeCompare(b.hiredAt));
}

async function agentsOwnedBy(ctx: QueryCtx, owner: string) {
  const rows = await ctx.db
    .query("agents")
    .withIndex("by_owner", (q) => q.eq("ownerAddress", owner.toLowerCase()))
    .take(MAX_ROWS);
  return rows.map((row) => ({
    agentKey: row.agentKey,
    tokenId: row.tokenId,
    name: row.name,
    category: row.categorySlug,
    questCategory: QUEST_CATEGORY[row.categorySlug] ?? null,
    status: row.status,
    /** Listed means browsable and hireable on Dolphin right now. */
    listed: row.status === "live",
    registeredAt: row.registeredAt,
    listedSince: row.publishedAt,
    ownerAddress: row.ownerAddress,
  }));
}

function isTeamWallet(wallet: string): boolean {
  return parseTeamWallets(process.env.DOLPHIN_TEAM_WALLETS).includes(wallet.toLowerCase());
}

export const hires = internalQuery({
  args: { wallet: v.string() },
  handler: async (ctx, { wallet }) => {
    const address = checksum(wallet);
    if (!address) return null;
    const records = await hiresFor(ctx, address);
    return { wallet: address, teamWallet: isTeamWallet(address), count: records.length, hires: records };
  },
});

export const agentsByOwner = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    const address = checksum(owner);
    if (!address) return null;
    const agents = await agentsOwnedBy(ctx, address);
    return {
      owner: address,
      teamWallet: isTeamWallet(address),
      count: agents.length,
      listedCount: agents.filter((a) => a.listed).length,
      agents,
    };
  },
});

/** One call per wallet: the quest's two conditions, with the evidence for each. */
export const quest = internalQuery({
  args: { wallet: v.string() },
  handler: async (ctx, { wallet }) => {
    const address = checksum(wallet);
    if (!address) return null;
    const records = await hiresFor(ctx, address);
    const owned = await agentsOwnedBy(ctx, address);

    const categories = Object.fromEntries(
      QUEST_CATEGORIES.map((category) => {
        const inCategory = records.filter((r) => r.questCategory === category);
        return [
          category,
          {
            hired: inCategory.length > 0,
            paidHire: inCategory.some((r) => r.paid),
            evidence: inCategory.map((r) => ({
              agentKey: r.agentKey,
              agentName: r.agentName,
              hiredAt: r.hiredAt,
              paid: r.paid,
              jobId: r.job?.jobId ?? null,
              transactionHash: r.job?.transactionHash ?? null,
            })),
          },
        ];
      }),
    ) as Record<(typeof QUEST_CATEGORIES)[number], { hired: boolean; paidHire: boolean; evidence: unknown[] }>;

    const hiredAll = QUEST_CATEGORIES.every((c) => categories[c].hired);
    const paidAll = QUEST_CATEGORIES.every((c) => categories[c].paidHire);
    const listedAgents = owned.filter((a) => a.listed);
    return {
      wallet: address,
      teamWallet: isTeamWallet(address),
      hiredAllFourCategories: hiredAll,
      paidHireInAllFourCategories: paidAll,
      ownsListedAgent: listedAgents.length > 0,
      complete: hiredAll && listedAgents.length > 0,
      categories,
      ownedAgents: owned,
    };
  },
});
