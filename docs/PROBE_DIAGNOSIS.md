# Probe Diagnosis — AiKi and TermiX

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
