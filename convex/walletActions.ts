import { v, type Infer } from "convex/values";
import { getAddress, isAddress, parseAbi } from "viem";

import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID, bscPublicClient } from "./lib/bscClient";
import { readTokenSendsTo, readWalletMovements, type Movement } from "./lib/walletActionLogs";
import type { walletMovementValidator } from "./schema";

/**
 * THE DOLPHIN WALLET'S ACTIONS, recorded from the chain. (2026-09-26)
 *
 * The owner's rule: every action is recorded in Agent activity. The wallet
 * calls `record` with a transaction hash straight after the relay confirms
 * it. This reads the receipt and stores only what the receipt shows, the way
 * agentPayments.recordJobRefund does, so a row can never say something moved
 * that did not.
 */

type StoredMovement = Infer<typeof walletMovementValidator>;

const ERC20_META = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function describe(movements: Movement[]): Promise<StoredMovement[]> {
  return Promise.all(
    movements.map(async (movement) => {
      if (movement.token === null) return { token: null, symbol: "BNB", decimals: 18, amountRaw: movement.amountRaw };
      const address = movement.token as `0x${string}`;
      const [symbol, decimals] = await Promise.all([
        bscPublicClient.readContract({ address, abi: ERC20_META, functionName: "symbol" }).catch(() => "?"),
        bscPublicClient.readContract({ address, abi: ERC20_META, functionName: "decimals" }).catch(() => 18),
      ]);
      return { token: movement.token, symbol: String(symbol).slice(0, 24), decimals: Number(decimals), amountRaw: movement.amountRaw };
    }),
  );
}

export const record = action({
  args: {
    altanaWalletAddress: v.string(),
    transactionHash: v.string(),
    kind: v.union(v.literal("trade"), v.literal("withdraw"), v.literal("agent")),
    purpose: v.union(v.literal("chat"), v.literal("hire"), v.literal("withdraw"), v.literal("agent")),
    /** A withdrawal's destination, checked against the logs for a token withdrawal. */
    to: v.optional(v.string()),
    /** For `agent`: the agent whose plan was signed. A label, not evidence. */
    agentKey: v.optional(v.string()),
    agentName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    if (!isAddress(args.altanaWalletAddress)) throw new Error("walletActions.record: not a wallet address.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.transactionHash)) throw new Error("walletActions.record: not a transaction hash.");
    const wallet = getAddress(args.altanaWalletAddress);

    const receipt = await bscPublicClient.getTransactionReceipt({ hash: args.transactionHash as `0x${string}` });
    if (receipt.status !== "success") throw new Error(`walletActions.record: ${args.transactionHash} did not succeed.`);

    let sent: Movement[];
    let received: Movement[] = [];
    let counterparty: string | null = null;

    if (args.kind === "trade") {
      ({ sent, received } = readWalletMovements(receipt.logs, wallet));
      if (sent.length === 0 || received.length === 0) {
        throw new Error(`walletActions.record: ${args.transactionHash} is not a swap by this wallet.`);
      }
    } else if (args.kind === "agent") {
      /*
       * An agent's plan can be anything - an approval alone moves nothing - so
       * whatever moved is recorded, even nothing. It must at least TOUCH this
       * wallet: some log names it (a Transfer, an Approval), or it is not this
       * wallet's action and another wallet's history is not written into it.
       */
      const padded = `0x${wallet.slice(2).toLowerCase().padStart(64, "0")}`;
      const touches = receipt.logs.some((log) => log.topics.some((topic) => topic?.toLowerCase() === padded));
      if (!touches) throw new Error(`walletActions.record: ${args.transactionHash} does not involve this wallet.`);
      ({ sent, received } = readWalletMovements(receipt.logs, wallet));
    } else {
      if (!args.to || !isAddress(args.to)) throw new Error("walletActions.record: a withdrawal needs its destination.");
      counterparty = getAddress(args.to);
      sent = readTokenSendsTo(receipt.logs, wallet, counterparty);
      /*
       * No token moved to the destination: a native BNB withdrawal, which
       * leaves no log. Recorded, with the amount unknown - not a number taken
       * from the browser.
       */
      if (sent.length === 0) sent = [{ token: null, amountRaw: null as unknown as string }];
    }

    const block = await bscPublicClient.getBlock({ blockNumber: receipt.blockNumber });
    const describedSent = (await describe(sent)).map((movement) => ({
      ...movement,
      amountRaw: movement.amountRaw ?? null,
    }));

    await ctx.runMutation(internal.walletActions.store, {
      chainId: BSC_CHAIN_ID,
      altanaWalletAddress: wallet,
      transactionHash: args.transactionHash.toLowerCase(),
      kind: args.kind,
      purpose: args.purpose,
      sent: describedSent,
      received: await describe(received),
      counterparty,
      agentKey: args.kind === "agent" ? (args.agentKey ?? null) : null,
      agentName: args.kind === "agent" ? (args.agentName?.slice(0, 80) ?? null) : null,
      blockNumber: Number(receipt.blockNumber),
      executedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
    return { recorded: true };
  },
});

const movements = v.array(
  v.object({
    token: v.union(v.string(), v.null()),
    symbol: v.string(),
    decimals: v.number(),
    amountRaw: v.union(v.string(), v.null()),
  }),
);

/** Internal: only `record`, which read the receipt, writes here. One row per transaction. */
export const store = internalMutation({
  args: {
    chainId: v.number(),
    altanaWalletAddress: v.string(),
    transactionHash: v.string(),
    kind: v.union(v.literal("trade"), v.literal("withdraw"), v.literal("agent")),
    purpose: v.union(v.literal("chat"), v.literal("hire"), v.literal("withdraw"), v.literal("agent")),
    sent: movements,
    received: movements,
    counterparty: v.union(v.string(), v.null()),
    agentKey: v.union(v.string(), v.null()),
    agentName: v.union(v.string(), v.null()),
    blockNumber: v.number(),
    executedAt: v.string(),
  },
  handler: async (ctx, row) => {
    const existing = await ctx.db
      .query("walletActions")
      .withIndex("by_tx", (q) => q.eq("chainId", row.chainId).eq("transactionHash", row.transactionHash))
      .unique();
    if (existing) return;
    await ctx.db.insert("walletActions", { ...row, recordedAt: Date.now() });
  },
});

/** One wallet's recorded actions, newest first. */
export const forWallet = query({
  args: { altanaWalletAddress: v.string() },
  handler: async (ctx, { altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return [];
    const rows = await ctx.db
      .query("walletActions")
      .withIndex("by_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", getAddress(altanaWalletAddress)),
      )
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      transactionHash: row.transactionHash,
      kind: row.kind,
      purpose: row.purpose,
      sent: row.sent,
      received: row.received,
      counterparty: row.counterparty,
      agentKey: row.agentKey ?? null,
      agentName: row.agentName ?? null,
      executedAt: row.executedAt,
    }));
  },
});
