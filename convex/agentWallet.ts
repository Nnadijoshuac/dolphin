/**
 * AN AGENT'S OWN WALLET. (owner, 2026-09-29: "that agent is going to have its
 * own wallet that you can send money to, and then it's spent from that wallet
 * ... the agent can freely spend from it without needing you to confirm ...
 * when it gets gain, does the trade come to the wallet? I think so.")
 *
 * WHAT IT IS. A plain BNB Chain account, one per agent draft. Its private key
 * is generated here and sealed with lib/secretBox.ts before anything is
 * stored; it is opened in exactly two places:
 *
 *   executeTrade  a swap the Risk block already passed (lib/agentBlocks.ts),
 *                 built by lib/pancakeswapTrade.ts and checked by
 *                 assertTradeCallsAllowed: PancakeSwap's routers and an exact
 *                 approval of the token sold, nothing else. The recipient is
 *                 this wallet, so what the trade buys lands back here.
 *   withdraw      to the owner's own signed-in wallet. No function here takes
 *                 any other destination.
 *
 * HOW IT DIFFERS FROM "TRADE WITHOUT ASKING" (autotrade.ts). That grants a
 * key on the owner's Dolphin Wallet, limited on-chain by the account
 * contract. This is a separate pot the owner funds on purpose: Dolphin holds
 * its key, the only limits are the Risk block's (enforced in code here), and
 * the panel says so - keep in it only what you would let the agent trade.
 *
 * Every transaction it sends is recorded from its receipt in its activity
 * (walletActions.record, the owner's rule).
 */

import { ConvexError, v } from "convex/values";
import { createWalletClient, erc20Abi, formatUnits, getAddress, http, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { BSC_RPC_URL, bscPublicClient } from "./lib/bscClient";
import { assertTradeCallsAllowed, buildTradeCalls, describeRoute, quoteTrade, type TradeSide } from "./lib/pancakeswapTrade";
import { open, seal } from "./lib/secretBox";
import { verifiedTokens } from "./lib/tradeTokens";
import { readHoldings, type Holding } from "./lib/walletHoldings";
import { requireWalletAddress } from "./lib/walletAuth";

/**
 * FROZEN 2026-09-29 (the mentor review; the owner said "adhere to his advice").
 * A plain wallet whose key Dolphin holds is custody: one server breach could
 * drain every agent's wallet at once, and holding keys that move user value
 * is the clearest trigger for custody / money-transmission licensing. So:
 * no new agent wallets, and no trade executes from one. What stays is the way
 * out - balances and withdraw-to-owner - so nobody's funds are stranded.
 * Autonomous trading continues through scoped trade keys on the owner's own
 * smart wallet (autotrade.ts). Kept, not deleted: unfreezing is a decision.
 */
export const AGENT_WALLETS_FROZEN = true;

/** BNB kept back for gas when the agent sells BNB or the owner withdraws it all. */
const GAS_RESERVE_BNB = "0.0006";

async function draftFor(ctx: QueryCtx, conversationKey: string) {
  const conversation = await ctx.db
    .query("dolphinConversations")
    .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
    .unique();
  if (!conversation || (conversation.mode ?? "chat") !== "build") return null;
  const draft = await ctx.db
    .query("agentDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
    .unique();
  return draft ? { draft, conversation } : null;
}

/** The draft behind a build conversation, if the signed-in wallet owns it. */
export const ownedDraft = internalQuery({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }): Promise<{ draftId: Id<"agentDrafts">; ownerAddress: string; name: string }> => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "The agent's wallet");
    const found = await draftFor(ctx, conversationKey);
    if (!found) throw new ConvexError("That is not an agent draft yet. Describe the agent first.");
    const owner = found.conversation.ownerAddress ?? found.draft.brain?.walletAddress ?? null;
    if (!owner || owner.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new ConvexError("Only the wallet that is building this agent can manage its wallet.");
    }
    return { draftId: found.draft._id, ownerAddress: walletAddress, name: found.draft.name ?? "Agent" };
  },
});

export const walletForDraft = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) =>
    ctx.db
      .query("agentWallets")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .first(),
});

export const insert = internalMutation({
  args: { draftId: v.id("agentDrafts"), ownerAddress: v.string(), address: v.string(), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentWallets")
      .withIndex("by_draft", (q) => q.eq("draftId", args.draftId))
      .first();
    if (existing) return existing.address;
    await ctx.db.insert("agentWallets", { ...args, createdAt: new Date().toISOString() });
    return args.address;
  },
});

/** Gives the agent its wallet, or returns the one it has. Never replaced: a new key would strand the funds. */
export const create = action({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, args): Promise<{ address: string }> => {
    const owned: { draftId: Id<"agentDrafts">; ownerAddress: string } = await ctx.runQuery(internal.agentWallet.ownedDraft, args);
    const existing: Doc<"agentWallets"> | null = await ctx.runQuery(internal.agentWallet.walletForDraft, { draftId: owned.draftId });
    if (existing) return { address: existing.address };
    if (AGENT_WALLETS_FROZEN) {
      throw new ConvexError("Agent wallets are paused. Use \"Trade without asking\" in the Draft tab: a limited key on your own Dolphin Wallet.");
    }
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const box = await seal(privateKey);
    const address: string = await ctx.runMutation(internal.agentWallet.insert, {
      draftId: owned.draftId,
      ownerAddress: owned.ownerAddress,
      address: account.address,
      ...box,
    });
    return { address };
  },
});

/** The agent's wallet address, for the canvas. Public material only. */
export const forDraft = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const found = await draftFor(ctx, conversationKey);
    if (!found) return null;
    const wallet = await ctx.db
      .query("agentWallets")
      .withIndex("by_draft", (q) => q.eq("draftId", found.draft._id))
      .first();
    return wallet ? { address: wallet.address, ownerAddress: wallet.ownerAddress } : null;
  },
});

/** What the agent's wallet holds of BNB and Dolphin's verified tokens, read live. */
export const balances = action({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }): Promise<{ address: string; holdings: Holding[]; checkedAt: number } | null> => {
    const wallet: { address: string } | null = await ctx.runQuery(api.agentWallet.forDraft, { conversationKey });
    if (!wallet) return null;
    return { address: wallet.address, holdings: await readHoldings(getAddress(wallet.address) as Address), checkedAt: Date.now() };
  },
});

function clientFor(privateKey: Hex) {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain: bsc, transport: http(BSC_RPC_URL) });
}

async function unseal(wallet: Doc<"agentWallets">): Promise<Hex> {
  const privateKey = (await open({ ciphertext: wallet.ciphertext, iv: wallet.iv })) as Hex;
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new ConvexError("The agent wallet's stored key does not match its address. Nothing was sent.");
  }
  return privateKey;
}

function sendFailure(cause: unknown): string {
  const message = cause instanceof Error ? ((cause as { shortMessage?: string }).shortMessage ?? cause.message) : String(cause);
  if (/insufficient funds|exceeds the balance/i.test(message)) return "the wallet has too little BNB to pay for gas";
  return message.slice(0, 200);
}

/**
 * Sends a checked trade from the agent's wallet. `attempted: false` means the
 * agent has no wallet, and the caller falls back to its other paths.
 */
export const executeTrade = internalAction({
  args: {
    draftId: v.id("agentDrafts"),
    agentName: v.string(),
    ticket: v.object({
      kind: v.literal("swap"),
      amountIn: v.string(),
      tokenIn: v.object({ address: v.union(v.string(), v.null()), symbol: v.string(), decimals: v.number(), verified: v.boolean() }),
      tokenOut: v.object({ address: v.union(v.string(), v.null()), symbol: v.string(), decimals: v.number(), verified: v.boolean() }),
      safety: v.any(),
    }),
  },
  handler: async (ctx, { draftId, agentName, ticket }): Promise<{ attempted: boolean; executed: boolean; text: string; transactionHash?: string }> => {
    const wallet: Doc<"agentWallets"> | null = await ctx.runQuery(internal.agentWallet.walletForDraft, { draftId });
    if (!wallet) return { attempted: false, executed: false, text: "" };
    if (AGENT_WALLETS_FROZEN) return { attempted: false, executed: false, text: "" };
    const address = getAddress(wallet.address) as Address;
    const tokenIn: TradeSide = { address: ticket.tokenIn.address, symbol: ticket.tokenIn.symbol, decimals: ticket.tokenIn.decimals };
    const tokenOut: TradeSide = { address: ticket.tokenOut.address, symbol: ticket.tokenOut.symbol, decimals: ticket.tokenOut.decimals };

    let amountInRaw: bigint;
    try {
      amountInRaw = parseUnits(ticket.amountIn, tokenIn.decimals);
    } catch {
      return { attempted: true, executed: false, text: "Not traded: the amount could not be read." };
    }

    // Enough to sell, and BNB for gas? A trade that would revert costs gas and proves nothing.
    const bnb = await bscPublicClient.getBalance({ address });
    const reserve = parseUnits(GAS_RESERVE_BNB, 18);
    const held = tokenIn.address
      ? await bscPublicClient.readContract({ address: getAddress(tokenIn.address) as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
      : bnb;
    if (held < amountInRaw) {
      return {
        attempted: true,
        executed: false,
        text: `Not traded: the agent's wallet holds ${formatUnits(held, tokenIn.decimals)} ${tokenIn.symbol}, less than ${ticket.amountIn}.`,
      };
    }
    if ((tokenIn.address ? bnb : bnb - amountInRaw) < reserve) {
      return { attempted: true, executed: false, text: `Not traded: the agent's wallet needs about ${GAS_RESERVE_BNB} BNB left over for gas.` };
    }

    const route = (await quoteTrade({ publicClient: bscPublicClient as never, tokenIn, tokenOut, amountInRaw }))[0];
    if (!route) return { attempted: true, executed: false, text: "Not traded: PancakeSwap had no route for that swap right now." };
    const calls = buildTradeCalls({ route, tokenIn, tokenOut, recipient: address });
    assertTradeCallsAllowed(calls, tokenIn, address);

    const client = clientFor(await unseal(wallet));
    const hashes: Hex[] = [];
    try {
      // In order: the exact approval, then the swap. Each must land before the next is sent.
      for (const call of calls) {
        const hash = await client.sendTransaction({ to: call.to, data: call.data, ...(call.value ? { value: call.value } : {}) });
        hashes.push(hash);
        const receipt = await bscPublicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      }
    } catch (cause) {
      await recordAll(ctx, address, hashes, agentName);
      return { attempted: true, executed: false, text: `Not traded: ${sendFailure(cause)}.` };
    }
    await recordAll(ctx, address, hashes, agentName);

    const swapHash = hashes[hashes.length - 1];
    const out = formatUnits(route.amountOutRaw, tokenOut.decimals);
    return {
      attempted: true,
      executed: true,
      transactionHash: swapHash,
      text: `Traded from the agent's wallet: sold ${ticket.amountIn} ${tokenIn.symbol} for about ${Number(out).toPrecision(6)} ${tokenOut.symbol} on ${describeRoute(route)}. Transaction ${swapHash}.`,
    };
  },
});

/** Every transaction the wallet sent, from its receipt (the owner's rule). Never fails the caller. */
async function recordAll(ctx: ActionCtx, address: Address, hashes: readonly Hex[], agentName: string) {
  for (const transactionHash of hashes) {
    try {
      await ctx.runAction(api.walletActions.record, { altanaWalletAddress: address, transactionHash, kind: "agent", purpose: "agent", agentName });
    } catch (cause) {
      console.warn("[agentWallet] sent but not recorded yet:", transactionHash, cause);
    }
  }
}

/**
 * Sends one asset from the agent's wallet to the OWNER's signed-in wallet -
 * the only destination there is. `amount` "all" empties it (BNB keeps its gas
 * reserve back only when a token remains to be withdrawn; otherwise just the
 * fee).
 */
export const withdraw = action({
  args: { sessionToken: v.string(), conversationKey: v.string(), symbol: v.string(), amount: v.string() },
  handler: async (ctx, args): Promise<{ transactionHash: string; text: string }> => {
    const owned: { draftId: Id<"agentDrafts">; ownerAddress: string; name: string } = await ctx.runQuery(internal.agentWallet.ownedDraft, {
      sessionToken: args.sessionToken,
      conversationKey: args.conversationKey,
    });
    const wallet: Doc<"agentWallets"> | null = await ctx.runQuery(internal.agentWallet.walletForDraft, { draftId: owned.draftId });
    if (!wallet) throw new ConvexError("This agent has no wallet.");
    const token = verifiedTokens().find((candidate) => candidate.symbol.toLowerCase() === args.symbol.toLowerCase());
    if (!token) throw new ConvexError("Only BNB and Dolphin's verified tokens can be withdrawn here.");
    const from = getAddress(wallet.address) as Address;
    const to = getAddress(owned.ownerAddress) as Address;
    const client = clientFor(await unseal(wallet));

    let hash: Hex;
    try {
      if (token.address) {
        const held = await bscPublicClient.readContract({ address: getAddress(token.address) as Address, abi: erc20Abi, functionName: "balanceOf", args: [from] });
        const amount = args.amount === "all" ? held : parseUnits(args.amount, token.decimals);
        if (amount <= BigInt(0) || amount > held) throw new ConvexError(`The agent's wallet holds ${formatUnits(held, token.decimals)} ${token.symbol}.`);
        hash = await client.writeContract({ address: getAddress(token.address) as Address, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
      } else {
        const held = await bscPublicClient.getBalance({ address: from });
        const gasPrice = await bscPublicClient.getGasPrice();
        const fee = gasPrice * BigInt(21_000);
        const amount = args.amount === "all" ? held - fee : parseUnits(args.amount, 18);
        if (amount <= BigInt(0) || amount + fee > held) {
          throw new ConvexError(`The agent's wallet holds ${formatUnits(held, 18)} BNB, and sending needs a little for gas.`);
        }
        hash = await client.sendTransaction({ to, value: amount, gas: BigInt(21_000), gasPrice });
      }
    } catch (cause) {
      if (cause instanceof ConvexError) throw cause;
      throw new ConvexError(`The withdrawal was not sent: ${sendFailure(cause)}.`);
    }

    const receipt = await bscPublicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new ConvexError(`The withdrawal reverted. Transaction ${hash}.`);
    try {
      await ctx.runAction(api.walletActions.record, { altanaWalletAddress: from, transactionHash: hash, kind: "withdraw", purpose: "withdraw", to });
    } catch (cause) {
      console.warn("[agentWallet] withdrawal sent but not recorded yet:", hash, cause);
    }
    return { transactionHash: hash, text: `Sent ${token.symbol} to your wallet ${to.slice(0, 6)}…${to.slice(-4)}.` };
  },
});
