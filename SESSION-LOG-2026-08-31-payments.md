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

---

## TASKS 1-4 — WHAT WAS BUILT, AND WHAT WAS OBSERVED

### The architecture, and how the brief's shape changed under the evidence

The brief anticipated "sign client-side, relay server-side" because x402's
`X-PAYMENT` header hits a CORS wall. There is no `X-PAYMENT` header on this
rail. But the split turned out to be right anyway, for a reason measured here
rather than read from docs — the wall is on the A2A `negotiate` call:

| step | where it runs | why |
|---|---|---|
| Negotiate a price | **Convex** | 2 of 3 sellers 405 a browser preflight with no ACAO |
| Fund the escrow | **browser** | only the browser holds the passkey; Convex cannot sign |
| Verify the payment | **Convex** | reads the kernel on BSC itself, believes no client |
| Notify the seller | **Convex** | same CORS wall as negotiate |

`convex/agentPayments.ts` is therefore two things that its own header comment
keeps distinguishable: a **relay** (forwards a request, holds no key, can move
no token) and a **witness** (reads the chain and refuses if anything
disagrees). It is never a signer.

### Every guardrail, exercised live against the deployment

Not described — run. Each is a real command against the real backend:

```
A  chainhelix 269228 signed-envelope quote        0.10 U, provider 0x91F4...8Da2   OK
B  bnb-lp 265375 signed-envelope quote            0.10 U, provider 0x20f1...d64b   OK
C  roboclaw 12046, no A2A endpoint                REFUSED, names the reason
D  tokenId 999999999, not in catalog              REFUSED
E  record a job that does not exist               REFUSED (client 0x000...000)
F  claim a REAL STRANGER'S job (job 1) as ours    REFUSED - job 1's client is
                                                  0x2BBA...6878, not our wallet
G  paid hire with a made-up paymentJobId          REFUSED, no verified record
H  paid hire with no payment at all               REFUSED, names what to do
```

**F is the one that matters most.** Job 1 is a real, funded job on the real
kernel belonging to a real stranger. A client pointing at it to fake a paid
hire is rejected because the on-chain `client` address is not the wallet
claiming it. That is the difference between recording evidence and accepting an
assertion.

### A real bug, found by running it rather than reading it

The first pass rejected chainhelix outright:

```
Uncaught Error: The agent did not name a payment token address
(got "0xCe24439F2D9C6a2289f741120FE202248B666666").
```

That address *is* `$U`. chainhelix returns it with different EIP-55 checksum
casing than bnb-lp does (`0xCe...9f...` vs `0xcE...9F...`); both name the
identical 20 bytes. viem's `isAddress` is checksum-strict by default, so a
real, live, correctly-behaving seller was permanently unpayable over
capitalisation.

Fixed by parsing addresses case-insensitively and normalizing with `getAddress`
before any comparison. This is not a weakening of the payee check — it happens
before it, and every comparison downstream is still between two canonical
addresses. Three more sellers started quoting the moment it landed.

### The decisive scope problem, and what was done about it

**The payment step, gated on a non-zero `priceModel` as the brief specified,
would never have rendered for anybody.** Every catalog price is zero, from one
constant, because nobody publishes a price field (§0.2). The feature would have
been dead code shipped as a deliverable.

Meanwhile agents in that same catalog demonstrably *do* charge. On this rail a
price is not a field you read; it is something you find out by **asking** — and
asking is free, signs nothing, and moves nothing.

So the step is offered when the catalog carries a real price **or** when the
agent publishes an endpoint that can be asked. In the second case Dolphin
asserts nothing about what the agent charges: the UI says "ask it" and the
agent answers for itself. A null catalog price renders as *"no published
price"*, never as *"free"*. The hire gate is untouched — a zero catalog price
still records a free hire, and a paid job is a separate purchase of real work.

### DELIVERABLE 3 — what fraction of the catalog this actually made payable

Measured against the live catalog, not estimated.

**The payment step is offered on 9 of 17 agents.** The other 8 are excluded
with a real reason each, and the reasons are worth reading:

```
5 publish no A2A endpoint at all      12046, 43129, 45381, 45422, 45650
                                      (the HeyAnon family + roboclaw)
3 publish an A2A endpoint still carrying an unsubstituted {agentId} template
                                      292058, 292939, 303727 (termix.live)
```

That template finding is new and actionable: three real agents are unreachable
because 8004scan serves their endpoint with the placeholder unresolved. Dolphin
treats an un-substituted template as no endpoint rather than fetching it
literally.

**Of the 9 offered, 7 returned a real, live, wallet-signed quote:**

```
302257  Brain on BNB - Venus Health Factor Monitor   0.10 $U  instructions
302258  Brain on BNB - BSC Grid Planner              0.10 $U  instructions
304494  Brain on BNB - Portfolio Rebalance Pricer    0.10 $U  instructions
265375  BNB LP Range Rebalancer                      0.10 $U  signed-envelope
269223  Portfolio Rebalancer                         0.10 $U  signed-envelope
269224  Grid Trader                                  0.10 $U  signed-envelope
269228  Health Factor Monitor                        0.10 $U  signed-envelope
```

Those seven span all four graded categories, and every payee was independently
cross-checked against the agent's registered ERC-8004 wallet.

The remaining 2 of the 9 answered but could not be honoured, and are reported
rather than smoothed over:

```
265876  BNB Yield Optimizer   answered with no price field      refused
6441    DeFi Trading Agent    answered with a non-object body   refused
```

Both refusals are the gate working: a price Dolphin cannot read exactly is a
price no Pay button may sit behind.

**So: 7 of 17 catalog agents (41%) are payable today, all at 0.10 $U, across
all four graded categories.** Before this session the number was zero and the
backend refused every one of them by design.

### One more thing found by running it

Brain on BNB **declines** a task that does not match one of its published
services (`accepted: false`), and quotes 0.10 $U the moment the task does. So a
decline was a dead end. `requestQuote` now asks the seller's own `list` skill
what it sells and puts that in the error. Verified live:

```
The agent declined to quote for this task. It answered `accepted: false`.
This agent does sell: "Venus health factor & liquidation distance" (0.10 $U);
"Grid trading plan, costed against the real pool" (0.10 $U); "Venus yield
ranking, and whether moving pays for itself" (0.10 $U); "Portfolio rebalance,
priced against the pools that would execute it" (0.10 $U); "Which PancakeSwap
fee tier is actually paying its liquidity providers" (0.10 $U).
Rewrite the task to ask for one of those.
```

The menu is the seller's, not Dolphin's — no guess was added.

### Gates

| | Mobile (root) | Website (`web/`) |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| lint | 0 errors, 2 pre-existing warnings | 1 pre-existing error (below) |
| build | `expo export` OK, web **and** android | `next build` OK, `/wallet` still static |
| Convex | pushes; `agentJobs` + 3 indexes added | same backend |

The website's lint error is in `web/src/app/search/page.tsx`
(`react-hooks/set-state-in-effect`), introduced by commit `e591a04` **before**
this session's first commit, in a screen file AGENTS.md §11 reserves. Reported
rather than fixed.

### The native bundle did not regress

Session 6's hard-won lesson re-checked with a real `expo export`, because a
barrel import is exactly how the SDK crept in last time:

```
android   createPasskeyWallet 0   relay.altana.network 0
          hireErc8183Agent    0   erc8183Addresses     0
web       createPasskeyWallet 8   relay.altana.network 2
          hireErc8183Agent    4   erc8183Addresses    10
```

Zero SDK symbols in the Android bundle. `erc8183-policy.ts` stays free of SDK
imports for exactly this reason, and each provider resolves `erc8183Addresses`
itself, asserting the chain ids agree.

## WHAT IS NOT PROVEN — read this before claiming payment works

**No job was ever funded.** The project owner was asked explicitly, with the
cost stated, and chose "build now, fund later". So the chain of evidence runs:

```
negotiate a real price          OBSERVED, 7 sellers
verify the payee on-chain       OBSERVED
read the quoted token's balance BUILT - SDK balances({tokens}); not run against
                                a funded wallet
sign and fund the escrow        NOT RUN - needs real $U on BSC mainnet
witness the job on-chain        OBSERVED in the negative (every refusal path),
                                never in the positive
```

`recordJobPayment` has never returned successfully, because no job of ours
exists for it to return. Its refusals are all verified; its acceptance is not.
That is the single most valuable evidence this feature could gain, and it costs
0.10 $U plus gas.

**The rendered payment UI was not driven in a browser this session.** The hire
card is client-rendered, so a server-side fetch shows none of it, and Playwright
is not installed in this repo (adding it is a dependency change AGENTS.md §3
governs, and this session did not make one unilaterally).
`scripts/verify-web-payment.mjs` is written and ready to produce that evidence
the moment `npm i -D playwright` is acceptable. What IS verified is the logic
that decides what renders: `canNegotiate` was run over the real catalog and
produced the 9-of-17 table above.
