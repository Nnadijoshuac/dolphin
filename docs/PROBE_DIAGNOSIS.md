# ⚠️ CORRECTION — 2026-09-01T20:40Z

**The AiKi verdict in the original diagnosis below is WRONG and is retracted.**

The original section is preserved unedited underneath this one. Nothing has been
deleted; both observations are recorded with their timestamps so the change is
inspectable.

## What I got wrong

I concluded that `useaiki.xyz` **does not exist** and that our probe was
therefore correct to mark those four agents `unreachable`. That conclusion was
based on a DNS failure that was **transient**. The domain resolves now, all four
agent endpoints return **HTTP 200 with valid JSON**, and the agents are live.

### The two observations, side by side

| | **2026-09-01 ~19:5xZ (original)** | **2026-09-01T20:40Z (re-test)** |
|---|---|---|
| local resolver 10.2.0.1 | `Non-existent domain` | **`64.29.17.1`, `216.198.79.1`** |
| Google `8.8.8.8` | `Non-existent domain` | **`216.198.79.1`, `64.29.17.65`** |
| Cloudflare `1.1.1.1` | `Non-existent domain` | **`216.198.79.1`, `216.198.79.65`** |
| Cloudflare DoH | `{"Status":3, Authority: SOA ns0.centralnic.net}` | **`{"Status":0, Answer:[64.29.17.65, 64.29.17.1]}`** |
| Google DoH | *(not run)* | **`{"Status":0, Answer:[64.29.17.1, 216.198.79.65]}`** |
| `agentcensus.xyz` | `Non-existent domain` | **`{"Status":0, Answer:[204.168.140.2]}`** |

**Both `.xyz` domains flipped from NXDOMAIN to resolving within roughly 45
minutes, with no action by anyone here.** The earlier failure was transient and
almost certainly at the `.xyz` registry itself — which is exactly what the SOA
from `ns0.centralnic.net` in the original DoH response indicates.

### The methodological error, stated plainly

I treated "three resolvers plus the authoritative TLD SOA all agree" as
conclusive. **It is not.** Every public recursive resolver ultimately consults
the same `.xyz` registry nameservers, so they are not independent witnesses — a
registry-level fault produces an identical NXDOMAIN at all of them
simultaneously. Agreement across resolvers measures *consistency*, not
*correctness*. A negative DNS result should have been re-tested over time before
being written up as a property of the domain rather than of the moment.

The `useaiki.ai` "Coming Soon" page I reported was a **red herring** — an
unrelated domain that happens to share a stem. It says nothing about
`useaiki.xyz` and should not have been offered as corroboration.

## What is true now — measured 2026-09-01T20:41Z

### All four AiKi endpoints are LIVE and return HTTP 200 JSON

```
315943  https://www.useaiki.xyz/v1/reference/venus/agent/315943
        HTTP 200  application/json  252 bytes
        {"capability":"venus-health-factor-assessment","category":"health_factor",
         "input":{"account":"0x-prefixed EVM address",
                  "minimumHealthFactor":"optional decimal; default 1.25"},
         "output":"Evidence-backed Venus position health assessment.","readOnly":true}

315944  .../pancake/rebalancer/agent/315944
        HTTP 200  {"capability":"pancakeswap-v3-lp-rebalance-assessment",
                   "category":"rebalancing","input":{"tokenId":"PancakeSwap v3 position NFT integer"},
                   "output":"Verified range state and read-only rebalance recommendation.","readOnly":true}

315945  .../pancake/grid/agent/315945
        HTTP 200  {"capability":"pancakeswap-v3-grid-assessment","category":"grid_trading",
                   "input":{"pool":"v3 pool address","tickLower":"integer",
                            "tickUpper":"integer","spacing":"integer"},"readOnly":true}

315946  .../yield/agent/315946
        HTTP 200  {"capability":"venus-yield-route-assessment","category":"yield_optimisation",
                   "input":{"markets":"comma-separated Venus market addresses",
                            "rateOnly":"optional true; remains explicitly non-optimising"},"readOnly":true}
```

Suffix shapes, re-tested: `…/.well-known/agent-card.json` → **404 JSON**
(`{"message":"Route GET:… not found","error":"Not Found","statusCode":404}` — a
Fastify router, i.e. a real API answering); origin-root
`/.well-known/agent-card.json` and `/.well-known/agent.json` → **404 HTML**
(a Next.js app shell, 13,032 bytes); `…/a2a` → **404 JSON**.

### Their ERC-8004 registration files are live and valid

`raw_metadata.offchain_uri` for 315943 is
`https://www.useaiki.xyz/v1/reference/venus/manifest.json` — an HTTP URL, not a
`data:` URI. All four fetch **HTTP 200**:

```json
{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
 "name":"AiKi Venus Health Factor Guardian",
 "description":"First-party reference agent that reads Venus lending positions, derives a
   health factor, and reports evidence-backed liquidation risk…",
 "image":"https://www.useaiki.xyz/v1/reference/venus/icon.svg",
 "active":true,
 "services":[{"name":"venus-health-factor-assessment",
              "endpoint":"https://www.useaiki.xyz/v1/reference/venus/agent/315943",
              "version":"1.0.0"}],
 "registrations":[{"agentId":"315943",
                   "agentRegistry":"eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"}],
 "supportedTrust":[],
 "pricing":{"amount":"100000000000000000","asset":"U"}}
```

These are **well-formed ERC-8004 registration-v1 documents** that self-identify,
declare a service with an endpoint and version, and even publish a price
(0.10 $U — the same rail as the rest of the paid catalog).

Note 8004scan itself has **none** of this: `services: null`,
`supported_protocols: []`, `a2a_endpoint: null`, `is_endpoint_verified: false`
for all four. Our probe only sees these endpoints because it reads the agent's
own registration file — which is the design working as intended.

## The corrected diagnosis for AiKi: **(2), and the rejection is technically right**

Re-running `deepEvaluate` at 20:45Z, Convex's own probe — from its network, not
mine — reports:

```
[venus-health-factor-assessment] No A2A card resolved. Tried:
  https://www.useaiki.xyz/v1/reference/venus/agent/315943
    -> HTTP 200 but the body is not an A2A agent card;
  …/315943/.well-known/agent-card.json -> HTTP 404;
  https://www.useaiki.xyz/.well-known/agent-card.json -> HTTP 404;
  https://www.useaiki.xyz/.well-known/agent.json -> HTTP 404.
```

So the trace is:

1. `readEndpoints` ([registrationFile.ts:166-172](../convex/lib/registrationFile.ts#L166))
   reads the manifest's `services[]` and pushes
   `{protocol: "venus-health-factor-assessment", url: …}` — the service's own
   `name` becomes the protocol.
2. `probeLiveness` ([liveness.ts:235](../convex/lib/liveness.ts#L235)) dispatches
   on `protocol.toLowerCase().includes("mcp")` → false → **`probeA2A`**.
3. `probeA2A` gets **HTTP 200**, then `looksLikeAgentCard` rejects: the body has
   no `name`, no `skills`, no `protocolVersion`, no `version`, no `url`, no
   `capabilities`. `hasName` is false, so the predicate returns false.
4. Three suffix candidates 404. → `unreachable`.

**`looksLikeAgentCard` is not wrong to reject this body.** It is genuinely not an
A2A AgentCard — it has none of the A2A fields. Per the constraint in the
original brief, I am **not** proposing to weaken it: there is no spec basis for
accepting a `{capability, category, input, output, readOnly}` object as an A2A
card, because it is not one.

**The actual defect is upstream of that check.** Our probe has exactly two
branches — MCP or A2A — and treats *any* non-MCP protocol string as A2A. These
agents never claimed to speak A2A. Their manifest declares the service name
`venus-health-factor-assessment`, and our probe silently reinterprets that as
"A2A" and then judges it by A2A rules. **We are failing a live agent for not
speaking a protocol it never advertised.**

So the honest verdict is **(2) we request it, get a 2xx, and our validation
rejects it** — with the sharpening that the validation is correct for A2A and
the *dispatch* is what is wrong.

### Was the delisting of 315943 correct?

**No — and this is the part that cost us a listing.** It is `confirmed` at score
25 with a live, well-formed registration file and a live endpoint. It was
delisted after 4 consecutive failures of a probe that was asking the wrong
question. The original diagnosis called that delisting "the right outcome". That
was wrong.

## What still stands, unchanged

**The TermiX verdict is unaffected.** Re-checked at 20:45Z:

```
platform-backend.prod.termix.live .../agents/190411/card   HTTP 200
platform-backend.prod.termix.live .../agents/171927/card   HTTP 200
platform-backend.prod.termix.live .../agents/292058/card   HTTP 200
190411 right now: endpoint: null   status: "UNBOUND"   presence: "offline"   skills: []
```

Still an un-substituted `{agentId}` template, still `UNBOUND`/`offline`.
The proposed fix in §F below — treat a templated URL as
`no-endpoint-advertised` rather than `unreachable` — is unchanged and still
**NOT APPLIED**.

### TermiX's real marketplace is `agent.family`, and it serves no agent-card API

Confirmed it is theirs — the `/explorer-agents` page mentions TermiX 38 times
and links `app.termix.ai` (12×), `termix.ai` (4×), `docs.termix.ai` (3×). But:

```
https://www.agent.family/                             HTTP 200  text/html
https://www.agent.family/.well-known/agent-card.json  HTTP 404
https://www.agent.family/explorer-agents              HTTP 200  62,332 bytes
https://www.agent.family/onboarding                   HTTP 200  78,522 bytes

per-token, all HTTP 404 for 292058 / 190411 / 171927:
  /api/v1/a2a/agents/<id>/card   /api/agents/<id>   /api/v1/agents/<id>
  /agent/<id>                    /explorer-agents/<id>

https://app.termix.ai/api/v1/a2a/agents/<id>/card     HTTP 404
https://api.termix.ai/...                             HTTP 000 (does not resolve)
```

The SSR HTML embeds **no `/api/` paths at all** — it is a client-rendered app.
**No agent-card endpoint was found on agent.family or app.termix.ai for any of
the three tokens.** The only host that answers for these agents remains
`platform-backend.prod.termix.live`, and it answers with an unbound record.

## Re-run of `deepEvaluate` — 2026-09-01T20:45Z

Run over all 11 affected tokens (4 AiKi, agentcensus, agensea, misquote,
bedrock, and 3 TermiX). **The liveness gate was left fully enforced.**

```
considered 11, evaluated 11, published 0, delisted 0, stillPending 11, rejected 0
liveness: verified-live 0, unreachable 11, no-endpoint-advertised 0
crossCheck: fetched 11        <-- all 11 registration files now load
```

**Zero reached `verified-live`.** Nothing was published. Per-agent reasons:

| token | now | why |
|---|---|---|
| `315943` `315944` `315945` `315946` | unreachable | HTTP 200, body is not an A2A card — **our dispatch bug** |
| `270183` agentcensus | unreachable | `tunnel error: unsuccessful` from Convex's egress, even though the domain resolves for me now — Convex cannot reach it |
| `322885` agensea | unreachable | genuine 404 on all four candidates |
| `325413` bedrock | unreachable | 401 on the bedrock URL; its second endpoint is `https://github.com/agntcy/oasf`, a **spec page**, not a service |
| `292058` `190411` `171927` | unreachable | templated `{agentId}`, unchanged |

One thing worth noting: `crossCheck.fetched` is now **11 of 11**. The
registration files all load, which they did not reliably do earlier — further
evidence the earlier failures were network-transient rather than structural.

## Revised recommendation — still NOT APPLIED

Two separate defects, and they need different fixes:

**1. TermiX — templated URLs.** Unchanged from §F below: return `[]` from
`a2aCandidates` for a URL containing `{`, so it reports
`no-endpoint-advertised` and stops accruing `consecutiveProbeFailures`.
Recovers no agents; stops a wrong reason and unfair delisting pressure.

**2. AiKi — protocol dispatch.** `probeLiveness` should not treat an arbitrary
service name as A2A. The minimal shape, for discussion rather than immediate
application, is a third branch: when the declared protocol is neither `a2a`-like
nor `mcp`-like, require **HTTP 2xx plus a parseable JSON body** rather than an
A2A AgentCard — and record the protocol name in the detail string so the ledger
says what was actually verified.

That **is** a change to what counts as alive, which the original brief ruled out,
so it is a decision for you rather than something I will apply. Two things worth
weighing:

- In favour: it would recover **4 agents that are all `confirmed`** — 315943
  (score 25), 315944 (13), 315945 (24), 315946 (30) — every one live, priced at
  0.10 $U, with a valid ERC-8004 manifest. Because all four are `confirmed`,
  they would **auto-publish with no manual include needed**.
- Against: "200 + valid JSON" is a weaker liveness bar than "answers a
  protocol-appropriate handshake". It would also, on today's data, pass the 32
  TermiX records — so **fix 1 must land with or before fix 2**, or the TermiX
  false positives arrive through this door instead.

**Estimated recovery if both ship: 4 agents, of which 3 auto-publish**
(315943, 315945, 315946 are `confirmed`; 315944 is `confirmed` at score 13 —
all four are `confirmed`, so all four would auto-publish). That is a materially
different answer from the "zero — deliberately" in §F below, and it supersedes it
for AiKi. The §F figure remains correct for TermiX.

---

*Everything below this line is the original diagnosis as written at ~19:5xZ,
preserved unedited. Its AiKi conclusions are superseded by this section; its
TermiX conclusions still stand.*

---

# Probe Diagnosis — AiKi and TermiX (ORIGINAL, ~19:5xZ — AiKi section superseded above)

Diagnosis only. **No probe code was changed.** No candidate status was altered
by this investigation.

Measured 2026-09-01 against the live hosts, with the exact URLs read from
`agentCandidates.livenessUrl` — none were guessed.

---

## HEADLINE — both premises turned out to be wrong, in opposite directions

| host | premise given | what was measured |
|---|---|---|
| **useaiki.xyz** | "CONFIRMED LIVE by the project owner" | **The domain does not exist.** NXDOMAIN from three independent resolvers plus the authoritative `.xyz` TLD nameserver. Our probe is correct. |
| **termix.live** | "may be our probe failing on a shape it doesn't try" | **It is our bug** — an un-substituted `{agentId}` template. But fixing it would flip 32 agents to `verified-live` that TermiX itself reports as `UNBOUND` / `offline`. **The fix as proposed would manufacture false positives.** |

And a third correction, to the proposed fix itself:

> **`a2aCandidates` already tries the bare advertised URL first, and already
> adds the origin-root well-known path.** Both halves of the suggested fix are
> in the code today — [liveness.ts:72](../convex/lib/liveness.ts#L72) and
> [:77](../convex/lib/liveness.ts#L77). There is nothing to add there.

---

## A. THE ADVERTISED ENDPOINTS, CURLED

### AiKi — all four fail at the network layer, not with an HTTP status

```
315943  https://www.useaiki.xyz/v1/reference/venus/agent/315943
        -> fetch failed (225ms)   no status, no content-type
315944  https://www.useaiki.xyz/v1/reference/pancake/rebalancer/agent/315944
        -> fetch failed (4ms)
315945  https://www.useaiki.xyz/v1/reference/pancake/grid/agent/315945
        -> fetch failed (4ms)
315946  https://www.useaiki.xyz/v1/reference/yield/agent/315946
        -> fetch failed (2ms)
```

The 4 ms and 2 ms timings are cached negative DNS — the first lookup took
225 ms, the rest were answered from cache. That is a resolution failure, so I
verified it rather than assuming:

```
local resolver (10.2.0.1)   www.useaiki.xyz  ->  Non-existent domain
Google 8.8.8.8              www.useaiki.xyz  ->  Non-existent domain
Cloudflare 1.1.1.1          useaiki.xyz      ->  Non-existent domain
Cloudflare DoH (JSON API)   www.useaiki.xyz  ->  {"Status":3, …
                                                  "Authority":[{"name":"xyz","type":6,
                                                  "data":"ns0.centralnic.net. …"}]}
```

`Status: 3` is NXDOMAIN, and the `Authority` section is an SOA from
`ns0.centralnic.net` — **the `.xyz` registry's own nameserver saying the domain
is not registered.** This is not a local DNS filter and not a transient outage.

**Where AiKi actually lives.** Neighbouring domains do resolve:

```
useaiki.com      OK -> 192.64.119.163
www.useaiki.com  OK -> 104.219.250.36, 2.59.170.19
useaiki.ai       OK -> 198.49.23.144, 198.49.23.145, 198.185.159.144, 198.185.159.145
app.useaiki.xyz  NXDOMAIN
api.useaiki.xyz  NXDOMAIN
```

So I checked whether the advertised paths simply moved to `.ai`:

```
https://www.useaiki.ai/v1/reference/venus/agent/315943   HTTP 200  text/html
https://www.useaiki.ai/.well-known/agent-card.json       HTTP 200  text/html
https://www.useaiki.ai/this-path-does-not-exist-12345    HTTP 200  text/html
```

Every path returns 200 HTML, including a nonsense one — a catch-all. The body:

```html
<!doctype html><html><head>
  <meta name="robots" content="noindex">
  <title>Coming Soon</title>
  <link href="https://fonts.googleapis.com/css?family=Montserrat" …>
  <script src="//assets.squarespace.com/@sqs/polyfiller/1.6/legacy.js"
```

**`useaiki.ai` is a Squarespace "Coming Soon" placeholder.** It is not serving
an agent platform at any path. `useaiki.com` returns 404 for both the agent path
and the well-known path.

### TermiX — read from the ledger, not guessed

All five advertise a **templated** URL:

```
292058  https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card
190411  https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
292939  https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card
266229  https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
171927  https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
```

**The literal URL, exactly as our probe requests it** (the `{`/`}` get
percent-encoded by `fetch`):

```
292058  -> HTTP 404  text/plain   redirected to …/agents/%7BagentId%7D/card
           body: "default backend - 404"
190411  -> HTTP 404  application/json
           body: {"error":{"code":"NOT_FOUND","message":"Agent not found"}}
292939  -> HTTP 404  text/plain   body: "default backend - 404"
```

**With `{agentId}` substituted for the token id:**

```
190411  -> HTTP 200  application/json   1228ms
  {"id":"cmrbrrxtb4ik0ud01ibjcom0o","agentTokenId":"190411",
   "name":"LiquidityCore.agent",
   "description":"Interchain DEX built on Cosmos with IBC-enabled asset routing…",
   "tags":["Smart Contract Development","DeFi Yield Optimizer","Node Operation"],
   "roles":[], "endpoint":null, "status":"UNBOUND", "presence":"offline",
   "skills":[], "card":{…}, "tokenUri":"https://termix-platform-prod.s3…json",
   "updatedAt":"2026-07-08T07:41:54.288Z"}

171927  -> HTTP 200  application/json   445ms   (same shape, endpoint:null)
292058  -> HTTP 404  "default backend - 404"    ← different host, still dead
292939  -> HTTP 404  "default backend - 404"
```

**Two TermiX hosts behave differently:**

| host | substituted result |
|---|---|
| `platform-backend.prod.termix.live` | **HTTP 200 with a real record** |
| `platform-backend-bnb8183.prod.termix.live` | **404 `default backend - 404`** — nginx default backend, nothing routed |

### The other four

```
325413  bedrock-agentcore…/invocations/.well-known/agent-card.json
        -> HTTP 401, empty body  (AWS Bedrock AgentCore, SigV4-auth-gated)
322885  https://agensea-health-factor.vercel.app/x402
        -> HTTP 404  {"error":{"code":"404","message":"The deployment could not be found on Vercel."}}
270183  https://agentcensus.xyz/erc8183
        -> fetch failed — agentcensus.xyz is also NXDOMAIN (Status 3)
        (agentcensus.com resolves; the .xyz does not)
323332  https://misquote.vercel.app/agent?id=grid
        -> HTTP 404, Next.js HTML error page
```

---

## B. THE SUFFIXED SHAPES

| target | `/.well-known/agent-card.json` | `/a2a` | origin-root `/.well-known/agent-card.json` |
|---|---|---|---|
| AiKi ×4 | fetch failed (NXDOMAIN) | fetch failed | fetch failed |
| termix `platform-backend` | **HTTP 401** `{"error":{"code":"UNAUTHORIZED"}}` | **HTTP 401** same | HTTP 404 `404 Not Found` |
| termix `bnb8183` | 404 `default backend - 404` | 404 same | 404 same |
| bedrock 325413 | 404 `<UnknownOperationException/>` | 404 same | 404 `Invalid api path` |
| agensea 322885 | 404 Vercel not-found | 404 same | 404 same |
| misquote 323332 | 404 Next.js HTML | 404 same | 404 same |

Also tested, because our probe tries it as a fourth candidate:

```
https://platform-backend.prod.termix.live/.well-known/agent.json         HTTP 404
https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json HTTP 404
```

**No suffix shape rescues any of these.** The only thing that changes a TermiX
result is substituting the template.

---

## C. WHAT OUR PROBE ACTUALLY TRIES

[convex/lib/liveness.ts:65-85](../convex/lib/liveness.ts#L65), verbatim:

```ts
/**
 * The A2A spec's well-known card location, plus the two placements publishers
 * actually use in the wild (card served directly at the advertised URL, and
 * card served under the advertised base rather than the origin).
 */
function a2aCandidates(url: string): string[] {
  const base = trimSlash(url);
  const candidates = [base];
  if (!/\.json($|\?)/i.test(base)) {
    candidates.push(`${base}/.well-known/agent-card.json`);
    try {
      const origin = new URL(base).origin;
      candidates.push(`${origin}/.well-known/agent-card.json`);
      // The pre-0.3 name, still served by some deployed agents.
      candidates.push(`${origin}/.well-known/agent.json`);
    } catch {
      // Not a parseable URL; the bare base is the only candidate.
    }
  }
  return [...new Set(candidates)];
}
```

[:87-99](../convex/lib/liveness.ts#L87), verbatim:

```ts
/** An A2A agent card is recognisable: it names itself and lists skills or a version. */
function looksLikeAgentCard(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  const hasName = typeof record.name === "string" && record.name.trim().length > 0;
  const hasShape =
    Array.isArray(record.skills) ||
    typeof record.protocolVersion === "string" ||
    typeof record.version === "string" ||
    typeof record.url === "string" ||
    typeof record.capabilities === "object";
  return hasName && hasShape;
}
```

### The literal strings we request

**AiKi, token 315943** — 4 candidates, in this order:

```
1  https://www.useaiki.xyz/v1/reference/venus/agent/315943
2  https://www.useaiki.xyz/v1/reference/venus/agent/315943/.well-known/agent-card.json
3  https://www.useaiki.xyz/.well-known/agent-card.json
4  https://www.useaiki.xyz/.well-known/agent.json
```

All four → DNS failure. Probe result: `unreachable`. **Correct.**

**TermiX, token 190411** — 4 candidates, in this order:

```
1  https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
2  https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json
3  https://platform-backend.prod.termix.live/.well-known/agent-card.json
4  https://platform-backend.prod.termix.live/.well-known/agent.json
```

Measured: `404`, `401`, `404`, `404`. Probe result: `unreachable`.
**Correct given the URL it was handed — and the URL it was handed is unusable.**

Note candidate 1 *is* the bare advertised URL. The proposed fix "try the
advertised URL itself before appending suffixes" is already what line 72 does.

---

## D. DIAGNOSIS, PER HOST

### AiKi → **(3) genuinely down**

Not (1): we do request the advertised URL, first, unmodified.
Not (2): there is no body to validate — the request never reaches a server.
Not (4): there is no endpoint at all.

**The domain `useaiki.xyz` is not registered.** Confirmed by the `.xyz`
registry's own SOA response. The four agents advertise a host that ceased to
exist; the company appears to have moved to `useaiki.ai`, which currently
serves a Squarespace "Coming Soon" page and no agent card at any path.

**Our probe is behaving correctly, and `315943`'s delisting after 4 consecutive
failures was the right outcome.** The delist rule did exactly what
[pipelineStatus.ts:59-66](../convex/lib/pipelineStatus.ts#L59) describes.
Nothing to fix. If the owner is seeing a live AiKi site, it is at a different
domain than the one these four agents registered on-chain — and only the
publisher can update an ERC-8004 registration.

### TermiX → **(1) URL construction — but the fix creates (4)**

`platform-backend.prod.termix.live` is **alive and answering**. The failure is
that the advertised endpoint is a template, `…/agents/{agentId}/card`, and
nothing substitutes it. We request the literal string with `{agentId}` in it and
get `{"error":{"code":"NOT_FOUND","message":"Agent not found"}}`.

**The repo already knows templated endpoints are unusable — elsewhere.**
[convex/lib/erc8183.ts:314-325](../convex/lib/erc8183.ts#L314) skips them
explicitly:

```ts
for (const service of services) {
  if (service.name !== "a2a") continue;
  if (service.endpoint.includes("{")) continue;
```

with the comment *"An un-substituted template is not a URL Dolphin can call, so
it is treated as no endpoint rather than fetched literally."* The liveness probe
has no equivalent guard. **That inconsistency is the actual defect.**

`platform-backend-bnb8183.prod.termix.live` is a **separate, dead host** —
`default backend - 404` from nginx for every path including substituted ones.
That is (3), genuinely down, and it holds the highest-scoring TermiX agent
(`292058`, score 33).

#### Would `looksLikeAgentCard` accept the substituted body? **Yes — and that is the problem.**

Simulated against the real 190411 response:

```
record.name           = "LiquidityCore.agent"   -> hasName: true
Array.isArray(skills) = true  (value: [])
protocolVersion       = undefined
version               = undefined
url                   = undefined
capabilities          = undefined
                      -> hasShape: true
=> looksLikeAgentCard VERDICT: ACCEPT
```

But the same body says:

```
endpoint = null
status   = "UNBOUND"
presence = "offline"
skills   = []
```

This is a **TermiX platform listing record, not an A2A AgentCard.** It happens
to carry `name` and a `skills` array, which is all our heuristic requires. The
record explicitly states the agent has no bound endpoint and is offline.

So the honest verdict for TermiX is **(1) followed by (4)**: we never request
the URL that works, and the URL that works does not return an agent card — it
returns a directory entry for an agent that is not wired up.

---

## E. BLAST RADIUS — all 74 unreachable pending candidates

### By URL shape

| count | shape |
|---|---|
| **38** | **TEMPLATED (contains `{…}`)** |
| 33 | bare path |
| 2 | ends in `.json` |
| 1 | has query string |

### By host

| count | host |
|---|---|
| 35 | `platform-backend.prod.termix.live` |
| 26 | `api.example-agent.ai` |
| 4 | `www.useaiki.xyz` |
| 3 | `platform-backend-bnb8183.prod.termix.live` |
| 2 | `bedrock-agentcore.us-east-1.amazonaws.com` |
| 1 each | `deltapartner.agent`, `misquote.vercel.app`, `agentcensus.xyz`, `agensea-health-factor.vercel.app` |

### Farm vs distinct

| count | group |
|---|---|
| 38 | termix-hosted |
| 26 | `api.example-agent.ai` placeholder farm |
| **10** | **distinct real agents** |

**Only 10 of the 74 are distinct agents on their own infrastructure.** The
`babycaisubagent*` farm is not in this group — those are all
`no-endpoint-advertised`, not `unreachable`.

### What substitution would actually do — measured, not projected

I substituted `{agentId}` for the token id on **all 38** templated URLs and
requested each, then ran the real `looksLikeAgentCard` predicate over every
body:

```
total templated tested          38
  HTTP 200 after substitution   32
  would PASS looksLikeAgentCard 32
  of those, bound and online     0     <-- every one is UNBOUND or OFFLINE
```

Every single one of the 32 reports `presence: "offline"`, and `status` is
`UNBOUND` (29) or `OFFLINE` (3). Not one has a non-null `endpoint`.

By confidence, the 38 templated:

| confidence | count | what would happen if the probe passed |
|---|---|---|
| `confirmed` | 2 | **auto-publish, no human involved** |
| `likely` | 36 | become manual-include candidates |

The two confirmed: `292058` (score 33) — **404 even substituted**, dead host, so
it would *not* be recovered; and `190411` (score 17) — 200, would **auto-publish
immediately** despite being `UNBOUND`/`offline`.

---

## F. THE FIX — DESCRIBED, NOT BUILT

### What NOT to do

**Do not ship template substitution on its own.** Measured consequence: 32
agents flip from `unreachable` to `verified-live`, all 32 with
`endpoint: null` and `presence: "offline"`. One (`190411`) auto-publishes with
no human in the loop. Thirty-one become eligible for a manual include that would
look justified from the ledger and would be listing agents that cannot be hired.

That is precisely the failure the liveness gate exists to prevent —
[pipelineStatus.ts:26-32](../convex/lib/pipelineStatus.ts#L26): *"Listing an
agent whose service does not answer sends that user into a dead end."* It would
also breach the data-integrity rule, because the catalog would assert
"verified live" about agents their own platform reports as offline.

### The minimal correct change

**Make the liveness probe treat a templated endpoint the way the payment path
already does: as no endpoint at all.**

One guard, in `a2aCandidates` at
[convex/lib/liveness.ts:70](../convex/lib/liveness.ts#L70) — and the matching
one in `probeMCP`'s caller — mirroring
[erc8183.ts:317](../convex/lib/erc8183.ts#L317):

```
if (base.includes("{")) return [];   // un-substituted template — not a URL we can call
```

Candidate order is otherwise **unchanged**:

```
1  <advertised URL, verbatim>                        (already first, line 72)
2  <advertised URL>/.well-known/agent-card.json      (line 74)
3  <origin>/.well-known/agent-card.json              (line 77)
4  <origin>/.well-known/agent.json                   (line 79)
```

Effect on status: the 38 templated candidates move from `unreachable` to
**`no-endpoint-advertised`**, which routes to `pending` via
[pipelineStatus.ts:162](../convex/lib/pipelineStatus.ts#L162) with an accurate
reason, and — importantly — **stops incrementing `consecutiveProbeFailures`**,
so they can no longer be delisted for failing a probe that was never callable.
Nothing is published or unpublished by this change.

Nothing about `looksLikeAgentCard` is weakened. Nothing about
`MAX_ATTEMPTS_PER_AGENT` or `PROBE_TIMEOUT_MS` changes.

### If you want the TermiX agents in the catalog

Substitution alone is not enough and is actively harmful. It would need to be
paired with a check that the returned record indicates a usable endpoint — e.g.
requiring `endpoint` to be non-null, or `status === "BOUND"`. **That is a change
to what counts as alive**, which this task rules out, so I am flagging it as a
decision for you rather than proposing it. Today, **zero** TermiX agents would
qualify under such a check — all 32 reachable ones are unbound and offline. The
right move is probably to raise it with TermiX directly, since they are a
partner: their agents publish an un-substituted `{agentId}` template in their
on-chain ERC-8004 registrations, which is a defect on their side that no
consumer can work around correctly.

### How many of the 74 would become verified-live if this ships?

**Zero — deliberately.**

| | count | outcome under the proposed fix |
|---|---|---|
| templated, would 200 but are UNBOUND/offline | 32 | reclassified `no-endpoint-advertised`, stay `pending` — **correctly** |
| templated, dead host (bnb8183 + errors) | 6 | reclassified `no-endpoint-advertised`, stay `pending` |
| AiKi, NXDOMAIN | 4 | unchanged, `unreachable` — correct |
| `api.example-agent.ai` placeholder farm | 26 | unchanged, `unreachable` — correct |
| bedrock (401 auth-gated), agensea (404), misquote (404), agentcensus (NXDOMAIN), deltapartner | 6 | unchanged — correct |

**The honest answer to "how many agents does this recover" is none.** The value
of the fix is that it stops the ledger recording a *wrong reason*, stops
unfair delisting pressure on 38 candidates, and closes an inconsistency between
two modules that already disagree about templated URLs. It does not grow the
catalog, and no change to the probe can, because every unreachable host here is
genuinely unreachable, auth-gated, or serving something that is not an agent.

---

## What is PROVEN vs NOT PROVEN

**PROVEN**
- `useaiki.xyz` and `agentcensus.xyz` are NXDOMAIN — three resolvers plus the
  `.xyz` registry SOA.
- `useaiki.ai` is a Squarespace "Coming Soon" catch-all returning 200 for every
  path, including a nonsense one.
- TermiX advertises `{agentId}` templates; substituting yields HTTP 200 on
  `platform-backend.prod.termix.live` and 404 on `…-bnb8183…`.
- All 32 reachable TermiX records report `endpoint: null` and
  `presence: "offline"`.
- `looksLikeAgentCard` accepts the TermiX body (simulated with the real
  predicate against the real response).
- `a2aCandidates` already tries the bare URL first and the origin-root
  well-known path.

**NOT PROVEN**
- Whether `platform-backend.prod.termix.live` would serve a real AgentCard for
  an agent that *is* bound. No bound TermiX agent was found to test against.
- Whether AiKi operates at some other domain not discoverable from these
  registrations. `useaiki.com`, `useaiki.ai`, `app.`/`api.useaiki.xyz` were
  checked; none serve an agent card.
- Whether the 26 `api.example-agent.ai` entries were ever live. The domain is a
  documentation placeholder; not probed historically.
