import { ConvexError, v } from "convex/values";
import { createPublicClient, getAddress, http, parseAbi, parseEventLogs, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, internalMutation } from "./_generated/server";
import { NETWORKS, registrationUrl } from "./builtAgents";
import { bscPublicClient } from "./lib/bscClient";
import { sniffIconType } from "./lib/iconPolicy";
import { randomHex } from "./lib/walletAuth";

/**
 * MOVING A REGISTRATION BETWEEN DEPLOYMENTS, AND REPOINTING ITS TOKEN.
 * (2026-09-27)
 *
 * Agent #358958 was registered on mainnet from localhost, against the DEV
 * deployment, so its record lived on dev and its token's URI named the dev
 * backend. The owner then asked for a full move to prod. These functions:
 *
 *   adoptRegistered   recreate the listing on this deployment, checking the
 *                     token, owner and mint transaction against the chain
 *   confirmUriUpdate  record the owner's setAgentURI once the chain shows the
 *                     token now points at this deployment's registration file
 *   retire            stop serving a listing on this deployment (dev, after)
 */

const REGISTRY_EVENTS = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
const REGISTRY_READS = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

function clientFor(network: "bsc" | "bsc-testnet"): PublicClient {
  if (network === "bsc") return bscPublicClient as unknown as PublicClient;
  return createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com"),
  }) as unknown as PublicClient;
}

const toolsValidator = v.array(v.object({ agentKey: v.string(), agentName: v.string(), toolName: v.string() }));
const linksValidator = v.object({
  website: v.union(v.string(), v.null()),
  x: v.union(v.string(), v.null()),
  email: v.union(v.string(), v.null()),
});

/**
 * Internal: an operator runs it with `npx convex run --prod`. Trusts nothing
 * the chain can answer - the token must exist on the MAINNET registry, be
 * owned by `ownerAddress`, and have been minted to them by `registerTxHash`.
 * The icon is fetched from the source deployment's /icon and must be a PNG or
 * JPEG. Returns a build conversation key for /dolphin?c=.
 */
export const adoptRegistered = internalAction({
  args: {
    sourceBase: v.string(),
    hash: v.string(),
    ownerAddress: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    tools: toolsValidator,
    category: v.string(),
    links: linksValidator,
    tokenId: v.string(),
    registerTxHash: v.string(),
  },
  handler: async (ctx, args): Promise<{ conversationKey: string; hash: string }> => {
    if (!/^https:\/\/[a-z0-9.-]+\.convex\.site$/.test(args.sourceBase)) {
      throw new Error("sourceBase must be a Convex deployment's .convex.site origin.");
    }
    if (!/^d[0-9a-f]{15}$/.test(args.hash)) throw new Error("Not a built-agent hash.");
    const owner = getAddress(args.ownerAddress);
    const registry = getAddress(NETWORKS.bsc.registry);
    const client = clientFor("bsc");

    const tokenId = BigInt(args.tokenId);
    const holder = await client.readContract({ address: registry, abi: REGISTRY_READS, functionName: "ownerOf", args: [tokenId] });
    if (getAddress(holder) !== owner) throw new Error(`Token ${args.tokenId} is owned by ${holder}, not ${owner}.`);

    const receipt = await client.getTransactionReceipt({ hash: args.registerTxHash as `0x${string}` });
    const minted = parseEventLogs({ abi: REGISTRY_EVENTS, logs: receipt.logs }).find(
      (event) =>
        getAddress(event.address) === registry &&
        BigInt(event.args.from) === BigInt(0) &&
        getAddress(event.args.to) === owner &&
        event.args.tokenId === tokenId,
    );
    if (receipt.status !== "success" || !minted) throw new Error("That transaction did not mint this token to this owner.");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });

    const iconResponse = await fetch(`${args.sourceBase}/api/v1/built/${args.hash}/icon`);
    if (!iconResponse.ok) throw new Error(`Could not fetch the icon (HTTP ${iconResponse.status}).`);
    const iconBytes = new Uint8Array(await iconResponse.arrayBuffer());
    const kind = sniffIconType(iconBytes.subarray(0, 16));
    if (!kind || iconBytes.length > 512 * 1024) throw new Error("The source icon is not a processed PNG/JPEG.");
    const iconStorageId = await ctx.storage.store(new Blob([iconBytes], { type: kind }));

    return ctx.runMutation(internal.builtAgentMoves.storeAdopted, {
      hash: args.hash,
      ownerAddress: owner,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      tools: args.tools,
      category: args.category,
      links: args.links,
      iconStorageId,
      iconContentType: kind,
      iconBytes: iconBytes.length,
      tokenId: args.tokenId,
      agentKey: `${NETWORKS.bsc.chainId}:${registry.toLowerCase()}:${args.tokenId}`,
      registerTxHash: args.registerTxHash.toLowerCase(),
      registeredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
  },
});

export const storeAdopted = internalMutation({
  args: {
    hash: v.string(),
    ownerAddress: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    tools: toolsValidator,
    category: v.string(),
    links: linksValidator,
    iconStorageId: v.id("_storage"),
    iconContentType: v.union(v.literal("image/png"), v.literal("image/jpeg")),
    iconBytes: v.number(),
    tokenId: v.string(),
    agentKey: v.string(),
    registerTxHash: v.string(),
    registeredAt: v.string(),
  },
  handler: async (ctx, args): Promise<{ conversationKey: string; hash: string }> => {
    const existing = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .unique();
    if (existing) throw new Error("That agent is already on this deployment.");

    const now = Date.now();
    const conversationKey = randomHex(32);
    const conversationId = await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress: args.ownerAddress,
      title: args.name,
      seedAgentKey: null,
      mode: "build",
      createdAt: now,
      updatedAt: now,
    });
    const draftId = await ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress: args.ownerAddress,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      tools: args.tools,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentIcons", {
      storageId: args.iconStorageId,
      ownerAddress: args.ownerAddress,
      contentType: args.iconContentType,
      width: 0,
      height: 0,
      bytes: args.iconBytes,
      createdAt: now,
    });
    await ctx.db.insert("builtAgents", {
      hash: args.hash,
      draftId,
      ownerAddress: args.ownerAddress,
      network: "bsc",
      chainId: NETWORKS.bsc.chainId,
      registry: NETWORKS.bsc.registry,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      tools: args.tools,
      category: args.category,
      links: args.links,
      iconStorageId: args.iconStorageId,
      iconContentType: args.iconContentType,
      status: "registered",
      tokenId: args.tokenId,
      agentKey: args.agentKey,
      registerTxHash: args.registerTxHash,
      registeredAt: args.registeredAt,
      createdAt: now,
      updatedAt: now,
    });
    return { conversationKey, hash: args.hash };
  },
});

/**
 * The owner repointed their token (components/repoint-agent-uri.tsx). Checked
 * on-chain - the tx succeeded, came from them, and tokenURI now reads this
 * deployment's registration file - before it is recorded, so it can show in
 * Agent activity (the owner's every-action rule).
 */
export const confirmUriUpdate = action({
  args: { sessionToken: v.string(), hash: v.string(), transactionHash: v.string() },
  handler: async (ctx, args): Promise<{ tokenURI: string }> => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.transactionHash)) throw new ConvexError("That is not a transaction hash.");
    const owner: string = await ctx.runQuery(internal.builtAgents.sessionOwner, { sessionToken: args.sessionToken });
    const listing: Doc<"builtAgents"> | null = await ctx.runQuery(internal.builtAgents.byHash, { hash: args.hash });
    if (!listing || listing.ownerAddress !== owner || !listing.tokenId) throw new ConvexError("That agent is not yours.");

    const client = clientFor(listing.network);
    const receipt = await client.waitForTransactionReceipt({ hash: args.transactionHash as `0x${string}`, timeout: 60_000 });
    if (receipt.status !== "success" || getAddress(receipt.from) !== owner) {
      throw new ConvexError("That transaction did not succeed from your wallet.");
    }
    const uri = await client.readContract({
      address: getAddress(listing.registry),
      abi: REGISTRY_READS,
      functionName: "tokenURI",
      args: [BigInt(listing.tokenId)],
    });
    if (uri !== registrationUrl(listing.hash)) throw new ConvexError("The token still points somewhere else.");

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    await ctx.runMutation(internal.builtAgentMoves.markUriUpdated, {
      hash: listing.hash,
      uriTxHash: args.transactionHash.toLowerCase(),
      uriUpdatedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
    return { tokenURI: uri };
  },
});

export const markUriUpdated = internalMutation({
  args: { hash: v.string(), uriTxHash: v.string(), uriUpdatedAt: v.string() },
  handler: async (ctx, { hash, ...fields }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (row) await ctx.db.patch(row._id, { ...fields, updatedAt: Date.now() });
  },
});

/** Operators: stop serving a listing on this deployment (dev, once moved). */
export const retire = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (row) await ctx.db.patch(row._id, { status: "unpublished", updatedAt: Date.now() });
  },
});
