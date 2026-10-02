/**
 * THE DOLPHIN WALLET'S HISTORY, FROM THE CHAIN (owner, 2026-10-02: "every add,
 * every remove, every spend and gain should be recorded").
 *
 * Dolphin's own tables only hold what Dolphin did (escrow payments, swaps,
 * withdrawals). Money that arrives from outside - a deposit - never passes
 * through Dolphin, and neither do the relay's network fees or the one-time
 * wallet setup. So the history is read from the chain itself, through
 * NodeReal's nr_getAssetTransfers (BNB Chain's own data partner; BscScan's free
 * API no longer serves BNB Chain), and each transaction is described in words
 * a person reads: added funds, paid an agent, refund, swapped, withdrew,
 * network fee, wallet setup.
 *
 * Measured 2026-10-02 on the owner's Dolphin Wallet: one call per direction
 * returns the wallet's full history (no block range needed for a wallet this
 * young), with native BNB as `external`/`internal` and tokens as `20`.
 *
 * Tokens not on Dolphin's verified list are left out - wallets are airdropped
 * spam ("苹果人生" landed in the owner's), and a history that lists it reads as
 * if the person bought it. The count of hidden transfers is returned.
 */

import { v } from "convex/values";
import { getAddress, isAddress } from "viem";

import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { verifiedTokens } from "./lib/tradeTokens";
import { PANCAKE_V2_ROUTER, PANCAKE_V3_SWAP_ROUTER } from "./lib/pancakeswapTrade";

const NODEREAL = "https://bsc-mainnet.nodereal.io/v1/";
const MAX_PER_DIRECTION = 100;

/** Addresses whose role is known. Lowercase. */
const ESCROW = "0xea4daa3100a767e86fded867729ae7446476eba6"; // ERC-8183 kernel (Altana SDK erc8183.js)
const KEYSTORE_CONTROLLER = "0x0834ee2c9bdc3e3eff0a2dc34393d4b0e546a555"; // Altana SDK config.js, BNB
/** The relay's fee recipient - `paymentRecipient` in its prepared-call quotes, measured 2026-10-02. */
const RELAY_FEE = "0xaf089b4eca94a4b2f51d8f5668cff244f2c6c4bc";
const ROUTERS = new Set([PANCAKE_V2_ROUTER.toLowerCase(), PANCAKE_V3_SWAP_ROUTER.toLowerCase()]);

type Transfer = {
  category: string;
  from: string;
  to: string;
  value: string;
  asset: string | null;
  contractAddress?: string | null;
  hash: string;
  blockTimeStamp: number;
  receiptsStatus?: number;
};

export type Movement = { direction: "in" | "out"; symbol: string; decimals: number; amountRaw: string };
export type HistoryEntry = {
  hash: string;
  at: number;
  kind: "deposit" | "payment" | "refund" | "swap" | "withdraw" | "setup" | "fee" | "other";
  title: string;
  movements: Movement[];
  /** BNB paid to the relay for this transaction, in wei. */
  feeWei: string;
};

async function transfers(key: string, side: "fromAddress" | "toAddress", wallet: string): Promise<Transfer[]> {
  const response = await fetch(NODEREAL + key, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "nr_getAssetTransfers",
      params: [
        {
          category: ["external", "internal", "20"],
          [side]: wallet,
          order: "desc",
          excludeZeroValue: true,
          maxCount: `0x${MAX_PER_DIRECTION.toString(16)}`,
        },
      ],
    }),
  });
  const body = (await response.json()) as { result?: { transfers?: Transfer[] }; error?: { message?: string } };
  if (body.error) throw new Error(`NodeReal: ${body.error.message ?? "error"}`);
  return body.result?.transfers ?? [];
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export const forWallet = action({
  args: { address: v.string() },
  handler: async (
    ctx,
    { address },
  ): Promise<{ status: "ok"; entries: HistoryEntry[]; hiddenTokens: number } | { status: "unavailable"; reason: string }> => {
    const key = process.env.NODEREAL_API_KEY?.trim();
    if (!key) return { status: "unavailable", reason: "History is not connected on this deployment." };
    if (!isAddress(address)) return { status: "unavailable", reason: "Not a wallet address." };
    const wallet = getAddress(address);
    const self = wallet.toLowerCase();

    const [outgoing, incoming] = await Promise.all([transfers(key, "fromAddress", wallet), transfers(key, "toAddress", wallet)]);

    // What Dolphin itself recorded, to name the agent a payment or refund was for.
    const [jobs, actions] = await Promise.all([
      ctx.runQuery(api.agentPayments.getJobsForAltanaWallet, { altanaWalletAddress: wallet }),
      ctx.runQuery(api.walletActions.forWallet, { altanaWalletAddress: wallet }),
    ]);
    const paidBy = new Map(jobs.flatMap((job) => (job.transactionHash ? [[job.transactionHash.toLowerCase(), job.agentName] as const] : [])));
    const refundBy = new Map(jobs.flatMap((job) => (job.refundTransactionHash ? [[job.refundTransactionHash.toLowerCase(), job.agentName] as const] : [])));
    const actionBy = new Map(actions.map((row) => [row.transactionHash.toLowerCase(), row]));

    const known = new Map(verifiedTokens().flatMap((token) => (token.address ? [[token.address.toLowerCase(), token] as const] : [])));

    // Group every transfer by its transaction.
    const byTx = new Map<string, { at: number; transfers: Transfer[] }>();
    let hiddenTokens = 0;
    const seen = new Set<string>();
    for (const transfer of [...outgoing, ...incoming]) {
      if (transfer.receiptsStatus === 0) continue;
      const id = `${transfer.hash}:${transfer.category}:${transfer.from}:${transfer.to}:${transfer.value}:${transfer.contractAddress ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (transfer.category === "20" && !known.has((transfer.contractAddress ?? "").toLowerCase())) {
        hiddenTokens++;
        continue;
      }
      const hash = transfer.hash.toLowerCase();
      const group = byTx.get(hash) ?? { at: Number(transfer.blockTimeStamp) * 1000, transfers: [] };
      group.transfers.push(transfer);
      byTx.set(hash, group);
    }

    const entries: HistoryEntry[] = [];
    for (const [hash, group] of byTx) {
      let feeWei = BigInt(0);
      const movements: Movement[] = [];
      let toEscrow = false;
      let fromEscrow = false;
      let toRouter = false;
      let setup = false;
      let counterparty: string | null = null;
      let externalIn = false;

      for (const t of group.transfers) {
        const from = t.from.toLowerCase();
        const to = t.to.toLowerCase();
        const value = BigInt(t.value);
        const native = t.category !== "20";
        if (native && from === self && to === RELAY_FEE) {
          feeWei += value;
          continue;
        }
        if (native && from === self && to === KEYSTORE_CONTROLLER) setup = true;
        if (to === ESCROW) toEscrow = true;
        if (from === ESCROW) fromEscrow = true;
        if (ROUTERS.has(to) || ROUTERS.has(from)) toRouter = true;
        if (t.category === "external" && to === self) externalIn = true;
        if (from === self && !ROUTERS.has(to) && to !== ESCROW && to !== KEYSTORE_CONTROLLER) counterparty = to;
        if (to === self && !ROUTERS.has(from) && from !== ESCROW) counterparty = counterparty ?? from;
        const token = native ? null : known.get((t.contractAddress ?? "").toLowerCase()) ?? null;
        // Dust the router hands back from a swap (1-3 wei) is not a movement anyone needs to read.
        if (native && ROUTERS.has(from) && value < BigInt(1000)) continue;
        movements.push({
          direction: to === self ? "in" : "out",
          symbol: native ? "BNB" : token?.symbol ?? t.asset ?? "token",
          decimals: native ? 18 : token?.decimals ?? 18,
          amountRaw: value.toString(),
        });
      }

      // The swap that bought U pays the router BNB and gets U back: keep both, merge duplicates by symbol+direction.
      const merged = new Map<string, Movement>();
      for (const m of movements) {
        const k = `${m.direction}:${m.symbol}`;
        const prev = merged.get(k);
        merged.set(k, prev ? { ...prev, amountRaw: (BigInt(prev.amountRaw) + BigInt(m.amountRaw)).toString() } : m);
      }
      const final = [...merged.values()];

      let kind: HistoryEntry["kind"] = "other";
      let title = "Transaction";
      const action = actionBy.get(hash);
      if (fromEscrow) {
        kind = "refund";
        title = `Refund from ${refundBy.get(hash) ?? "an agent"}`;
      } else if (toEscrow) {
        kind = "payment";
        title = `Paid ${paidBy.get(hash) ?? "an agent"}`;
      } else if (setup) {
        kind = "setup";
        const bought = final.filter((m) => m.direction === "in" && m.symbol !== "BNB").map((m) => m.symbol);
        title = bought.length ? `One-time wallet setup, and bought ${bought.join(" + ")}` : "One-time wallet setup";
      } else if (toRouter || action?.kind === "trade") {
        kind = "swap";
        const sold = final.filter((m) => m.direction === "out").map((m) => m.symbol).join(" + ");
        const got = final.filter((m) => m.direction === "in").map((m) => m.symbol).join(" + ");
        title = action?.purpose === "hire" ? `Bought ${got || "U"} to pay an agent` : `Swapped ${sold || "?"} for ${got || "?"}`;
      } else if (externalIn || (final.length > 0 && final.every((m) => m.direction === "in"))) {
        kind = "deposit";
        title = `Added ${final.map((m) => m.symbol).join(" + ")}${counterparty ? ` from ${short(counterparty)}` : ""}`;
      } else if (final.length > 0 && final.every((m) => m.direction === "out")) {
        kind = "withdraw";
        title = `Sent ${final.map((m) => m.symbol).join(" + ")}${counterparty ? ` to ${short(counterparty)}` : ""}`;
      } else if (final.length === 0 && feeWei > BigInt(0)) {
        kind = "fee";
        title = action?.agentName ? `${action.agentName}: network fee` : "Network fee";
      }

      entries.push({ hash, at: group.at, kind, title, movements: final, feeWei: feeWei.toString() });
    }

    entries.sort((a, b) => b.at - a.at);
    return { status: "ok", entries, hiddenTokens };
  },
});
