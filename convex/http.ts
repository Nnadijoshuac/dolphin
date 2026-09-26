/**
 * PUBLIC HTTP API, v1 - the Set and Earn tracking endpoints.
 *
 * Read-only JSON, no auth, CORS open: a quest checker has to be able to call
 * this from anywhere. Served at https://<deployment>.convex.site/api/v1/* and
 * proxied at https://www.dolphinamp.xyz/api/v1/* (web/next.config.ts).
 *
 *   GET /api/v1/contracts            addresses, events and topic0 hashes
 *   GET /api/v1/hires?wallet=0x...   a wallet's hires (connected or Altana wallet)
 *   GET /api/v1/agents?owner=0x...   agents that wallet owns, and which are listed
 *   GET /api/v1/quest?wallet=0x...   both quest conditions, with evidence
 *
 * The reads themselves live in convex/tracking.ts.
 */

import { httpRouter } from "convex/server";
import { parseAbiItem, toEventSelector } from "viem";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      // Short: hires land at human pace, and a checker should see one soon.
      "cache-control": "public, max-age=30",
    },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

/*
 * EVENTS, with how each signature was established. Verified 2026-09-25.
 *
 * "receipt" means the topic0 below was matched against logs in the receipts of
 * Dolphin's own mainnet hires (txs 0x6dd4814d... job 56790, 0xae97e50f... job
 * 56783). "spec" means the signature is the ERC's own text and has not yet been
 * observed from the deployed contract - Dolphin's jobs have not reached that
 * state and the public BSC RPCs refuse eth_getLogs. That distinction matters:
 * the deployed kernel's JobFunded has THREE indexed topics (jobId, client,
 * provider), not the two the ERC-8183 text declares, so a checker built from
 * the spec alone would never match a deposit.
 */
const EVENTS = [
  {
    represents: "hire",
    contract: "erc8183Kernel",
    signature: "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
    verifiedBy: "receipt",
  },
  {
    represents: "deposit",
    contract: "erc8183Kernel",
    signature: "event JobFunded(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount)",
    verifiedBy: "receipt",
  },
  {
    represents: "budget set (precedes deposit)",
    contract: "erc8183Kernel",
    signature: "event BudgetSet(uint256 indexed jobId, uint256 amount)",
    verifiedBy: "receipt",
  },
  {
    represents: "policy bound to job",
    contract: "erc8183Router",
    signature: "event JobRegistered(uint256 indexed jobId, address indexed policy, address indexed client)",
    verifiedBy: "receipt",
  },
  {
    represents: "job completion",
    contract: "erc8183Kernel",
    signature: "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
    verifiedBy: "spec",
    alsoCheckable: "erc8183Kernel.getJob(jobId).status == 3 (COMPLETED)",
  },
  {
    represents: "payment to agent",
    contract: "erc8183Kernel",
    signature: "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
    verifiedBy: "spec",
  },
  {
    represents: "refund",
    contract: "erc8183Kernel",
    signature: "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
    verifiedBy: "spec",
  },
  {
    represents: "rating",
    contract: "erc8004ReputationRegistry",
    signature: "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
    verifiedBy: "spec",
    alsoCheckable: "erc8004ReputationRegistry.readFeedback(agentId, clientAddress, feedbackIndex)",
  },
  {
    represents: "agent registration",
    contract: "erc8004IdentityRegistry",
    signature: "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
    verifiedBy: "spec",
  },
].map((event) => ({ ...event, topic0: toEventSelector(parseAbiItem(event.signature) as never) }));

const CONTRACTS = {
  chainId: 56,
  network: "BNB Smart Chain mainnet",
  contracts: {
    erc8004IdentityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    erc8004ReputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    erc8183Kernel: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
    erc8183Router: "0x51895229E12F9876011789B04f8698af06cCD6DA",
    erc8183Policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
    paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666",
  },
  events: EVENTS,
  identity: {
    agentKey: "<chainId>:<lowercase identity registry address>:<tokenId>, identical to 8004scan's agent_id",
    agentId: "the ERC-8004 identity registry tokenId",
    owner: "ownerOf(tokenId) on the identity registry",
    hirer: "the wallet the user connected and signed in with (SIWE)",
    payer: "the kernel's job.client - the user's Altana smart account, which funds the escrow",
  },
  endpoints: {
    hires: "/api/v1/hires?wallet=0x...",
    agentsByOwner: "/api/v1/agents?owner=0x...",
    quest: "/api/v1/quest?wallet=0x...",
  },
};

function wallet(request: Request, name: string): string | null {
  const value = new URL(request.url).searchParams.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

http.route({
  path: "/api/v1/contracts",
  method: "GET",
  handler: httpAction(async () => json(CONTRACTS)),
});

http.route({
  path: "/api/v1/hires",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const address = wallet(request, "wallet");
    if (!address) return badRequest("Pass ?wallet=0x...");
    const result = await ctx.runQuery(internal.tracking.hires, { wallet: address });
    return result ? json(result) : badRequest(`"${address}" is not an EVM address.`);
  }),
});

http.route({
  path: "/api/v1/agents",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const address = wallet(request, "owner");
    if (!address) return badRequest("Pass ?owner=0x...");
    const result = await ctx.runQuery(internal.tracking.agentsByOwner, { owner: address });
    return result ? json(result) : badRequest(`"${address}" is not an EVM address.`);
  }),
});

http.route({
  path: "/api/v1/quest",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const address = wallet(request, "wallet");
    if (!address) return badRequest("Pass ?wallet=0x...");
    const result = await ctx.runQuery(internal.tracking.quest, { wallet: address });
    return result ? json(result) : badRequest(`"${address}" is not an EVM address.`);
  }),
});

// CORS preflight for every route.
for (const path of ["/api/v1/contracts", "/api/v1/hires", "/api/v1/agents", "/api/v1/quest"]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
  });
}

export default http;
