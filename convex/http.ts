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
import {
  HASH_PATTERN,
  agentCard,
  handleA2A,
  handleMcp,
  isPaidCall,
  listingProtocol,
  payTo,
  registrationFile,
  type RpcRequest,
} from "./builtAgentServer";
import { apiBase } from "./builtAgents";
import { PaymentRejected, decodePayment, formatU, paymentChallenge, paymentResponseHeader, textToBase64, type DecodedPayment } from "./lib/x402";
import { checkPayment, settlePayment } from "./x402";

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

/* ---------------------------------------------------------------------------
 * BUILT AGENTS (2026-09-26) - see convex/builtAgentServer.ts
 *
 *   GET  /api/v1/built/<hash>/registration.json   ERC-8004 registration file
 *   GET  /api/v1/built/<hash>/icon                the agent's icon
 *   GET  /api/v1/built/<hash>/agent-card.json     A2A agent card (A2A listings)
 *   POST /api/v1/built/<hash>/mcp                 MCP: its tools + `ask` (MCP listings)
 *   POST /api/v1/built/<hash>/a2a                 A2A: message/send (A2A listings)
 *
 * PAID CALLS (2026-10-02): a listing with a price answers its work call
 * (tools/call, message/send) with HTTP 402 and x402 terms until it carries a
 * PAYMENT-SIGNATURE / X-PAYMENT header. Then: check (lib/x402.ts), simulate
 * against U and reserve the nonce (x402.ts), do the work, and settle only if
 * the work succeeded - a failed call is never charged, and a call whose
 * payment cannot be settled does not get its result.
 * ------------------------------------------------------------------------ */

const BUILT_PREFIX = "/api/v1/built/";
const BUILT_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, payment-signature, x-payment",
  "access-control-expose-headers": "payment-required, x-payment-requirements, payment-response, x-payment-response",
};
/** An MCP request is a few hundred bytes. Anything near this is not one. */
const MAX_MCP_BODY_BYTES = 64 * 1024;

function builtPath(request: Request): { hash: string; resource: string } | null {
  const rest = new URL(request.url).pathname.slice(BUILT_PREFIX.length);
  const [hash, resource, ...extra] = rest.split("/");
  if (!hash || !resource || extra.length > 0 || !HASH_PATTERN.test(hash)) return null;
  return { hash, resource };
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "No such agent." }), {
    status: 404,
    headers: { ...BUILT_CORS, "content-type": "application/json; charset=utf-8" },
  });
}

http.route({
  pathPrefix: BUILT_PREFIX,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const path = builtPath(request);
    if (!path) return notFound();
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash: path.hash });
    if (!listing) return notFound();

    if (path.resource === "registration.json") {
      return new Response(JSON.stringify(registrationFile(listing), null, 2), {
        headers: {
          ...BUILT_CORS,
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    }
    if (path.resource === "agent-card.json") {
      if (listingProtocol(listing) !== "a2a" || listing.status === "unpublished" || listing.purpose === "private") return notFound();
      return new Response(JSON.stringify(agentCard(listing), null, 2), {
        headers: { ...BUILT_CORS, "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
      });
    }
    if (path.resource === "icon") {
      const blob = await ctx.storage.get(listing.iconStorageId);
      if (!blob) return notFound();
      return new Response(blob, {
        headers: {
          ...BUILT_CORS,
          "content-type": listing.iconContentType,
          /* Only ever an image: never sniffed into anything else, never able to run. */
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "cache-control": "public, max-age=86400",
        },
      });
    }
    return notFound();
  }),
});

http.route({
  pathPrefix: BUILT_PREFIX,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const path = builtPath(request);
    if (!path || (path.resource !== "mcp" && path.resource !== "a2a")) return notFound();
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash: path.hash });
    // A "just for me" agent has no public door (convex/builtAgentServer.ts).
    if (!listing || listing.status === "unpublished" || listing.purpose === "private") return notFound();
    // Each listing answers on the one door it was published with.
    if (path.resource !== listingProtocol(listing)) return notFound();

    const text = await request.text();
    const rpc = (body: unknown, status = 200) =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { ...BUILT_CORS, "content-type": "application/json; charset=utf-8" },
      });
    if (text.length > MAX_MCP_BODY_BYTES) {
      return rpc({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, 413);
    }
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return rpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400);
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return rpc({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send one JSON-RPC request at a time." } }, 400);
    }
    const rpcMessage = message as RpcRequest;
    const handle = () => (path.resource === "a2a" ? handleA2A(ctx, listing, rpcMessage) : handleMcp(ctx, listing, rpcMessage));
    if (!isPaidCall(listing, rpcMessage)) {
      const response = await handle();
      return response === null ? rpc(null, 202) : rpc(response);
    }

    /* ───── a paid call ───── */
    const priceRaw = listing.priceRaw as string;
    const resourceUrl = `${apiBase()}/api/v1/built/${listing.hash}/${path.resource}`;
    const toolName = typeof rpcMessage.params?.name === "string" ? rpcMessage.params.name.slice(0, 60) : "";
    const resource = path.resource === "a2a" ? "a2a" : `mcp:${toolName}`;
    const challenge = (error?: string) => {
      const body = paymentChallenge({
        priceRaw,
        payTo: payTo(listing),
        resourceUrl,
        description: `${listing.name} · ${formatU(priceRaw)} U per call`,
        error,
      });
      const encoded = textToBase64(JSON.stringify(body));
      return new Response(JSON.stringify(body), {
        status: 402,
        headers: {
          ...BUILT_CORS,
          "content-type": "application/json; charset=utf-8",
          "payment-required": encoded,
          "x-payment-requirements": encoded,
        },
      });
    };

    const header = request.headers.get("payment-signature") ?? request.headers.get("x-payment");
    if (!header) return challenge();
    let payment: DecodedPayment;
    try {
      payment = decodePayment(header, { priceRaw, payTo: payTo(listing), nowSeconds: Math.floor(Date.now() / 1000) });
    } catch (cause) {
      return challenge(cause instanceof PaymentRejected ? cause.message : "The payment could not be read.");
    }
    const refused = await checkPayment(ctx, payment);
    if (refused) return challenge(refused);
    const reservation = await ctx.runMutation(internal.x402.reserve, {
      hash: listing.hash,
      payer: payment.authorization.from,
      nonce: payment.authorization.nonce,
      payTo: payment.authorization.to,
      valueRaw: payment.authorization.value.toString(),
      resource,
    });
    if (!reservation) return challenge("That payment was already used.");

    let response: Record<string, unknown> | null;
    try {
      response = await handle();
    } catch {
      response = null;
    }
    const result = response?.result as { isError?: unknown } | undefined;
    const failed = !response || "error" in response || result?.isError === true;
    if (failed) {
      // Not charged: the authorization is simply never submitted.
      await ctx.runMutation(internal.x402.finish, { id: reservation, status: "released", txHash: null, detail: "The call failed." });
      return response ? rpc(response) : rpc({ jsonrpc: "2.0", id: rpcMessage.id ?? null, error: { code: -32603, message: "The agent failed." } }, 500);
    }
    try {
      const transaction = await settlePayment(ctx, payment);
      await ctx.runMutation(internal.x402.finish, { id: reservation, status: "settled", txHash: transaction, detail: null });
      const receipt = paymentResponseHeader({ transaction, payer: payment.authorization.from });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...BUILT_CORS, "content-type": "application/json; charset=utf-8", "payment-response": receipt, "x-payment-response": receipt },
      });
    } catch (cause) {
      await ctx.runMutation(internal.x402.finish, {
        id: reservation,
        status: "failed",
        txHash: null,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return challenge("The payment could not be settled, so the result was withheld. Nothing was charged.");
    }
  }),
});

http.route({
  pathPrefix: BUILT_PREFIX,
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: BUILT_CORS })),
});

export default http;
