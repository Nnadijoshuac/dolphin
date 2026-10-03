import { ConvexError, v } from "convex/values";
import { createPublicClient, getAddress, http, isAddress, parseAbi, parseEventLogs, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { PUBLIC_BLOCK_TYPES, activeBlocks, type AgentBlock } from "./lib/agentBlocks";
import type { KnowledgeTool } from "./lib/knowledgeTools";
import { builtListingPricing, type ListingKnowledge } from "./lib/knowledgeServe";
import { capabilityCount, draftGaps } from "./lib/agentSpec";
import { MAX_ICONS_PER_WALLET_PER_DAY } from "./lib/iconPolicy";
import { bscPublicClient } from "./lib/bscClient";
import { screenAgent } from "./lib/screen";
import { MAX_PRICE_U, MIN_PRICE_U, U_TOKEN, formatU, parsePriceU, priceInBounds } from "./lib/x402";
import { ensureAgentWallet } from "./x402";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

/**
 * PUTTING A BUILT AGENT ON-CHAIN. (2026-09-26, owner's decisions in
 * Agent/PLAN-2026-09-26-build-your-agent.md §6c)
 *
 *   1. The owner uploads an icon (iconUploadUrl, then iconProcessing.process).
 *   2. prepareListing checks everything and snapshots the draft under a new
 *      public `hash`. The registration file is live from this moment.
 *   3. The owner's CONNECTED wallet signs `register(tokenURI)` on the ERC-8004
 *      Identity Registry. They pay the gas and own the NFT; Dolphin holds no key.
 *   4. confirmRegistration reads the receipt and the registry, and only then
 *      records the token as theirs.
 *
 * Nothing here trusts the browser for anything the chain can answer.
 */

/**
 * The ERC-8004 Identity Registry per network. Mainnet 0x8004A169… is the
 * address this repo verified 2026-09-06 (convex/model/agent.ts); both proxies
 * were read on 2026-09-26 and point at the SAME implementation, 0x7274…9c02,
 * named "AgentIdentity", with register(string) present.
 */
export const NETWORKS = {
  bsc: { chainId: 56, registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", label: "BNB Chain" },
  "bsc-testnet": { chainId: 97, registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e", label: "BNB Chain testnet" },
} as const;

/** What a built agent can be filed under on Dolphin. */
export const BUILT_AGENT_CATEGORIES = [
  "trading",
  "yield",
  "health-factor",
  "rebalancing",
  "security",
  "monitoring",
  "payments",
  "general",
] as const;

const MIN_DESCRIPTION_CHARS = 40;

/** The only base a MAINNET registration may point at. See prepareListing. */
const OFFICIAL_API_BASE = "https://www.dolphinamp.xyz";

/** Where the registration file, icon and MCP endpoint are served from. */
export function apiBase(): string {
  return (process.env.PUBLIC_API_BASE_URL ?? process.env.CONVEX_SITE_URL ?? "https://www.dolphinamp.xyz").replace(/\/+$/, "");
}

/** Where people see the agent. The owner's choice: dolphin's own domain. */
export function siteBase(): string {
  return (process.env.PUBLIC_SITE_URL ?? "https://www.dolphinamp.xyz").replace(/\/+$/, "");
}

export function registrationUrl(hash: string): string {
  return `${apiBase()}/api/v1/built/${hash}/registration.json`;
}

/* ---------------------------------------------------------------------------
 * Icons
 * ------------------------------------------------------------------------ */

async function assertUnderIconLimit(ctx: { db: import("./_generated/server").QueryCtx["db"] }, owner: string) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await ctx.db
    .query("agentIcons")
    .withIndex("by_owner", (q) => q.eq("ownerAddress", owner).gte("createdAt", since))
    .collect();
  if (recent.length >= MAX_ICONS_PER_WALLET_PER_DAY) {
    throw new ConvexError(`You've uploaded ${recent.length} icons today, which is the limit. Try again tomorrow.`);
  }
}

/** A one-time upload URL, for a signed-in wallet under its daily limit. */
export const iconUploadUrl = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const owner = await requireWalletAddress(ctx, sessionToken, "Uploading an agent icon");
    await assertUnderIconLimit(ctx, owner);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

/** For iconProcessing.process: who is uploading, re-checked there. */
export const iconUploader = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<string> => {
    const owner = await requireWalletAddress(ctx, sessionToken, "Uploading an agent icon");
    await assertUnderIconLimit(ctx, owner);
    return owner;
  },
});

export const recordIcon = internalMutation({
  args: {
    storageId: v.id("_storage"),
    ownerAddress: v.string(),
    contentType: v.union(v.literal("image/png"), v.literal("image/jpeg")),
    width: v.number(),
    height: v.number(),
    bytes: v.number(),
  },
  handler: async (ctx, row) => {
    await ctx.db.insert("agentIcons", { ...row, createdAt: Date.now() });
  },
});

/* ---------------------------------------------------------------------------
 * Publishing
 * ------------------------------------------------------------------------ */

function cleanOptional(value: string | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * Everything checked, the draft snapshotted, and a hash issued. Returns what
 * the connected wallet needs to sign `register(tokenURI)`.
 */
export const prepareListing = mutation({
  args: {
    sessionToken: v.string(),
    buildConversationKey: v.string(),
    network: v.union(v.literal("bsc"), v.literal("bsc-testnet")),
    iconStorageId: v.id("_storage"),
    category: v.string(),
    website: v.optional(v.string()),
    x: v.optional(v.string()),
    email: v.optional(v.string()),
    /** Where its payments go. Defaults to the signed-in wallet; never a key Dolphin holds. */
    payoutAddress: v.optional(v.string()),
    /**
     * WHO CAN USE IT, chosen here at "Put on-chain" (owner, 2026-09-29: part of
     * the flow, not the first thing). public = anyone (free, or paid when a
     * price is set); private = "just for me": registered to the owner's
     * wallet, never listed, no public endpoint.
     */
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    /** Price per job in US dollars - the pre-x402 form, still accepted from older clients. */
    priceUsd: v.optional(v.union(v.number(), v.null())),
    /**
     * HOW IT IS CALLED AND WHAT A CALL COSTS (owner, 2026-10-02). "mcp": a
     * tool server; "a2a": an agent that takes a task. priceU is a decimal in
     * U per call, paid with x402 straight to the payout wallet. Blank: free.
     */
    protocol: v.optional(v.union(v.literal("mcp"), v.literal("a2a"))),
    priceU: v.optional(v.union(v.string(), v.null())),
    /** What a buyer gives it. Absent: a token for an agent with a Safety block, a wallet otherwise. */
    inputs: v.optional(v.array(v.union(v.literal("wallet"), v.literal("token")))),
  },
  handler: async (ctx, args) => {
    const owner = await requireWalletAddress(ctx, args.sessionToken, "Putting an agent on-chain");
    const payoutRaw = (args.payoutAddress ?? "").trim();
    if (payoutRaw && !isAddress(payoutRaw)) throw new ConvexError("The payout wallet is not a valid address.");
    const payoutAddress = getAddress(payoutRaw || owner);

    const build = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", args.buildConversationKey))
      .unique();
    if (!build || (build.mode ?? "chat") !== "build") throw new ConvexError("That is not an agent draft.");
    /*
     * A draft begun by one wallet is published only by that wallet. An
     * anonymous draft (no owner bound) is published by whoever holds its key,
     * which is the same capability rule as the conversation itself.
     */
    if (build.ownerAddress && build.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
      throw new ConvexError("This draft belongs to another wallet.");
    }
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", build._id))
      .unique();
    if (!draft) throw new ConvexError("This draft is empty. Describe the agent first.");

    const visibility = args.visibility ?? "public";
    const priceUsd = visibility === "public" && args.priceUsd !== undefined && args.priceUsd !== null ? args.priceUsd : null;
    if (priceUsd !== null && !(priceUsd > 0 && priceUsd <= 10_000)) throw new ConvexError("A price per job must be between $0.01 and $10,000.");
    const protocol = args.protocol ?? "mcp";
    const priceText = visibility === "public" ? (args.priceU ?? "").trim() : "";
    let priceRaw: string | null = null;
    if (priceText) {
      const parsed = parsePriceU(priceText);
      if (parsed === null || !priceInBounds(parsed)) {
        throw new ConvexError(`A price per call must be between ${MIN_PRICE_U} and ${MAX_PRICE_U} U.`);
      }
      // U lives on BNB Chain mainnet, so that is where a paid agent is settled and listed.
      if (args.network !== "bsc") throw new ConvexError("Paid calls are settled in U on BNB Chain. Publish a paid agent on BNB Chain, or leave the price blank to try it on Testnet.");
      // A paid call runs on the builder's own model key, never Dolphin's free budget.
      if (!draft.brain) throw new ConvexError("A paid agent answers with your own model. Add a Brain with your API key first.");
      priceRaw = parsed.toString();
    }
    const gaps = draftGaps(draft, capabilityCount(draft));
    if (gaps.length > 0) throw new ConvexError(`The agent needs ${gaps.join(", ")} before it can go on-chain.`);

    /*
     * ITS DOCUMENTS AND THEIR TOOLS (step 3, Agent/PLAN-2026-10-03-knowledge-mcps.md),
     * frozen into the listing. A documents agent is a tool server: each tool is
     * called and priced on its own, which an escrow job (one task, one price) cannot do.
     */
    const knowledgeTools = (draft.knowledgeTools ?? []).filter((tool) => tool.enabled);
    let knowledge: ListingKnowledge | undefined;
    if (knowledgeTools.length > 0) {
      if (protocol === "a2a") {
        throw new ConvexError("An agent with documents is published as a tool server (MCP): each of its tools is called and priced on its own. Choose Tool server.");
      }
      if (visibility === "public" && knowledgeTools.some((tool) => tool.priceU) && args.network !== "bsc") {
        throw new ConvexError("Paid tools are settled in U on BNB Chain. Publish on BNB Chain, or make every tool free to try it on Testnet.");
      }
      if (knowledgeTools.some((tool) => tool.kind === "ask" || tool.kind === "described") && !draft.brain) {
        throw new ConvexError("Ask and the tools you described run on your own model. Add a Brain with your API key, or switch them off.");
      }
      const rows = await ctx.db
        .query("agentKnowledge")
        .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
        .collect();
      knowledge = {
        documents: rows
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((row) => ({ documentId: row._id as string, name: row.name, sha256: row.sha256, sections: row.sections })),
        tools: knowledgeTools as KnowledgeTool[],
      };
    }
    const name = draft.name as string;
    const description = draft.description as string;
    if (description.length < MIN_DESCRIPTION_CHARS) {
      throw new ConvexError(
        `The description is ${description.length} characters. Say what it does in at least ${MIN_DESCRIPTION_CHARS}, in your own words.`,
      );
    }
    /*
     * Dolphin's own spam screen, the same one every agent in the registry
     * passes through (lib/screen.ts). A built agent that would be rejected if
     * someone else had registered it is rejected here, before it costs gas.
     */
    const screened = screenAgent(name, description);
    if (screened.verdict === "reject") {
      throw new ConvexError(
        `Dolphin's listing screen would reject this description (${screened.rule}). Rewrite it to say concretely what this agent does.`,
      );
    }

    const mine = await ctx.db
      .query("builtAgents")
      .withIndex("by_owner", (q) => q.eq("ownerAddress", owner))
      .collect();
    const duplicate = mine.find(
      (row) =>
        row.status !== "unpublished" &&
        row.network === args.network &&
        row.draftId !== draft._id &&
        row.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new ConvexError(`You already have an agent called "${duplicate.name}" on this network. Pick another name.`);

    const already = await ctx.db
      .query("builtAgents")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id).eq("network", args.network))
      .collect();
    if (already.some((row) => row.status === "registered")) {
      throw new ConvexError("This agent is already on-chain on that network. Unpublish it first to publish a new version.");
    }

    const icon = await ctx.db
      .query("agentIcons")
      .withIndex("by_storage", (q) => q.eq("storageId", args.iconStorageId))
      .unique();
    if (!icon || icon.ownerAddress !== owner) throw new ConvexError("Upload the agent's icon first.");

    if (!(BUILT_AGENT_CATEGORIES as readonly string[]).includes(args.category)) {
      throw new ConvexError("Pick a category for the agent.");
    }
    const website = cleanOptional(args.website, 200);
    if (website && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) throw new ConvexError("The website must be an https:// link.");
    const xHandle = cleanOptional(args.x, 16)?.replace(/^@/, "") ?? null;
    if (xHandle && !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) throw new ConvexError("That is not an X handle.");
    const email = cleanOptional(args.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("That is not an email address.");

    /*
     * MAINNET ONLY FROM DOLPHIN'S OWN DOMAIN. (2026-09-27) The first mainnet
     * publish was made from localhost against the DEV deployment, and its
     * token now points at greedy-aardvark-200.eu-west-1.convex.site - a
     * permanent on-chain record naming the dev backend. The tokenURI is written
     * on-chain, so a mainnet listing is refused unless this deployment serves
     * agents at the official domain (PUBLIC_API_BASE_URL, set on prod only).
     * Testnet is a rehearsal and stays open anywhere.
     */
    if (args.network === "bsc" && !apiBase().startsWith(OFFICIAL_API_BASE)) {
      throw new ConvexError(
        "Putting agents on BNB Chain is only available on dolphinamp.xyz. Use Testnet to try it here.",
      );
    }

    const network = NETWORKS[args.network];
    const snapshot = {
      ownerAddress: owner,
      network: args.network,
      chainId: network.chainId,
      registry: network.registry,
      name,
      description,
      instructions: draft.instructions as string,
      tools: draft.tools,
      category: args.category,
      links: { website, x: xHandle, email },
      payoutAddress,
      purpose: visibility === "private" ? ("private" as const) : priceUsd !== null && !priceRaw ? ("hire" as const) : ("tools" as const),
      hirePriceUsd: priceRaw ? null : priceUsd,
      protocol,
      priceRaw,
      blocks: activeBlocks((draft.blocks ?? []) as AgentBlock[], draft.detached).filter((block) => PUBLIC_BLOCK_TYPES.includes(block.type)),
      // Undefined clears it on a re-prepared publish whose documents were removed.
      knowledge,
      inputs:
        args.inputs && args.inputs.length > 0
          ? [...new Set(args.inputs)]
          : (draft.blocks ?? []).some((block) => (block as AgentBlock).type === "safety")
            ? (["token"] as const).slice()
            : (["wallet"] as const).slice(),
      iconStorageId: icon.storageId,
      iconContentType: icon.contentType,
      updatedAt: Date.now(),
    };

    /* A publish that was never signed is reused rather than duplicated. */
    const pending = already.find((row) => row.status === "awaiting-signature");
    let hash: string;
    if (pending) {
      await ctx.db.patch(pending._id, snapshot);
      hash = pending.hash;
    } else {
      hash = `d${randomHex(8).slice(0, 15)}`;
      await ctx.db.insert("builtAgents", {
        ...snapshot,
        hash,
        draftId: draft._id,
        status: "awaiting-signature",
        tokenId: null,
        agentKey: null,
        registerTxHash: null,
        registeredAt: null,
        createdAt: Date.now(),
      });
    }

    return {
      hash,
      tokenURI: registrationUrl(hash),
      registry: network.registry,
      chainId: network.chainId,
      pageUrl: `${siteBase()}/agent/${hash}`,
    };
  },
});

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

/**
 * The registration, checked against the chain before anything is recorded:
 * the transaction succeeded, it minted a token on THIS registry to THIS owner,
 * and the token's URI is this agent's registration file.
 */
export const confirmRegistration = action({
  args: { sessionToken: v.string(), hash: v.string(), transactionHash: v.string() },
  handler: async (ctx, args): Promise<{ tokenId: string; agentKey: string }> => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.transactionHash)) throw new ConvexError("That is not a transaction hash.");
    const owner: string = await ctx.runQuery(internal.builtAgents.sessionOwner, { sessionToken: args.sessionToken });
    const listing: Doc<"builtAgents"> | null = await ctx.runQuery(internal.builtAgents.byHash, { hash: args.hash });
    if (!listing || listing.ownerAddress !== owner) throw new ConvexError("That agent is not yours to confirm.");
    if (listing.status === "registered") {
      return { tokenId: listing.tokenId as string, agentKey: listing.agentKey as string };
    }

    const client = clientFor(listing.network);
    const receipt = await client.waitForTransactionReceipt({
      hash: args.transactionHash as `0x${string}`,
      timeout: 60_000,
    });
    if (receipt.status !== "success") throw new ConvexError("The registration transaction failed on-chain. Nothing was registered.");
    if (getAddress(receipt.from) !== owner) throw new ConvexError("That transaction was not sent by your signed-in wallet.");

    const registry = getAddress(listing.registry);
    const minted = parseEventLogs({ abi: REGISTRY_EVENTS, logs: receipt.logs }).find(
      (event) =>
        getAddress(event.address) === registry &&
        BigInt(event.args.from) === BigInt(0) &&
        getAddress(event.args.to) === owner,
    );
    if (!minted) throw new ConvexError("That transaction did not register an agent on the ERC-8004 registry.");
    const tokenId = minted.args.tokenId;

    const [uri, holder] = await Promise.all([
      client.readContract({ address: registry, abi: REGISTRY_READS, functionName: "tokenURI", args: [tokenId] }),
      client.readContract({ address: registry, abi: REGISTRY_READS, functionName: "ownerOf", args: [tokenId] }),
    ]);
    if (uri !== registrationUrl(listing.hash)) {
      throw new ConvexError("The registered token points somewhere other than this agent's registration file.");
    }
    if (getAddress(holder) !== owner) throw new ConvexError("The registered token is not owned by your wallet.");

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const agentKey = `${listing.chainId}:${registry.toLowerCase()}:${tokenId.toString()}`;
    await ctx.runMutation(internal.builtAgents.markRegistered, {
      hash: listing.hash,
      tokenId: tokenId.toString(),
      agentKey,
      registerTxHash: args.transactionHash.toLowerCase(),
      registeredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
    // Its own wallet, for collecting payments while the builder is offline (x402.ts, option A).
    if (listing.network === "bsc") await ensureAgentWallet(ctx, listing.hash);
    return { tokenId: tokenId.toString(), agentKey };
  },
});

export const sessionOwner = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<string> =>
    requireWalletAddress(ctx, sessionToken, "Confirming an agent registration"),
});

export const byHash = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) =>
    ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique(),
});

export const markRegistered = internalMutation({
  args: {
    hash: v.string(),
    tokenId: v.string(),
    agentKey: v.string(),
    registerTxHash: v.string(),
    registeredAt: v.string(),
  },
  handler: async (ctx, { hash, ...fields }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { ...fields, status: "registered", updatedAt: Date.now() });
  },
});

/** Takes a live agent offline. The NFT stays the owner's; the endpoint stops answering. */
export const unpublish = mutation({
  args: { sessionToken: v.string(), hash: v.string() },
  handler: async (ctx, { sessionToken, hash }) => {
    const owner = await requireWalletAddress(ctx, sessionToken, "Unpublishing an agent");
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!row || row.ownerAddress !== owner) throw new ConvexError("That agent is not yours.");
    await ctx.db.patch(row._id, { status: "unpublished", updatedAt: Date.now() });
  },
});

/* ---------------------------------------------------------------------------
 * Public reads
 * ------------------------------------------------------------------------ */

async function publicView(ctx: { storage: { getUrl: (id: Doc<"builtAgents">["iconStorageId"]) => Promise<string | null> } }, row: Doc<"builtAgents">) {
  const network = NETWORKS[row.network];
  const explorer = row.network === "bsc" ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return {
    hash: row.hash,
    name: row.name,
    description: row.description,
    category: row.category,
    tools: row.tools,
    links: row.links,
    ownerAddress: row.ownerAddress,
    network: row.network,
    networkLabel: network.label,
    chainId: row.chainId,
    registry: row.registry,
    status: row.status,
    tokenId: row.tokenId,
    agentKey: row.agentKey,
    registeredAt: row.registeredAt,
    iconUrl: await ctx.storage.getUrl(row.iconStorageId),
    registrationUrl: registrationUrl(row.hash),
    mcpUrl: `${apiBase()}/api/v1/built/${row.hash}/mcp`,
    protocol: row.protocol ?? ("mcp" as const),
    /** Where a caller connects: the MCP server, or the A2A agent card. */
    endpointUrl:
      (row.protocol ?? "mcp") === "a2a"
        ? `${apiBase()}/api/v1/built/${row.hash}/agent-card.json`
        : `${apiBase()}/api/v1/built/${row.hash}/mcp`,
    priceRaw: row.priceRaw ?? null,
    priceDisplay: row.priceRaw ? `${formatU(row.priceRaw)} U` : null,
    /** Its documents' tools as published, each with its own price (step 3); null for other agents. */
    knowledgeTools: row.knowledge
      ? row.knowledge.tools.filter((tool) => tool.enabled).map((tool) => ({ name: tool.name, description: tool.description, priceU: tool.priceU }))
      : null,
    /** Whether any call costs U: its single price, or any priced knowledge tool. Gas matters only then. */
    paid: Boolean(row.priceRaw) || Boolean(row.knowledge?.tools.some((tool) => tool.enabled && tool.priceU)),
    pageUrl: `${siteBase()}/agent/${row.hash}`,
    registerTxUrl: row.registerTxHash ? `${explorer}/tx/${row.registerTxHash}` : null,
    uriUpdatedAt: row.uriUpdatedAt ?? null,
    uriTxUrl: row.uriTxHash ? `${explorer}/tx/${row.uriTxHash}` : null,
  };
}

/**
 * What a catalog agent built on Dolphin asks its buyer for, by its agentKey -
 * the Hire card's fields. Null when the agent was not built here.
 */
export const inputsForAgentKey = query({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_agent_key", (q) => q.eq("agentKey", agentKey.toLowerCase()))
      .first();
    return row && row.status === "registered" ? (row.inputs ?? null) : null;
  },
});

/**
 * The catalog price of a tool server built on Dolphin (knowledge, step 4):
 * the probe reads no price from any MCP server, but Dolphin knows its own.
 * Null when the agent was not built here, or is not a live tool server.
 */
export const pricingForAgentKey = internalQuery({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_agent_key", (q) => q.eq("agentKey", agentKey.toLowerCase()))
      .first();
    if (!row || row.status !== "registered" || (row.protocol ?? "mcp") !== "mcp") return null;
    return builtListingPricing(row, U_TOKEN);
  },
});

/** A built agent's public page. Null for an unknown hash. */
export const publicByHash = query({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    return row ? publicView(ctx, row) : null;
  },
});

/** One owner's built agents, newest first. On-chain facts, so public. */
export const forOwner = query({
  args: { ownerAddress: v.string() },
  handler: async (ctx, { ownerAddress }) => {
    if (!isAddress(ownerAddress)) return [];
    const rows = await ctx.db
      .query("builtAgents")
      .withIndex("by_owner", (q) => q.eq("ownerAddress", getAddress(ownerAddress)))
      .order("desc")
      .take(50);
    return Promise.all(rows.map((row) => publicView(ctx, row)));
  },
});

/** The listing a build conversation has, per network, for the draft panel. */
export const forDraft = query({
  args: { buildConversationKey: v.string() },
  handler: async (ctx, { buildConversationKey }) => {
    const build = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", buildConversationKey))
      .unique();
    if (!build) return [];
    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", build._id))
      .unique();
    if (!draft) return [];
    const rows = await ctx.db
      .query("builtAgents")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect();
    return Promise.all(rows.map((row) => publicView(ctx, row)));
  },
});

/** Counts one public `ask`; false once the agent has used its day. */
export const countAsk = internalMutation({
  args: { hash: v.string(), limit: v.number() },
  handler: async (ctx, { hash, limit }) => {
    const day = new Date().toISOString().slice(0, 10);
    const row = await ctx.db
      .query("builtAgentUsage")
      .withIndex("by_hash_day", (q) => q.eq("hash", hash).eq("day", day))
      .unique();
    if (row && row.asks >= limit) return false;
    if (row) await ctx.db.patch(row._id, { asks: row.asks + 1 });
    else await ctx.db.insert("builtAgentUsage", { hash, day, asks: 1 });
    return true;
  },
});
