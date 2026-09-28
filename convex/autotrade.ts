/**
 * NO-TAP TRADING: an agent trades by itself with a scoped session key.
 * (Owner's approval, 2026-09-28: "trade with no tap at all", opt-in per
 * agent, 7 days by default with 1 and 30 as options, and a way to revoke.)
 *
 * THE KEY. Generated here, in an action; its private half is sealed with
 * lib/secretBox.ts the moment it exists and is only ever opened inside
 * `executeTrade`. The browser receives the PUBLIC key and grants it from the
 * owner's Dolphin Wallet with one passkey approval (Altana grantSession).
 * From then on the Altana account contract itself enforces what the key may
 * do - Dolphin could not exceed it even by mistake:
 *
 *   - calls: PancakeSwap's V2 and V3 routers, and approve() on Dolphin's
 *     verified tokens. Never an empty list: Altana reads a missing `calls` as
 *     "any contract".
 *   - spend: a daily cap on every one of those tokens and on native BNB, equal
 *     to the Risk block's dollars-per-trade x trades-per-day at the time of the
 *     grant. A token with no live price is left out entirely rather than left
 *     uncapped.
 *   - expiry: 1, 7 (default) or 30 days.
 *
 * STOPPING. `stop` deletes the sealed key at once - no passkey needed, so it
 * works even when the owner is away from their device - and Dolphin can no
 * longer trade with it. `markRevoked` records the owner's on-chain
 * revocation, which kills the key everywhere.
 *
 * Every executed trade is recorded from its receipt in Agent activity
 * (walletActions.record, the owner's rule: every wallet action is recorded).
 */

import { BNB, createClient, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import { ConvexError, v } from "convex/values";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { bscPairFor, type AgentBlock } from "./lib/agentBlocks";
import { bscPublicClient } from "./lib/bscClient";
import {
  PANCAKE_V2_ROUTER,
  PANCAKE_V3_SWAP_ROUTER,
  WBNB_BSC,
  assertTradeCallsAllowed,
  buildTradeCalls,
  describeRoute,
  quoteTrade,
  type TradeSide,
} from "./lib/pancakeswapTrade";
import { open, seal } from "./lib/secretBox";
import { verifiedTokens } from "./lib/tradeTokens";
import { requireWalletAddress } from "./lib/walletAuth";

export const TRADE_KEY_DURATIONS = [1, 7, 30] as const;
const STABLE_SYMBOLS = new Set(["USDT", "USDC", "U"]);

type StoredPermissions = {
  calls: { to: string; signature?: string }[];
  spend: { limit: string; period: "day"; token?: string }[];
};

function toSessionPermissions(json: string): Session["permissions"] {
  const stored = JSON.parse(json) as StoredPermissions;
  return {
    calls: stored.calls.map((call) => (call.signature ? { to: call.to as Address, signature: call.signature } : { to: call.to as Address })),
    spend: stored.spend.map((cap) => ({ limit: BigInt(cap.limit), period: cap.period, ...(cap.token ? { token: cap.token as Address } : {}) })),
  };
}

/* ── ownership ──────────────────────────────────────────────────────────── */

/** The draft behind a build conversation, if the signed-in wallet owns it (it owns its Brain's key). */
export const ownedDraft = internalQuery({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Trading without asking");
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation || (conversation.mode ?? "chat") !== "build") throw new ConvexError("That is not an agent draft.");
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .unique();
    if (!draft) throw new ConvexError("That draft is empty.");
    if (!draft.brain || draft.brain.walletAddress !== walletAddress) {
      throw new ConvexError("Only the wallet whose key this agent's brain runs on can let it trade.");
    }
    return { draftId: draft._id, walletAddress, name: draft.name ?? "Agent", blocks: (draft.blocks ?? []) as AgentBlock[] };
  },
});

/* ── prepare -> grant (browser, passkey) -> confirm ────────────────────── */

/**
 * Creates the session key and the exact permissions to grant. Returns only
 * public material; the private key is sealed before this returns.
 */
export const prepare = action({
  args: {
    sessionToken: v.string(),
    conversationKey: v.string(),
    altanaWalletAddress: v.string(),
    durationDays: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ keyId: Id<"agentTradeKeys">; sessionPublicKey: string; sessionAddress: string; permissionsJson: string; expiry: number; dailyUsd: number }> => {
    const owned: { draftId: Id<"agentDrafts">; walletAddress: string; name: string; blocks: AgentBlock[] } = await ctx.runQuery(
      internal.autotrade.ownedDraft,
      {
        sessionToken: args.sessionToken,
        conversationKey: args.conversationKey,
      },
    );
    if (!(TRADE_KEY_DURATIONS as readonly number[]).includes(args.durationDays)) {
      throw new ConvexError("Choose 1, 7 or 30 days.");
    }
    if (!isAddress(args.altanaWalletAddress)) throw new ConvexError("That is not a Dolphin Wallet address.");
    const risk = owned.blocks.find((block) => block.type === "risk");
    if (!risk || !owned.blocks.some((block) => block.type === "swap")) {
      throw new ConvexError("Add Risk limits and a Swap block first - they are what the key is limited to.");
    }
    const dailyUsd: number = risk.type === "risk" ? risk.config.maxTradeUsd * risk.config.maxTradesPerDay : 0;

    // Daily caps. Every token the key may approve gets one; unpriceable tokens are left out.
    const calls: StoredPermissions["calls"] = [{ to: PANCAKE_V2_ROUTER }, { to: PANCAKE_V3_SWAP_ROUTER }];
    const spend: StoredPermissions["spend"] = [];
    const bnb = await bscPairFor(WBNB_BSC).catch(() => null);
    if (!bnb?.priceUsd) throw new ConvexError("BNB's live price could not be read, so no safe cap can be set. Try again shortly.");
    spend.push({ limit: parseUnits((dailyUsd / bnb.priceUsd).toFixed(18), 18).toString(), period: "day" });
    for (const token of verifiedTokens()) {
      if (!token.address || getAddress(token.address) === WBNB_BSC) continue;
      const priceUsd = STABLE_SYMBOLS.has(token.symbol) ? 1 : ((await bscPairFor(token.address).catch(() => null))?.priceUsd ?? null);
      if (!priceUsd) continue;
      const units = (dailyUsd / priceUsd).toFixed(Math.min(token.decimals, 18));
      calls.push({ to: getAddress(token.address), signature: "approve(address,uint256)" });
      spend.push({ limit: parseUnits(units, token.decimals).toString(), period: "day", token: getAddress(token.address) });
    }
    // WBNB is both the V3 path token and a sellable asset: capped like BNB.
    calls.push({ to: WBNB_BSC, signature: "approve(address,uint256)" });
    spend.push({ limit: parseUnits((dailyUsd / bnb.priceUsd).toFixed(18), 18).toString(), period: "day", token: WBNB_BSC });

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const box = await seal(privateKey);
    const expiry = Math.floor(Date.now() / 1000) + args.durationDays * 86_400;
    const permissionsJson = JSON.stringify({ calls, spend } satisfies StoredPermissions);

    const keyId: Id<"agentTradeKeys"> = await ctx.runMutation(internal.autotrade.insertPending, {
      draftId: owned.draftId,
      ownerAddress: owned.walletAddress,
      altanaWalletAddress: getAddress(args.altanaWalletAddress),
      sessionPublicKey: account.publicKey,
      sessionAddress: account.address,
      ciphertext: box.ciphertext,
      iv: box.iv,
      permissionsJson,
      expiry,
      durationDays: args.durationDays,
    });
    return {
      keyId,
      sessionPublicKey: account.publicKey as string,
      sessionAddress: account.address as string,
      permissionsJson,
      expiry,
      dailyUsd,
    };
  },
});

export const insertPending = internalMutation({
  args: {
    draftId: v.id("agentDrafts"),
    ownerAddress: v.string(),
    altanaWalletAddress: v.string(),
    sessionPublicKey: v.string(),
    sessionAddress: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    permissionsJson: v.string(),
    expiry: v.number(),
    durationDays: v.number(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("agentTradeKeys", {
      ...args,
      status: "pending",
      grantTransactionHash: null,
      createdAt: new Date().toISOString(),
      grantedAt: null,
      stoppedAt: null,
      revokedAt: null,
    }),
});

/** Called once the owner's passkey granted the session on-chain. Any older key for this agent stops. */
export const confirmGrant = mutation({
  args: { sessionToken: v.string(), keyId: v.id("agentTradeKeys"), transactionHash: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken, keyId, transactionHash }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Trading without asking");
    const key = await ctx.db.get(keyId);
    if (!key || key.ownerAddress !== walletAddress) throw new ConvexError("That trade key is not yours.");
    if (key.status !== "pending") throw new ConvexError("That trade key was already used.");
    const now = new Date().toISOString();
    const older = await ctx.db
      .query("agentTradeKeys")
      .withIndex("by_draft", (q) => q.eq("draftId", key.draftId))
      .collect();
    for (const row of older) {
      if (row._id !== keyId && row.status !== "stopped") {
        await ctx.db.patch(row._id, { status: "stopped", ciphertext: null, iv: null, stoppedAt: now });
      }
    }
    await ctx.db.patch(keyId, {
      status: "active",
      grantedAt: now,
      grantTransactionHash: transactionHash && /^0x[0-9a-fA-F]{64}$/.test(transactionHash) ? transactionHash : null,
    });
    return null;
  },
});

/* ── stop and revoke ─────────────────────────────────────────────────────── */

/**
 * STOP NOW: destroys Dolphin's copy of every live key for this agent. Takes
 * effect immediately and needs no passkey. Returns the public keys so the
 * owner can also revoke them on-chain.
 */
export const stop = mutation({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Stopping trading");
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    const draft = conversation
      ? await ctx.db
          .query("agentDrafts")
          .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
          .unique()
      : null;
    if (!draft) throw new ConvexError("That draft is empty.");
    const keys = await ctx.db
      .query("agentTradeKeys")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect();
    const now = new Date().toISOString();
    const stopped: { keyId: Id<"agentTradeKeys">; sessionPublicKey: string; altanaWalletAddress: string }[] = [];
    for (const key of keys) {
      if (key.ownerAddress !== walletAddress || key.status === "stopped") continue;
      await ctx.db.patch(key._id, { status: "stopped", ciphertext: null, iv: null, stoppedAt: now });
      if (key.status === "active") {
        stopped.push({ keyId: key._id, sessionPublicKey: key.sessionPublicKey, altanaWalletAddress: key.altanaWalletAddress });
      }
    }
    return stopped;
  },
});

/** Records the owner's on-chain revocation of a key (sent from their wallet). */
export const markRevoked = mutation({
  args: { sessionToken: v.string(), keyId: v.id("agentTradeKeys") },
  handler: async (ctx, { sessionToken, keyId }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "Revoking");
    const key = await ctx.db.get(keyId);
    if (!key || key.ownerAddress !== walletAddress) throw new ConvexError("That trade key is not yours.");
    const now = new Date().toISOString();
    await ctx.db.patch(keyId, { status: "stopped", ciphertext: null, iv: null, stoppedAt: key.stoppedAt ?? now, revokedAt: now });
    return null;
  },
});

/** The agent's latest trade key, for the panel. Never any key material. */
export const forDraft = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    const draft = conversation
      ? await ctx.db
          .query("agentDrafts")
          .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
          .unique()
      : null;
    if (!draft) return null;
    const keys = await ctx.db
      .query("agentTradeKeys")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .take(5);
    const latest = keys.find((key) => key.status !== "pending") ?? null;
    // An unrevoked, stopped key is still live on-chain until its expiry: offer the revoke.
    const unrevoked = keys.filter((key) => key.status === "stopped" && !key.revokedAt && key.grantedAt && key.expiry > Date.now() / 1000);
    if (!latest) return { status: "none" as const, unrevoked: unrevoked.map(summary) };
    const expired = latest.status === "active" && latest.expiry <= Date.now() / 1000;
    return {
      ...summary(latest),
      status: expired ? ("expired" as const) : latest.status,
      unrevoked: unrevoked.map(summary),
    };
  },
});

function summary(key: {
  _id: Id<"agentTradeKeys">;
  expiry: number;
  durationDays: number;
  sessionPublicKey: string;
  altanaWalletAddress: string;
  grantedAt: string | null;
  revokedAt: string | null;
}) {
  return {
    keyId: key._id,
    expiry: key.expiry,
    durationDays: key.durationDays,
    sessionPublicKey: key.sessionPublicKey,
    altanaWalletAddress: key.altanaWalletAddress,
    grantedAt: key.grantedAt,
    revokedAt: key.revokedAt,
  };
}

/* ── execution ──────────────────────────────────────────────────────────── */

export const activeKey = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const keys = await ctx.db
      .query("agentTradeKeys")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .order("desc")
      .take(5);
    const key = keys.find((row) => row.status === "active" && row.ciphertext && row.iv && row.expiry > Date.now() / 1000);
    return key ?? null;
  },
});

type TicketSide = { address: string | null; symbol: string; decimals: number };

/**
 * Executes a proposal the Risk block already passed (runBlockTool), with the
 * agent's own session key. `attempted: false` means there is no live key and
 * the ticket stays for the owner to sign, as before.
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
    const key: Doc<"agentTradeKeys"> | null = await ctx.runQuery(internal.autotrade.activeKey, { draftId });
    if (!key || !key.ciphertext || !key.iv) return { attempted: false, executed: false, text: "" };

    const wallet = getAddress(key.altanaWalletAddress) as Address;
    const tokenIn: TradeSide = ticket.tokenIn as TicketSide;
    const tokenOut: TradeSide = ticket.tokenOut as TicketSide;
    let amountInRaw: bigint;
    try {
      amountInRaw = parseUnits(ticket.amountIn, tokenIn.decimals);
    } catch {
      return { attempted: true, executed: false, text: "The amount could not be read, so nothing was traded." };
    }

    // Enough to sell? A trade that would revert costs gas and proves nothing.
    const balance = tokenIn.address
      ? await bscPublicClient.readContract({ address: getAddress(tokenIn.address) as Address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] })
      : await bscPublicClient.getBalance({ address: wallet });
    if (balance < amountInRaw) {
      return {
        attempted: true,
        executed: false,
        text: `Not traded: the Dolphin Wallet holds ${formatUnits(balance, tokenIn.decimals)} ${tokenIn.symbol}, less than ${ticket.amountIn}.`,
      };
    }

    const routes = await quoteTrade({ publicClient: bscPublicClient as never, tokenIn, tokenOut, amountInRaw });
    const route = routes[0];
    if (!route) return { attempted: true, executed: false, text: "Not traded: PancakeSwap had no route for that swap right now." };
    const calls = buildTradeCalls({ route, tokenIn, tokenOut, recipient: wallet });
    assertTradeCallsAllowed(calls, tokenIn);

    const privateKey = (await open({ ciphertext: key.ciphertext, iv: key.iv })) as Hex;
    const signer = signerFromPrivateKey(privateKey);
    if (signer.address.toLowerCase() !== key.sessionAddress.toLowerCase()) {
      return { attempted: true, executed: false, text: "Not traded: the stored key did not match its record." };
    }
    const session: Session = {
      walletAddress: wallet,
      signer,
      publicKey: key.sessionPublicKey as Hex,
      permissions: toSessionPermissions(key.permissionsJson),
      expiry: key.expiry,
    };

    let result;
    try {
      const client = createClient({ chains: [BNB], defaultChainId: BNB.chainId });
      result = await client.execute({
        session,
        chainId: BNB.chainId,
        calls: calls.map((call) => ({ to: call.to, data: call.data, ...(call.value ? { value: call.value } : {}) })),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // The account contract enforces the grant: a refusal means the key was not granted, was revoked,
      // has expired, or this trade would pass its daily caps. Measured on dev: an ungranted key is refused
      // by the relay at wallet_prepareCalls.
      console.warn("[autotrade] relay refused:", message.slice(0, 400));
      return {
        attempted: true,
        executed: false,
        text: "Not traded: the Dolphin Wallet refused the swap - its trade key is not granted, was revoked, has expired, or today's caps are used up.",
      };
    }
    if (result.status === "FAILED" || !result.transactionHash) {
      return { attempted: true, executed: false, text: `Not traded: the swap did not confirm (status ${result.status}).` };
    }

    // Every wallet action is recorded from its receipt (the owner's rule).
    try {
      await ctx.runAction(api.walletActions.record, {
        altanaWalletAddress: wallet,
        transactionHash: result.transactionHash,
        kind: "agent",
        purpose: "agent",
        agentName,
      });
    } catch (cause) {
      console.warn("[autotrade] trade executed but could not be recorded yet:", result.transactionHash, cause);
    }

    const out = formatUnits(route.amountOutRaw, tokenOut.decimals);
    return {
      attempted: true,
      executed: true,
      transactionHash: result.transactionHash,
      text: `Traded: sold ${ticket.amountIn} ${tokenIn.symbol} for about ${Number(out).toPrecision(6)} ${tokenOut.symbol} on ${describeRoute(route)}. Transaction ${result.transactionHash}.`,
    };
  },
});
