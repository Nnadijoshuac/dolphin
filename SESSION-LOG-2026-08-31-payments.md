# Session log — 2026-08-31: real payment for paid agent hires

Every command in this log was run live against the real deployment, the real
BSC mainnet, and the real third-party agent endpoints. Nothing here is quoted
from memory or from a doc without a matching observation beside it.

---

## TASK 0 — INVESTIGATION

### 0.1 The headline finding, stated before anything else

**No agent in Dolphin's catalog uses x402. Not one.** The brief's premise —
"wire real payment through Altana's x402 support" — describes a rail that has
no seller here. Every paid agent in this catalog sells over **ERC-8183**, a
completely different mechanism: an on-chain job-escrow kernel denominated in
`$U`, negotiated over A2A.

This was measured, not inferred. See 0.4.

### 0.2 What the catalog's prices actually are today

`npx convex run agents:listAgents '{}'` against the live deployment, 17 agents:

```
AGENTS IN CATALOG: 17
DISTINCT priceModel: { "live | {\"amount\":\"0\",\"token\":\"BNB\",\"type\":\"flat\"}": 17 }
x402Supported:      { "live | true": 13, "live | false": 4 }
```

**All 17 agents carry an identical price, and it is not a publisher's price.**
It is `DEFAULT_READ_ONLY_PRICE_MODEL` from `convex/lib/agentCatalog.ts:147`,
assigned at exactly one call site (`agentCatalog.ts:444`) to every agent,
editorial and discovered alike. Its own comment says why: ERC-8004 carries no
price field and 8004scan publishes none.

Two consequences worth being blunt about:

1. **`agentHires.ts`'s non-zero price gate has never once fired in production.**
   It cannot: nothing can currently produce a non-zero price to trip it. The
   refusal is real and correct, but it has been guarding a door nothing walks
   through.
2. **`x402Supported: true` on 13 of 17 agents is an indexer flag and nothing
   more.** It is not corroborated by a single endpoint. Session 5 already
   learned to stop trusting 8004scan's `overall_status` flag; this is the same
   lesson recurring on a different field.

### 0.3 Where the real prices actually live

The prices are in the agents' own free-text descriptions — prose, not
structured data, which is exactly why Dolphin's catalog cannot read them:

```
302257  Brain on BNB — Venus Health Factor Monitor
        "Hireable over ERC-8183 for 0.10 $U; the deliverable is written
         on-chain in full, not as a link."
302258  Brain on BNB — BSC Grid Planner        "Hireable over ERC-8183 for 0.10 $U"
304494  Brain on BNB — Portfolio Rebalance Pricer
292939  bnb-grid-trader-test.agent  "Sells computed grid plans ... over ERC-8183."
265375  BNB LP Range Rebalancer     "sells live position reports over A2A + ERC-8183"
```

### 0.4 Probing for x402 — nine endpoints, zero 402s

Every service endpoint in the catalog, fetched live:

```
brainonbnb  /.well-known/agent-card.json   200
brainonbnb  /a2a                           200
265375  bnb-lp card                        200
269223  chainhelix rebalancer card         200
269224  chainhelix gridtrader card         200
269228  chainhelix healthmon card          200
265876  bnb-yield /a2a                     405 Method Not Allowed
45381   heyanon aave mcp                   200
6441    sperax card                        404

HTTP 402 responses: 0 of 9
```

Note `brainonbnb`'s CORS preflight *does* advertise a `PAYMENT-SIGNATURE`
request header, so a payment-header flow is anticipated somewhere in that
stack — but the endpoint never answers 402, and the card says plainly what it
actually uses: *"Negotiation and delivery run over A2A; payment runs through
the ERC-8183 escrow kernel."*

### 0.5 The ERC-8183 rail, exercised live — three independent sellers

A2A `negotiate` returns a real, wallet-signed price quote. No funds move, so
this was safe to run. All three answered:

**Brain on BNB** (`https://agent.brainonbnb.com/a2a`, HTTP 200):
```json
{ "accepted": true,
  "provider": "0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963",
  "price": "100000000000000000", "price_display": "0.10 $U", "currency": "U",
  "service": "health_factor", "estimated_completion_seconds": 120,
  "chain_id": 56,
  "verifying_contract": "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
  "payment_token": "0xcE24439F2D9C6a2289F741120FE202248B666666",
  "instructions": "Create a job in 0xEa4DAa31... naming 0x73809F69... as
    provider, set the budget to 100000000000000000 (0.10 $U), fund it, then
    send skill:\"notify_funded\" with job_id ..." }
```

**chainhelix healthmon** and **bnb-lp** both returned the fuller signed-envelope
dialect — `request_hash`, `response_hash`, `negotiation_hash`, `provider_sig`
(a real 65-byte ECDSA signature), `quote_expires_at`, and:
```
price     "100000000000000000"
currency  "0xCe24439F2D9C6a2289f741120FE202248B666666"
chain_id  56
verifying_contract 0xea4daa3100a767e86fded867729ae7446476eba6
```

So the price, the token, the recipient and the escrow contract are all
**published as machine-readable data at negotiate time** — which is precisely
what this session's ground rule ("never hard-code anything meant to be
dynamic") requires. Nothing about a price needs to be assumed.

### 0.6 `$U` — what it actually is, verified three independent ways

The brief said `$U` is exported from the SDK as `U_TOKEN[56]`. **It is not.**
`grep -rn "U_TOKEN"` across the whole of `@altananetwork/sdk@0.8.0`'s `dist/`
returns nothing, and 0.8.0 is the newest published version (`npm view
@altananetwork/sdk versions` → `0.3.2 … 0.8.0`). The SDK *does* export the
address, under a different name:

```js
// dist/erc8183.js
export const ERC8183_ADDRESSES = {
  56: { commerce:     "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
        router:       "0x51895229E12F9876011789B04f8698af06cCD6DA",
        policy:       "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
        registry:     "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666" },
  97: { ... paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" } };
```

Per AGENTS.md §9, no address goes anywhere near this codebase without
independent verification. Three sources agree, and a direct chain read confirms
what the address is:

| Source | `$U` address |
|---|---|
| SDK `ERC8183_ADDRESSES[56].paymentToken` | `0xcE24439F…B666666` |
| brainonbnb live quote `payment_token` | `0xcE24439F…B666666` |
| chainhelix + bnb-lp live quote `currency` | `0xCe24439F…B666666` |

Direct `eth_call` against BSC mainnet (`bsc-dataseed.bnbchain.org`):
```
$U name          United Stables
$U symbol        U
$U decimals      18
$U totalSupply   971798607908467150000000000   (~971.8M)
$U token         2007 bytes of code
ERC-8183 kernel  130 bytes of code (a proxy)
kernel jobCounter                     56673
kernel $U balance (escrow held now)   302.377728767123359891 $U
```

**56,673 jobs and 302 $U sitting in escrow right now.** This is a live economy
with real usage, not a testnet demo. That materially changes how worthwhile
building against it is.

### 0.7 Can a user realistically get `$U`? Yes — measured

The honest UX question the brief asked for. `$U` is not an exotic token with no
market; it has deep DEX liquidity on the chain Dolphin already targets:

```
PancakeSwap V3  U/USDT  fee 100 (0.01%)   0xA0909f81…094E4   10,933,907 $U
PancakeSwap V3  U/WBNB  fee 500 (0.05%)   0x882e23dbA…1522    2,023,421 $U
PancakeSwap V2  U/WBNB                    0x108752b2A…221a       80,914 $U
PancakeSwap V2  U/USDT                    0xdaC52D69…0Fa11         0.013 $U (dead)
PancakeSwap V3  U/WBNB fee 100/2500/10000                    dust, effectively empty
```

So the real answer to "how does a user fund a Dolphin Wallet for this" is:
**swap USDT or BNB for $U on PancakeSwap V3, then send it to the wallet
address.** That is a true statement backed by a pool that can absorb it, not a
hopeful one.

### 0.8 The CORS wall is real — and it is on a different call than the brief expected

The brief anticipated a CORS problem on POSTing an `X-PAYMENT` header. There is
no `X-PAYMENT` header on this rail. But there **is** a CORS wall, and it sits on
the A2A `negotiate` / `notify_funded` calls. Measured, per-origin:

```
                      preflight(OPTIONS)                 actual POST
brainonbnb            200  ACAO=*  ACAH=Content-Type,PAYMENT-SIGNATURE   200 ACAO=*
chainhelix healthmon  405  ACAO=null                                     200 ACAO=null
bnb-lp                405  ACAO=null                                     200 ACAO=null
```

A JSON-RPC `negotiate` is `content-type: application/json`, which is **not** a
CORS-simple content type, so it always triggers a preflight. Two of the three
sellers answer that preflight with 405 and no `Access-Control-Allow-Origin`:
**a browser cannot call them at all.** A server can, and does — the same POST
returns 200 from Node.

This is the empirical justification for the relay in Task 1, replacing the
brief's doc-quoted one. It is a stronger justification, because it was
observed here rather than read.

### 0.9 Does the one-time Permit2 provisioning apply? No.

`approveTokenForPermit2` and `approveSignatureChecker` are prerequisites of the
**x402/Permit2** rail specifically — they exist so a facilitator can pull tokens
against a session signature validated via ERC-1271. ERC-8183 does not use
Permit2 at all: `buildHireCalls` batches its own `approve($U → kernel)` call
into the same atomic intent as `createJob`/`setBudget`/`fund`.

```js
// dist/erc8183.d.ts — "The buyer's five calls as one atomic batch: createJob,
// registerJob (binds the policy), setBudget, approve $U to the kernel, fund."
```

So there is **no separate one-time approval step to walk a user through** on
this rail, and building one would be inventing a hoop. Task 2.3 is answered by
not existing.

### 0.10 Can Convex play a role? Yes — but only as a relay, never as a signer

Unchanged from Session 6 and restated because it is load-bearing: **Convex
cannot sign.** The passkey lives in the browser's secure element; no key
material has ever left it and none will. A Convex row can report what already
happened; it can never cause it.

What is new is that Convex now has a genuine, necessary job on this rail — the
0.8 CORS wall means the A2A calls *must* be made server-side. That is a relay,
not a signer: it forwards a request and returns a response, and never touches a
key. The payment itself (the on-chain funded job) stays entirely client-side,
signed by the passkey, exactly as session grants do.

### 0.11 The SDK's real x402 surface, for the record

Checked so the finding is falsifiable rather than assumed. `@altananetwork/sdk`
0.8.0 does ship x402 — as client methods and standalone exports both:

```ts
client.fetchWithX402(opts: { session, url, init?, preferRail?, chainId? })
signX402Payment(session, req: X402Requirement, opts?) -> { header, payload }
selectX402Requirement(options, opts?)   // preferRail defaults to "permit2"
```

The API exists and works as documented. It has no counterparty in this catalog,
which is the only reason it is not what this session builds.

### 0.12 The provider address is already in Dolphin's data

No new address needs writing anywhere. The ERC-8183 `provider` for a job is the
agent's own registered wallet, which `listAgents` already returns:

```
302257 / 302258 / 304494  agentWallet 0x73809f69916fcf7ddc5bb1315fbdf96a569a5963
```

— byte-for-byte the `provider` the live brainonbnb quote named. So the buyer's
counterparty is read from the agent record at hire time, dynamically, and
cross-checked against what the seller itself says in its quote.

---

## TASK 0 — DECISIONS PUT TO THE PROJECT OWNER

Both were asked explicitly rather than assumed, per the brief.

1. **Which rail?** → **ERC-8183.** Follow the evidence; x402 has no seller here
   and could not be verified against anything real.
2. **Funding a live payment?** → **Build now, fund later.** Everything short of
   the funded on-chain transaction is built and verified this session; the
   funded round-trip is logged as the one explicitly unverified piece, the same
   honest gap Session 6 left for on-chain session enforcement. **No real funds
   were spent in this session.**
