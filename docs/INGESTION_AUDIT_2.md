# Ingestion Audit 2 — 8004scan capacity vs. Dolphin's real bottleneck

Investigation only. No pipeline code was changed. Every number below is either a
live response header, a live query result, a live Convex query, or a file:line
citation. Where something could not be established it says **UNVERIFIED** and
what would settle it.

Probed 2026-09-01 against `https://api.8004scan.io/api/v1/agents` with a
standalone script written fresh for this audit (never through
`convex/discoveryPipeline.ts`'s client, which encodes the old tier's
assumptions). Probe scripts live in the session scratchpad, outside the repo,
and are untracked.

---

## 0. KEY HANDLING — READ THIS FIRST

**Good news: no stale key in the repo.** Neither `.env.local` nor
`web/.env.local` contains `SCAN8004_API_KEY` at all — checked by name, values
never printed:

```
root .env.local  -> CONVEX_DEPLOYMENT, EXPO_PUBLIC_CONVEX_URL,
                    EXPO_PUBLIC_CONVEX_SITE_URL, EXPO_PUBLIC_REOWN_PROJECT_ID,
                    EXPO_PUBLIC_BSC_RPC_URL, EXPO_PUBLIC_8004SCAN_API_BASE_URL,
                    BSC_RPC_URL, SCAN8004_API_URL
                    -> SCAN8004_API_KEY present: NO
web/.env.local   -> NEXT_PUBLIC_* only
                    -> SCAN8004_API_KEY present: NO
```

`.gitignore` covers `.env*.local` and `.env`. The key is Convex-side only, which
is correct — it never reaches a client bundle.

### ⚠️ ACTION REQUIRED: the key in Convex is not the key you pasted

`npx convex env list` shows exactly one variable, `SCAN8004_API_KEY`. Compared
byte-wise against the key you pasted mid-session (values never printed; compared
by length, SHA-256 and `cmp` offset):

```
key stored in Convex   46 bytes   sha256 926edaf8042857d2…   differs from byte 6
key you pasted         46 bytes   sha256 50ffa9c3f4a1420d…
shared prefix          bytes 1-5 only (the "8004_" scheme prefix)
```

**These are two different keys.** You then said the old key has been revoked.

At probe time **both keys still returned HTTP 200**, and — this is what makes
the audit valid — **both reported the identical tier**:

```
                        limit-minute   limit-day    remaining-day at first read
key in Convex           3000           3000000      2996784   (3,216 already spent today)
key you pasted          3000           3000000      2999999   (fresh)
```

So every measurement in this document reflects the upgraded tier regardless of
which key produced it. Nothing here is invalidated.

**But: revocation had not propagated when I probed.** If the Convex key is the
revoked one, the discovery crons will start failing the moment it does — and
they will fail *silently*, because `fetchPage`
([convex/discoveryPipeline.ts:152](../convex/discoveryPipeline.ts#L152)) throws
on `!response.ok` and `withConcurrency` swallows individual task failures
without alerting. The sweep would report "saw 0 records" and nothing else.

**Update `SCAN8004_API_KEY` in Convex to the new key.** I have not done this —
it is a production change and this task is investigation-only. The 3,216
requests already spent today on the Convex key confirm the crons are live and
currently using it.

Separately: the key is now in this conversation's transcript. If that matters
for your threat model, rotate it after the deadline.

---

## SECTION D — THE NEW KEY, PROBED

### D1. Every response header, verbatim

`GET /api/v1/agents?limit=1` → **HTTP 200**, 4,204 ms.

```
alt-svc: h3=":443"; ma=86400
cf-cache-status: DYNAMIC
cf-ray: a344a62f5f14009a-CDG
connection: keep-alive
content-encoding: br
content-security-policy: default-src 'self'; script-src 'self' http://localhost:3000 …
content-type: application/json
date: Tue, 01 Sep 2026 13:33:55 GMT
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
permissions-policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=()
referrer-policy: strict-origin-when-cross-origin
report-to: {"group":"cf-nel","max_age":604800,…}
server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
transfer-encoding: chunked
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
x-ratelimit-limit-day: 3000000
x-ratelimit-limit-minute: 3000
x-ratelimit-remaining-day: 2996800
x-ratelimit-remaining-minute: 2999
x-xss-protection: 1; mode=block
```

**The real numbers: 3,000 requests/minute and 3,000,000/day.**

**`X-RateLimit-Tier` does not exist.** The docs promise it; the server does not
send it. There is no tier string to report — only the two quota pairs. (Note
also the CSP header leaks `http://localhost:3000` into production responses,
which is 8004scan's bug, not ours.)

For scale: the old design's stated budget was **600/min, 100,000/day**
([convex/crons.ts:12](../convex/crons.ts#L12)). The new tier is **5× the
per-minute and 30× the daily allowance.**

### D2. True maximum page size — 100, and it is a hard cap

| `limit` | HTTP | records actually counted | error body |
|---|---|---|---|
| 100 | 200 | **100** | — |
| 200 | 422 | 0 | `{"detail":[{"type":"less_than_equal","loc":["query","limit"],"msg":"Input should be less than or equal to 100","input":"200","ctx":{"le":100}}]}` |
| 500 | 422 | 0 | same, `"input":"500"` |
| 1000 | 422 | 0 | same, `"input":"1000"` |
| 5000 | 422 | 0 | same, `"input":"5000"` |

100 is a **validated schema ceiling**, not a docs example. The comment at
[convex/discoveryPipeline.ts:89](../convex/discoveryPipeline.ts#L89) —
`PAGE_SIZE = 100; // 8004scan caps limit at 100; 200/500/1000 all return HTTP 422`
— is **still exactly correct on the new tier.** Page size did not improve.

### D3. IS THERE PAGINATION? — **YES. `offset` works, and it is undocumented.**

The envelope is **not** a bare array. It is an object:

```json
{ "items": [ … ], "total": 796619, "limit": 25, "offset": 0 }
```

`offset` is echoed back in the envelope, which is the tell. Tested against an
unpaginated call of the same limit:

| param | HTTP | n | first token | last token | verdict |
|---|---|---|---|---|---|
| `offset=25` | 200 | 25 | 11547 | 83982 | **CHANGED — REAL** |
| `page=25` | 200 | 25 | 11558 | 11548 | ignored (identical) |
| `cursor=1` | 200 | 25 | 11558 | 11548 | ignored |
| `skip=25` | 200 | 25 | 11558 | 11548 | ignored |
| `after=1` | 200 | 25 | 11558 | 11548 | ignored |
| `start=25` | 200 | 25 | 11558 | 11548 | ignored |
| `from=25` | 200 | 25 | 11558 | 11548 | ignored |
| `before=1` | 200 | 25 | 11558 | 11548 | ignored |
| `next=1` | 200 | 25 | 11558 | 11548 | ignored |

**Unambiguous answer: full registry coverage is POSSIBLE.** `offset` is the one
working pagination parameter, there is no cursor and no `hasMore`/`nextCursor`
field, and `total` is what tells you when to stop.

`offset` also goes arbitrarily deep — offsets of 400,000 and 700,000 both return
records normally, with no degradation. One oddity worth recording: `offset=800000`
still returns 10 records even though `total` is 796,619, so the API does **not**
return empty past the end. A drain loop must terminate on `offset >= total`, not
on an empty page. **UNVERIFIED** why records appear past `total` — possibly the
count and the paginated set are computed differently.

### D4. Total count — yes, exposed

`total` is present on every list response.

```
no filter                          total = 796,619   (ALL chains)
chain_id=56                        total = 296,507
chain_id=56&is_testnet=false       total = 296,507
chain_id=1                         total =  30,663
chain_id=8453                      total =  59,229
```

The denominator drifted during the session — 296,458 → 296,493 → 296,507 →
296,514 across roughly 40 minutes, consistent with the ~28/hour registration
rate [convex/crons.ts:16](../convex/crons.ts#L16) plus bursts.

**Correction to a widely-repeated figure in this repo: the registry is not
~291,500. That was the BSC count when measured on 2026-08-29. It is now
~296,500 on BSC, and 796,619 across all chains.** Any doc quoting 289,938 or
291,543 is stale by ~7,000.

### D5. Undocumented filter and sort params, judged by `total`

Judging by returned items is unreliable (the default ordering shifts as new
agents register). Judging by `total` is decisive — a real filter changes the
denominator.

| param | HTTP | total | real filter? |
|---|---|---|---|
| `chain_id=56` | 200 | 296,493 | **YES** — 796,619 → 296,493 |
| `chain_id=1` | 200 | 30,663 | **YES** |
| `chain_id=8453` | 200 | 59,229 | **YES** |
| `x402_supported=true` | 200 | 369,961 | **YES** |
| `chainId=56` (camelCase) | 200 | 796,619 | no — silently ignored |
| `chain=56` | 200 | 796,619 | no |
| `is_testnet=false` | 200 | 296,507 | **no — silently ignored** |
| `is_testnet=true` | 200 | 296,507 | no (identical to `false`) |
| `status=active` | 200 | 796,619 | no |
| `active=true` / `is_active=true` | 200 | 796,619 | no |
| `type=agent` | 200 | 796,619 | no |
| `category=defi` | 200 | 796,619 | no |
| `createdAfter=` / `since=` | 200 | 796,619 | no |
| `verified=true` | 200 | 796,619 | no |
| `has_endpoint=true` | 200 | 796,619 | no |
| `registry=0x8004A169…` | 200 | 796,619 | no |
| `sort_by=token_id` | 200 | 796,619 | real (reorders, does not filter) |
| `sort_order=asc` | 200 | 796,619 | real (reorders) |
| `order=asc` | **500** | — | **crashes the server** |

**`chain_id` is the valuable one and the pipeline already uses it**
([convex/discoveryPipeline.ts:147](../convex/discoveryPipeline.ts#L147)).

Two findings to log:

1. **`is_testnet=false` is inert.** The pipeline sends it on every request; it
   changes nothing. Harmless, but it is not doing the work its presence implies.
2. **`order=asc` returns HTTP 500.** The pipeline correctly uses `sort_order`,
   not `order`. Do not "fix" it to `order`.

### D6 / D7. Search density and composition

`search` composes with `limit` **and** with `offset`, and a term drains cleanly:
`search=yield&chain_id=56` → total 277, drained across 3 pages as 100 + 100 + 77
= 277 unique, **0 duplicates**.

Draining the pipeline's **actual 53-term vocabulary**
([convex/discoveryPipeline.ts:199-220](../convex/discoveryPipeline.ts#L199-L220))
at its own `MAX_PAGES_PER_TERM = 5`:

| term | total | drained | fully drained at 5 pages? |
|---|---|---|---|
| earn | **5,207** | 500 | **NO — TRUNCATED, 4,707 lost** |
| defi agent | **590** | 500 | **NO — TRUNCATED, 90 lost** |
| apy | 410 | 410 | yes |
| liquidation | 335 | 335 | yes |
| yield | 277 | 277 | yes |
| yield optimizer | 190 | 190 | yes |
| liquidation risk | 127 | 127 | yes |
| vault | 87 | 87 | yes |
| pancakeswap | 62 | 62 | yes |
| liquidity management | 53 | 53 | yes |
| fee tier | 49 | 49 | yes |
| rebalancing | 44 | 44 | yes |
| liquidity provider | 44 | 44 | yes |
| farming | 44 | 44 | yes |
| rebalance | 43 | 43 | yes |
| position manager | 36 | 36 | yes |
| yield farming | 31 | 31 | yes |
| concentrated liquidity | 23 | 23 | yes |
| yield aggregator | 18 | 18 | yes |
| liquidity range | 17 | 17 | yes |
| health factor | 17 | 17 | yes |
| auto compound / venus / portfolio rebalancing | 16 each | 16 | yes |
| staking rewards | 12 | 12 | yes |
| grid trading | 9 | 9 | yes |
| lending position | 9 | 9 | yes |
| collateral | 7 | 7 | yes |
| lp position / impermanent loss / grid strategy | 6 each | 6 | yes |
| v3 pool / liquidation protection / apr | 4 each | 4 | yes |
| grid trader / grid bot / aave | 3 each | 3 | yes |
| grid level | 2 | 2 | yes |
| tick range, price ladder, buy and sell ladder, collateral ratio, borrow limit, loan to value, lista, beefy, morpho | 1 each | 1 | yes |
| **reposition, autocompound, alpaca finance, wombat, thena, kinza** | **0** | 0 | **six dead terms** |

**Union across all 53 vocabulary terms: 2,127 unique chain-56 token ids.**
Of those, 1,363 (64.1%) advertise at least one protocol:
`{A2A: 1097, Web: 514, MCP: 277, Email: 235, OASF: 224}`.
764 advertise **no protocol at all** and therefore can never pass a liveness gate.

Spam judged descriptively from name/description only (not run through the
pipeline), on a broader term set: the precise terms are almost pure — `rebalancing`
44/44 plausible, `grid trading` 9/9, `health factor` 17/17, `venus` 16/16,
`lp range` 4/4. The broad terms carry the noise — `portfolio` 80/100,
`apy` 84/100, `trading` **128,559 total** and thus useless as a term.

### D8. Full raw record

`GET /agents/56/302257` (Brain on BNB, known-good) returned a **68-field**
object. The fields that matter for this audit, abridged for length — the
complete dump is in the session transcript:

```json
{
  "agent_id": "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:302257",
  "token_id": "302257", "chain_id": 56, "is_testnet": false,
  "name": "Brain on BNB — Venus Health Factor Monitor",
  "description": "Reads a Venus lending position … Hireable over ERC-8183 for 0.10 $U …",
  "agent_wallet": "0x73809f69916fcf7ddc5bb1315fbdf96a569a5963",
  "x402_supported": true,
  "supported_protocols": ["A2A"],
  "services": { "a2a": { "endpoint": "https://agent.brainonbnb.com/a2a", "skills": [] } },
  "is_endpoint_verified": true,
  "endpoint_verified_domain": "agent.brainonbnb.com",
  "endpoint_last_checked_at": "2026-09-01T12:35:39.307369Z",
  "is_active": true,
  "health_status": {
    "services": { "a2a": { "status": "unhealthy",
        "message": "Not a valid AgentCard (missing name) (cached)",
        "latency_ms": 136.48 }, … },
    "health_score": 50, "overall_status": "degraded"
  },
  "total_feedbacks": 3, "average_score": 0, "rank": null,
  "raw_metadata": {
    "onchain": [ { "key": "agentWallet", "value": "0x73809f…5963" } ],
    "offchain_uri": "data:application/json;base64,eyJ0eXBlIjoi…"
  },
  "parse_status": { "status": "success", "errors": [], "warnings": [] }
}
```

**Two findings with real consequences:**

1. **`raw_metadata.offchain_uri` carries the agent's entire ERC-8004
   registration file inline**, base64-decoded from the on-chain `tokenURI`.
   Dolphin currently re-derives this itself — one BSC `eth_call` plus one
   third-party HTTP fetch per candidate
   ([convex/lib/registrationFile.ts:228,249](../convex/lib/registrationFile.ts#L228)).
   8004scan already has it. See §C2.
2. **8004scan runs its own endpoint health checks** and publishes per-service
   `status`, `latency_ms` and `checked_at`. Note it disagrees with Dolphin about
   this very agent: 8004scan calls Brain on BNB's A2A endpoint `"unhealthy"`
   while Dolphin's own probe passes it. The disagreement runs both ways, so
   neither is a drop-in substitute for the other — but the flag from the existing
   sweep response is free, and Dolphin's probe costs up to 6 requests.

Randomly-chosen token ids (12345, 150000, 250000) returned the same field set,
so the shape is consistent — only the values are sparser on weaker agents.

### D9. LIST vs DETAIL — detail is a strict superset

```
LIST   30 fields
DETAIL 68 fields
IN LIST ONLY: (none)
```

**LIST has** `name`, `description`, `x402_supported`, `supported_protocols`,
`owner_address`, `image_url`, `is_verified`, `health_score`, `total_score`,
`star_count`, `total_feedbacks`, `rank`, `network_rank`, `created_at`,
`token_id`, `chain_id`, `is_testnet`, `contract_address`, …

**DETAIL ONLY (38 extra):** `services`, `agent_wallet`, `a2a_endpoint`,
`mcp_server`, `is_endpoint_verified`, `endpoint_verified_domain`,
`endpoint_last_checked_at`, `is_active`, `health_status`, `raw_metadata`,
`tags`, `categories`, `parse_status`, `quality_score`, `freshness_score`,
`popularity_score`, `wallet_score`, `activity_score`,
`metadata_completeness_score`, `created_tx_hash`, `did`, …

**This is the cost driver.** The prefilter and classifier need only `name` and
`description`, **both of which are in the LIST response** — so the cheap stages
cost zero extra calls. Anything needing an endpoint (`services`,
`agent_wallet`, `health_status`) costs **one detail call per candidate**.

### D10. Measured throughput — concurrency is served, not rejected

```
20 SEQUENTIAL     9,566 ms total, 478 ms average
10 CONCURRENT     1,721 ms total, all ten HTTP 200 → ~172 ms effective (5.5× speedup)
quota consumed    41 requests moved remaining-day 2,999,994 → 2,999,962
```

Scaling further, against the pipeline's own query shape
(`chain_id=56&is_testnet=false&limit=100&offset=N`):

| concurrency | wall | ok | records | p50 | p100 | throughput |
|---|---|---|---|---|---|---|
| **4** (current) | 1,810 ms | 4/4 | 400 | 1,126 ms | 1,478 ms | 221 rec/s |
| 8 | 5,597 ms | 8/8 | 800 | 812 ms | 1,880 ms | 143 rec/s |
| 16 | 8,938 ms | 16/16 | 1,600 | 2,233 ms | 8,730 ms | 179 rec/s |
| **32** | 5,955 ms | **32/32** | 3,200 | 2,320 ms | 5,579 ms | **537 rec/s** |

**The API never rejected a single concurrent request and never returned 429.**
Per-request latency rises under load but total throughput improves. A 32-page
burst in one round trip is served fine.

One transient `ECONNRESET` occurred during a long detail-fetch run at
concurrency 12; retry with backoff cleared it. Any production drain needs retry,
which the sweep already has by way of `withConcurrency` not throwing.

**Full-registry projection, measured not estimated:**

```
32 pages (3,200 records) in 4,275 ms at concurrency 16  =>  134 ms per page
registry total (chain 56)                               =  296,508
pages needed for FULL coverage                          =    2,966
projected wall time                                     =  6.6 minutes
requests used                                           =  2,966  (0.099% of daily quota)
minimum time against the 3,000/min cap                  =  1.0 minute
```

**The entire BSC registry can now be walked in about seven minutes for one tenth
of one percent of the daily quota.**

---

## SECTION A — WHERE THE FILTER CUTS (unchanged, quoted only)

### A1. Prefilter rules — [convex/lib/prefilter.ts](../convex/lib/prefilter.ts)

Seven rules, evaluated structural-first. Verbatim conditions:

1. **`empty-description`** — `rawDescription.length < 20`
   ([:182](../convex/lib/prefilter.ts#L182)); also `DEFAULT_NAME = /^agent\s*#?\s*\d+$/i`
   ([:118](../convex/lib/prefilter.ts#L118)), 8004scan's mint-time default.
2. **`numeric-noise`** — name is all digits, or description ≥20 chars with
   ≥90% digits ([:156-163](../convex/lib/prefilter.ts#L156)).
3. **`repeated-token`** — `/(.{3,})\1{2,}/i` ([:101](../convex/lib/prefilter.ts#L101)).
4. **`collectible-series`** — `/\bbort\s+\w+\s+\w*\s*#\s*\d+/i` or
   `/\bedition\s+\d+\s*\/\s*\d+\b/i` ([:97-98](../convex/lib/prefilter.ts#L97)).
5. **`campaign-template`** — 10 exact substrings ([:63-74](../convex/lib/prefilter.ts#L63)),
   each with its observed count: `"ai-driven multi-chain trading agent with on-chain reputation"`
   (630/2000), `"trading agent from debot.ai"` (48/2000),
   `"purr-fect claw cloud instance agent"` (42/2000), `"on termix platform"`,
   `"gasless stablecoin payment agent on bnb chain"` (28/2000),
   `"autonomous trading agent (simple-mode)"` (131/1446),
   `"ai agent for liquid-staking"` (44/1446),
   `"autonomous trading agent. trades aster dex perps"` (38/1446),
   `"citizen of xtown"` (9/2000), `"3d interactive agent"`.
6. **`persona-agent`** — 5 markers ([:82-88](../convex/lib/prefilter.ts#L82)):
   `"an evoevo ai agent"` (~867/2000 = 43% of the sample), `"evoevo agent"`,
   `"· ensoul"`, `" ensoul"`, `"yi he nexus"`.
7. **`off-topic`** — nothing in name+description matches any of the ~90-entry
   `DEFI_VOCABULARY` ([:129-149](../convex/lib/prefilter.ts#L129)).

The module states its bias explicitly ([:19-27](../convex/lib/prefilter.ts#L19)):
*"false negatives are worse than false positives"* — anything dropped here is
never seen again. It also documents a rule it deliberately removed: a
`/\btest\b/` name reject, dropped because token 292939
(`bnb-grid-trader-test.agent`) is a real working grid agent
([:104-115](../convex/lib/prefilter.ts#L104)).

### A2. Classifier weights and thresholds — [convex/lib/agentScoring.ts](../convex/lib/agentScoring.ts)

```ts
const WEIGHT = {                    // :157-163
  definingInName:        12,
  definingInDescription:  8,
  supportingInName:       6,
  supportingInDescription: 3,
  weakInDescription:      1,
};
const MAX_WEAK_HITS_COUNTED = 3;    // :166
const BREADTH_VERB_THRESHOLD = 8;   // :203
export const CONFIRMED_SCORE  = 12; // :229
export const CONFIRMED_MARGIN =  6; // :230
export const LIKELY_SCORE     =  4; // :231
```

**`confirmed` — the only band that auto-publishes — requires all four:**

1. at least one **defining** phrase matched (a pile of weak topical terms can
   never reach `confirmed`, no matter how many);
2. `adjusted >= 12`;
3. `margin >= 6` over the runner-up category;
4. survived penalties.

`adjusted < 4` → no category at all → `rejected-classifier`.
`4 <= adjusted < 12`, or margin too thin, or no defining phrase → `likely` → `pending`.

**Penalties** ([:179-206](../convex/lib/agentScoring.ts#L179)): a 26-term
`OFF_DOMAIN_CAPABILITIES` list (`bridge`, `perp`, `prediction market`,
`nft mint`, `airdrop`, `gauge vote`, `sentiment`, `arbitrage`, `copy trading`, …);
a breadth penalty of `-3 × (verbs - 7)` once a description names ≥8 of 45
`ACTION_VERBS`; and `TEST_MARKER = /\btest\b/i` as a soft penalty rather than the
hard reject it used to be.

### A3. Registration cross-check — [convex/lib/registrationFile.ts](../convex/lib/registrationFile.ts)

Reads `tokenURI` from the ERC-8004 registry via BSC RPC
([:228](../convex/lib/registrationFile.ts#L228)), then fetches and parses it.
`FETCH_TIMEOUT_MS = 10_000` ([:59](../convex/lib/registrationFile.ts#L59)),
`MAX_REGISTRATION_BYTES = 512 * 1024` ([:61](../convex/lib/registrationFile.ts#L61)),
IPFS via a gateway list ([:54](../convex/lib/registrationFile.ts#L54)),
`data:` URIs decoded inline ([:188](../convex/lib/registrationFile.ts#L188)).

States: `fetched`, `no-token-uri`, `unreachable`, `unsupported-transport`.
**It is not a gate.** Nothing is rejected for failing it. Its outputs feed the
deep re-score and record `crossCheckDrift` when the agent's own file disagrees
with 8004scan's cached copy
([convex/discoveryPipeline.ts:594-609](../convex/discoveryPipeline.ts#L594)).

### A4. Liveness probe — [convex/lib/liveness.ts](../convex/lib/liveness.ts)

```ts
const PROBE_TIMEOUT_MS       = 8_000;  // :57
const MAX_ATTEMPTS_PER_AGENT = 6;      // :59
```

No retry beyond those 6 total attempts across all candidate URLs.

- **A2A** — GET the agent-card URL; must be HTTP 2xx **and** parse as a valid
  agent card (`looksLikeAgentCard`, [:88](../convex/lib/liveness.ts#L88)).
  Several URL shapes are tried per endpoint ([:70](../convex/lib/liveness.ts#L70)).
- **MCP** — POST an `initialize` JSON-RPC call; must be 2xx with a JSON-RPC body.

Three states: `verified-live`, `unreachable`, `no-endpoint-advertised`.
The module header records why it exists rather than trusting 8004scan's own flag:
8004scan reported token 304494 `overall_status: "unhealthy"` while the endpoint
answered in 1,217 ms, and its messages carry the literal string `"(cached)"`
([:6-8](../convex/lib/liveness.ts#L6)).

### A5. Manual exclusions — [convex/lib/manualExclusions.ts](../convex/lib/manualExclusions.ts)

Exactly two token ids:

- **113284** Topaz Agent — broad ve(3,3) DEX agent; *"optimize LP positions"* is
  one clause among many. Matched rebalancing's `"lp position"`.
- **6428** Tator Trader — 24+ chain "does everything" agent; *"manage yield
  positions"* is one clause of ten. Matched yield's weak `"yield"` term.

The header notes the scorer now catches both unaided, and the list is kept only
so a human can be final about a specific case without a redeploy. A runtime half
(`setManualOverride`) exists for cases found after deploy; either is sufficient.

### The publish gate — [convex/lib/pipelineStatus.ts](../convex/lib/pipelineStatus.ts)

`resolveStatus` order: manual exclusion → no category → off-primary-registry
(BRC8004 → `pending`) → `unreachable` → `no-endpoint-advertised` → confidence.

```ts
DELIST_AFTER_CONSECUTIVE_FAILURES = 3;                    // :67
LIVENESS_RECHECK_AFTER_MS         = 24 * 60 * 60 * 1000;  // :77
REEVALUATE_REJECTED_AFTER_MS      = 14 * 24 * 60 * 60 * 1000; // :88
```

**Publication requires `confirmed` AND `verified-live`.** Everything else is
`pending`, never deleted.

---

## SECTION B — THE FUNNEL IN REAL NUMBERS

Live: `npx convex run discoveryPipeline:getPipelineStats '{}'`, 2026-09-01.

```json
{
  "registryTotal": 296458,
  "ledgerTotal": 216679,
  "backfillOffset": 17600,
  "backfillCompletedAt": "2026-09-01T11:09:07.016Z",
  "lastSweepAt": "2026-09-01T13:09:09.636Z",
  "lastSweepSummary": "saw 8098 records; 101 new, 0 re-evaluated; 47 classified,
                       7758 pre-filtered out, 293 unclassifiable; 308513ms",
  "candidates": { "rejected-prefilter": 210882, "rejected-classifier": 5679,
                  "pending": 107, "published": 11 },
  "deepEvaluatedInLiveBands": 118,
  "livenessByState": { "verified-live": 16, "unreachable": 73,
                       "no-endpoint-advertised": 29 },
  "publishedByCategory": { "rebalancing": 4, "health-factor": 3,
                           "grid-trading": 2, "yield": 2 },
  "iconsBySource": { "8004scan-image": 1754, "registration-file": 1533,
                     "generated-fallback": 286 }
}
```

### B1. Total candidates ever recorded — **216,679**

### B2. Rejection histogram

| stage | count | % of ledger | % of what reached it |
|---|---|---|---|
| **rejected-prefilter** | 210,882 | 97.32% | 97.32% of 216,679 |
| **rejected-classifier** | 5,679 | 2.62% | **97.96%** of the 5,797 survivors |
| **pending** | 107 | 0.049% | 1.85% of survivors |
| **published** | 11 | 0.0051% | 0.19% of survivors |

Per-rule prefilter breakdown is **UNVERIFIED at the ledger level** —
`getPipelineStats` aggregates counters by status, not by `prefilterRule`, and
the per-rule counts would need a full-table scan, which the schema comment says
blows Convex's 16 MB read cap past ~12,000 rows
([convex/schema.ts:305-315](../convex/schema.ts#L305)). What *is* observable is
one sweep's own summary: **7,758 pre-filtered out of 8,098 seen (95.8%)**, 293
unclassifiable, 47 classified.

Liveness among the 118 in live bands: **verified-live 16, unreachable 73,
no-endpoint-advertised 29.** So **86% of everything that survives classification
fails the liveness gate.**

A 300-row sample of `rejected-classifier` (most-recently-deep-evaluated first):
all 300 had been deep-evaluated; `no-endpoint-advertised` 275, `unreachable` 25,
**`verified-live` 0**.

### B3. Pending — 107

Reasons are per-row `statusReason`. The BRC8004 registry collision is one
documented cause ([pipelineStatus.ts:139-145](../convex/lib/pipelineStatus.ts#L139));
`likely`-but-not-`confirmed` and `no-endpoint-advertised` are the others. **The
exact split across the 107 is UNVERIFIED** — it needs a group-by the stats query
does not expose. `listCandidates` with `status:"pending"` would answer it.

### B4. How much of the registry has been evaluated at least once?

```
registryTotal (chain 56)  296,458
ledgerTotal               216,679
                          ───────
COVERAGE                    73.1%
never evaluated             79,779   (26.9%)
```

**`backfillCompletedAt` is set to 2026-09-01T11:09:07Z — the backfill has
completed at least one full pass**, and `backfillOffset` has wrapped back to
17,600, i.e. it is now re-walking. The most recent sweep saw 8,098 records and
found only **101 new**, which is the signature of re-walking known ground.

**The 79,779-record gap is real but its cause is UNVERIFIED.** Candidates: the
registry grew during the walk (too small — ~28/hr would be a few thousand over
days, not 80k); or `MAX_RECORDS_PER_SWEEP = 8_000`
([:120](../convex/discoveryPipeline.ts#L120)) truncating a cycle while
`backfillOffset += offsets.length * PAGE_SIZE` ([:433](../convex/discoveryPipeline.ts#L433))
advances past pages whose records were not persisted, leaving gaps. Settling it
needs a token-id histogram of the ledger against the registry — a full scan,
which the 16 MB read cap makes awkward from a single query.

### B5. Time to reach every identity

**Under the current design**, from its own measured throughput
(`lastSweepSummary`: 8,098 records in 308,513 ms):

```
one sweep          8,098 records in 5.14 minutes, hourly
                   -> 8,098 records/hour theoretical
79,779 unseen  /  8,098 per hour  =  9.85 hours
```

But that is the *optimistic* reading, and it is wrong in practice: the sweep is
currently finding **101 new per 8,098 seen (1.2%)** because it is re-walking.
At the observed *new-record* rate:

```
79,779 unseen  /  101 new per hour  =  790 hours  =  33 DAYS
```

**Sep 9 is 8 days away. The current configuration does not close the gap.**

**Under the new tier**, using measured numbers from §D10:

```
2,966 pages at 134 ms effective (concurrency 16)  =  6.6 minutes
requests                                          =  2,966  (0.099% of daily quota)
against the 3,000/min cap                         =  1.0 minute minimum
```

**A complete registry walk goes from 33 days to about seven minutes.** The
constraint that shaped the entire incremental-backfill architecture no longer
exists.

---

## SECTION C — THE ACTUAL BOTTLENECK

### C1. Outbound requests for ONE candidate through the full pipeline

**Cheap stage** (`evaluateCheaply`, [:251-273](../convex/discoveryPipeline.ts#L251)) —
pure string work, **zero requests**. It runs on the list record the sweep already
holds. Amortised 8004scan cost: **1/100th of a request** (one page carries 100).

**Deep stage** (`deepEvaluate`, [:586-643](../convex/discoveryPipeline.ts#L586)):

| call | target | count | timeout |
|---|---|---|---|
| `readTokenUri` | **BSC RPC** `eth_call` | 1 | — |
| `fetchText` on the registration file | **the agent's own host** (or IPFS gateways) | 0 (`data:` URI) to 3 (IPFS fallbacks) | 10 s each |
| `getDirectoryRow` | Convex-internal | 0 outbound | — |
| `probeLiveness` | **the agent's own endpoints** | up to **6** | 8 s each |
| icon fetch (when missing) | agent host / 8004scan media | 0–1 | — |
| **8004scan** | — | **ZERO** | — |

**A deep evaluation makes no 8004scan request at all.** Worst case per candidate:
1 RPC + 3 registration fetches + 6 probe attempts ≈ **10 outbound calls, up to
78 seconds of timeout budget.**

### C2. Which stages are gated on third-party HTTP rather than 8004scan?

**Every expensive one.**

```
                    gated on 8004scan   gated on THIRD PARTIES
prefilter                  no (free)              no
classification             no (free)              no
registration cross-check   NO                     YES  (agent's own host, IPFS)
liveness probe             NO                     YES  (agent's own endpoints)
```

**This is the audit's central finding.** The API upgrade makes the *sweep* ~300×
faster and costs a rounding error of quota — but the sweep was never what
capped the catalog. The stages that decide whether an agent gets published are
gated on **other people's servers**, at 8 s and 10 s timeouts, and a 5×/30×
quota increase does nothing for them.

With `DEEP_EVAL_BUDGET_MS = 420_000` ([:104](../convex/discoveryPipeline.ts#L104))
and a worst case of ~78 s per candidate, one deep-evaluation pass can process as
few as **5 candidates**; `DEEP_EVAL_BATCH = 40`
([:122](../convex/discoveryPipeline.ts#L122)) is only reachable when endpoints
answer fast or are absent.

**Two free levers exist and neither is used** (both from §D8 — findings, not
recommendations):
- `raw_metadata.offchain_uri` already contains the registration file, which
  would remove the RPC call and the third-party fetch;
- `health_status.services[].status` already contains 8004scan's own probe result.
  Dolphin's probe exists precisely because 8004scan's flag was found unreliable
  ([liveness.ts:6-8](../convex/lib/liveness.ts#L6)), and the Brain-on-BNB
  disagreement in §D8 confirms they still differ — so this is a **prefilter for
  which agents are worth probing**, not a replacement for probing.

### C3. Can prefilter and classification run on the 8004scan response alone?

**Yes, and they already do.** `evaluateCheaply`
([:251](../convex/discoveryPipeline.ts#L251)) takes only
`{ tokenId, name, description }` — all three present in the LIST response (§D9) —
and its own comment says *"Both are pure string work with no network call, so
they can run over every record the sweep touches"*
([:244-246](../convex/discoveryPipeline.ts#L244)).

**A candidate is killed cheaply before any third-party call.** 97.32% of the
ledger dies at prefilter having cost nothing but its 1/100th of a page fetch.
**This part of the design is already optimal and needs no change.**

One consequence worth stating plainly: the 5,679 `rejected-classifier` rows were
judged on 8004scan's cached `name`/`description` **only**. `deepEvaluate`
re-scores *with* the registration file
([:612-616](../convex/discoveryPipeline.ts#L612)), so an agent whose 8004scan
copy is thin but whose own file is rich gets a second chance — but only when it
reaches deep evaluation, and `needsDeepEvaluation` gives `rejected-classifier`
rows a **14-day** cooldown.

### C4. Are rejections cached?

**Yes, correctly.** `needsDeepEvaluation`
([pipelineStatus.ts:193-214](../convex/lib/pipelineStatus.ts#L193)):

```ts
case "rejected-prefilter":  return false;                         // NEVER re-deep-evaluated
case "rejected-classifier": return age >= REEVALUATE_REJECTED_AFTER_MS;  // 14 days
case "pending": case "published": return age >= LIVENESS_RECHECK_AFTER_MS; // 24 hours
```

The hourly sweep **does** re-see and re-run the cheap prefilter over known
tokenIds (it is free), but never re-probes them. The last sweep re-seeing 8,098
records for 101 new is this working as designed.

---

## SECTION E — OUR OWN CEILING

### E1. Convex limits

- **Action execution ceiling: 10 minutes**, stated at
  [convex/crons.ts:18](../convex/crons.ts#L18) and
  [convex/discoveryPipeline.ts:101](../convex/discoveryPipeline.ts#L101).
- **16 MB read cap per function execution**, which already broke a count-by-scan
  at ~12,000 rows and forced the stored counters
  ([convex/schema.ts:305-315](../convex/schema.ts#L305)).
- Budgets leave headroom: sweep 480 s of 600 s, deep-eval 420 s of 600 s.

**The last sweep took 308,513 ms — 5.14 minutes, 64% of its 480 s budget and 51%
of the hard ceiling.** It is not currently near death, but it is not far from it.

### E2. Sequential or concurrent?

**Concurrent, bounded at 4.** `withConcurrency`
([:163-183](../convex/discoveryPipeline.ts#L163)) runs a worker pool and never
throws for an individual failure. The backfill loop:

```ts
const offsets = Array.from(                        // :417-419
  { length: SWEEP_CONCURRENCY },
  …
);
await withConcurrency(
  offsets.map((offset) => async () =>
    fetchPage(`sort_by=token_id&sort_order=asc&limit=${PAGE_SIZE}&offset=${offset}`)),  // :425
  SWEEP_CONCURRENCY,                               // :429
);
backfillPages  += offsets.length;                  // :432
backfillOffset += offsets.length * PAGE_SIZE;      // :433
```

### E3. What one sweep actually processes

Measured, from the live `lastSweepSummary` (not estimated):

```
saw 8,098 records; 101 new, 0 re-evaluated;
47 classified, 7,758 pre-filtered out, 293 unclassifiable;
308,513 ms
```

→ **26.2 records/second**, against the **537 records/second** the API served at
concurrency 32 in §D10. **The sweep is running at roughly 5% of the API's
demonstrated capacity.**

### E4. Cron frequency and parallel sweeps

Crons are declared with `crons.interval` ([convex/crons.ts:74-108](../convex/crons.ts#L74)):
sweep 1 h, deep-eval 30 min, icons 12 h, directory refresh 6 h. Convex supports
finer intervals, so **more frequent runs are possible**.

**Parallel sweeps would fight over the cursor.** `backfillOffset` is a single
row keyed `by_key` ([convex/schema.ts:296-321](../convex/schema.ts#L296)), read
at the start of a run and written at the end
(`getDiscoveryState` / `saveDiscoveryState`, [:1136,:1145](../convex/discoveryPipeline.ts#L1136)).
Two concurrent sweeps would read the same offset, walk the same pages, and the
second write would clobber the first — **duplicated work and skipped ranges.**
Safe parallelism needs either offset ranges partitioned per worker or an atomic
claim on the cursor. Neither exists today.

### E5. Every hardcoded limit, with provenance

| constant | value | file:line | sized for the old tier? |
|---|---|---|---|
| `PAGE_SIZE` | 100 | [discoveryPipeline.ts:89](../convex/discoveryPipeline.ts#L89) | **No — still correct.** API-enforced (§D2) |
| `REQUEST_TIMEOUT_MS` | 45,000 | [:90](../convex/discoveryPipeline.ts#L90) | Generous; p100 measured 8.7 s |
| `SWEEP_CONCURRENCY` | **4** | [:99](../convex/discoveryPipeline.ts#L99) | **YES — the biggest stale constant.** Its comment says concurrency 8 "doubled p50 latency for a 24% gain and started timing out"; §D10 measured **32/32 successful, 537 rec/s, zero timeouts** |
| `SEARCH_SWEEP_BUDGET_MS` | 240,000 | [:102](../convex/discoveryPipeline.ts#L102) | Yes — sized against slow paging |
| `SWEEP_TOTAL_BUDGET_MS` | 480,000 | [:103](../convex/discoveryPipeline.ts#L103) | Convex-driven, not tier-driven |
| `DEEP_EVAL_BUDGET_MS` | 420,000 | [:104](../convex/discoveryPipeline.ts#L104) | Convex-driven |
| `TAIL_PAGES` | 3 | [:107](../convex/discoveryPipeline.ts#L107) | **YES** — 300 records/cycle vs ~28 registrations/hour |
| `MAX_RECORDS_PER_SWEEP` | **8,000** | [:120](../convex/discoveryPipeline.ts#L120) | **YES** — memory/time driven, and a suspect for the B4 gap |
| `DEEP_EVAL_BATCH` | 40 | [:122](../convex/discoveryPipeline.ts#L122) | No — third-party bound, not API bound |
| `MAX_PAGES_PER_TERM` | **5** | [:223](../convex/discoveryPipeline.ts#L223) | **YES** — truncates `earn` (5,207→500) and `defi agent` (590→500) |
| `SEARCH_VOCABULARY` | 53 terms | [:199-220](../convex/discoveryPipeline.ts#L199) | 6 terms return zero results |
| `PROBE_TIMEOUT_MS` | 8,000 | [liveness.ts:57](../convex/lib/liveness.ts#L57) | **No — third-party, unaffected** |
| `MAX_ATTEMPTS_PER_AGENT` | 6 | [liveness.ts:59](../convex/lib/liveness.ts#L59) | **No — third-party** |
| `FETCH_TIMEOUT_MS` | 10,000 | [registrationFile.ts:59](../convex/lib/registrationFile.ts#L59) | **No — third-party** |
| `MAX_REGISTRATION_BYTES` | 512 KB | [registrationFile.ts:61](../convex/lib/registrationFile.ts#L61) | No |
| `LIVENESS_RECHECK_AFTER_MS` | 24 h | [pipelineStatus.ts:77](../convex/lib/pipelineStatus.ts#L77) | No |
| `REEVALUATE_REJECTED_AFTER_MS` | 14 d | [pipelineStatus.ts:88](../convex/lib/pipelineStatus.ts#L88) | No |
| `DELIST_AFTER_CONSECUTIVE_FAILURES` | 3 | [pipelineStatus.ts:67](../convex/lib/pipelineStatus.ts#L67) | No |

**Also stale: the header comments.** [discoveryPipeline.ts:28-31](../convex/discoveryPipeline.ts#L28)
and [crons.ts:10-19](../convex/crons.ts#L10) quote "289,938 identities",
"600/min, 100,000/day", and "0.180 pages/s". All three are now wrong
(296,500 / 3,000/min / 3,000,000 per day / 7.5 pages/s measured).

**One correction to my own earlier reading in this session:** an unfiltered test
of `sort_by=token_id&sort_order=asc` showed 35/50 duplicate records across
adjacent pages, which looked like it invalidated the backfill's stability claim
at [schema.ts:288-295](../convex/schema.ts#L288). **It does not.** Re-run with the
pipeline's real query shape (`chain_id=56` included), 10 pages drained
**1,000 records, 1,000 unique, 0 duplicates**, ascending cleanly 0 → 1,816.
token_id collides *across* chains, not within one. **The backfill's stability
claim is correct as written.**

---

## SECTION F — THE STRATEGIC QUESTION

### F1. Pass rate among evaluated candidates

```
published / ledger        =     11 / 216,679  =  0.0051%   (1 in ~19,700)
published / prefilter survivors =  11 /   5,797  =  0.19%
prefilter survival        =  5,797 / 216,679  =  2.675%
classifier survival       =    118 /   5,797  =  2.035%
publish rate among deep-evaluated = 11 / 118  =  9.32%
```

**Is it steady or concentrated?** Concentrated, in two ways:

1. **By category, evenly** — rebalancing 4, health-factor 3, grid-trading 2,
   yield 2. No category dominates, which is what the Agent Diversity rubric wants.
2. **By liveness, severely** — of the 118 that reach the live bands, only
   **16 are `verified-live`**; 73 unreachable, 29 advertise no endpoint. Liveness,
   not classification, is the final cut.

**By token-id slice: UNVERIFIED.** The ledger is not queryable by id range
without a full scan (16 MB cap). What *is* observable from §D6 is that the
high-value agents cluster in low-to-mid token ids (43129, 45381, 45650, 85400,
96231, 113284) *and* recent ones (259574, 265375, 269223/4/8, 302257) — so the
value is **not** concentrated in newer registrations, and a tail-only strategy
would miss much of it.

### The measurement that reframes the question

I took the pipeline's own tight vocabulary, drained it, kept the agents
advertising A2A or MCP, and fetched 8004scan's own health data for each:

```
tight vocabulary union (20 precise terms)        417 chain-56 agents
  advertising A2A or MCP                         263
  >=1 service HEALTHY per 8004scan                81

full 53-term vocabulary union                  2,127 chain-56 agents
  advertising >=1 protocol                      1,363
  >=1 service HEALTHY per 8004scan                435
  overall_status: healthy 114 / degraded 867 / unhealthy 205 / none 176

Dolphin publishes                                  11
```

Then I checked, against the live ledger, whether the best of them had ever been
seen. **Every single one had already been evaluated and probed:**

| token | name | ledger liveness | ledger verdict |
|---|---|---|---|
| 45650 | V3 Pools powered by HeyAnon | `verified-live` | **listed**, rebalancing, confirmed |
| 43129 | Venus powered by HeyAnon | `verified-live` | listed via manual include, health-factor, `likely` |
| **259574** | **RangeKeeper** — *"Moves your liquidity back into range so it keeps earning"* | **`verified-live`** | **not-listed — "classifier did not place this agent in any of the four graded categories"** |
| **45381** | **Aave powered by HeyAnon** | **`verified-live`** | **not-listed — same reason** |
| 85400 | Aster powered by HeyAnon (perps) | `verified-live` | not-listed (defensible — perps is off-domain) |
| 96231 | HODL.DANCE memecoin launchpad | `verified-live` | not-listed (correct) |

**Coverage is not the problem.** The investigation's premise — *"genuine agents
that WOULD pass the filter are sitting in the part we have never reached"* — is
**falsified for the high-value slice**. The pipeline has already seen, fetched,
and successfully probed these agents. They are absent from the catalog because
the classifier scored them below `CONFIRMED_SCORE`, not because the sweep never
got to them.

The filter is doing exactly what §A says it does, and the spam it cuts (BORT
collectibles, "Autonomous trading agent (simple-mode)" campaigns, EvoEvo
personas) is correctly cut — I saw all three families in the healthy-endpoint
list and every one was rightly excluded. RangeKeeper and Aave-HeyAnon are a
different case: real, live, in-category agents whose descriptions are too terse
to hit a *defining* phrase. **Per your instruction I have changed nothing and
propose no classifier change here** — I am reporting that this, not coverage, is
where the missing agents are.

### F2. Which strategy yields more real agents before Sep 9?

**Option 1 — exhaustive sweep of the 79,779 never-evaluated records.**
Applying the ledger's own observed rates:

```
79,779 unevaluated
  × 2.675%  prefilter survival        =  2,134 survivors
  × 2.035%  classifier survival       =     43 reaching live bands
  × 9.32%   publish rate              =      4 newly published agents
cost: 2,966 requests, ~7 minutes wall, 0.099% of daily quota
```

**≈ 4 additional agents.**

**Option 2 — targeted search across the four categories' vocabulary.**
The 53-term vocabulary **already runs every cycle**
([:373-384](../convex/discoveryPipeline.ts#L373)) and, per §D6, already drains
51 of its 53 terms completely. Its 2,127-agent union is therefore already in the
ledger — confirmed by spot-check: every agent I tested was already evaluated.
The only genuinely unfetched search records are the truncation losses:

```
"earn"        5,207 total - 500 fetched  =  4,707 never seen via search
"defi agent"    590 total - 500 fetched  =     90 never seen via search
                                            ─────
                                            4,797 records
  × 2.675% × 2.035% × 9.32%              =      0.02 agents
```

**≈ 0 additional agents** — and even that overstates it, because the backfill
covers the same records independently. Both terms are also the *loosest* in the
vocabulary, so their yield would be below the ledger average, not at it.

**Neither strategy is worth much, and that is the finding.** The honest ranking:

| strategy | new agents | cost |
|---|---|---|
| Exhaustive sweep of the remaining 27% | **~4** | 7 min, 0.1% quota |
| Raise `MAX_PAGES_PER_TERM` to drain search fully | ~0 | trivial |
| **Neither — the gap is downstream of both** | **~424 sit between "healthy endpoint" (435) and "published" (11)** | — |

**Exhaustive sweep wins on the narrow question, and it is now so cheap
(~7 minutes, one tenth of one percent of quota) that it is worth doing simply to
retire the open question.** But it buys ~4 agents. The ~424-agent gap between
*agents with a healthy endpoint in our own vocabulary* and *agents we publish*
is not a coverage gap at all, and no amount of additional fetching closes it.

### F3. If targeted search wins, the smallest change to feed it in

Targeted search does **not** win — it is already wired and already draining.
For completeness, the smallest changes that would act on what this audit found,
**described, not built, and none of them touching the classifier**:

1. **Update `SCAN8004_API_KEY` in Convex to the new key.** One env var. Without
   it the pipeline dies silently when revocation propagates (§0). This is the
   only urgent item in the document.

2. **Raise `SWEEP_CONCURRENCY` from 4 to ~16–32**
   ([:99](../convex/discoveryPipeline.ts#L99)), and update the comment above it,
   which now documents a measurement the new tier contradicts. Measured 32/32
   successful at 537 rec/s vs the current 26 rec/s. One constant; the retry and
   failure-swallowing behaviour of `withConcurrency` already covers the transient
   `ECONNRESET` seen once at concurrency 12.

3. **Raise `MAX_PAGES_PER_TERM` from 5 to ~53** ([:223](../convex/discoveryPipeline.ts#L223))
   so `earn` drains fully. Costs 47 extra requests per cycle. Low yield, but the
   cost is now genuinely nil.

4. **One-off full backfill.** With (2) in place a complete walk is ~7 minutes,
   inside a single Convex action's 10-minute ceiling — so the resumable-cursor
   machinery is no longer load-bearing for a first pass. This retires the B4
   coverage gap definitively rather than leaving it UNVERIFIED. Note E4: do not
   run it concurrently with the hourly sweep, which shares the cursor.

5. **Investigate the 79,779 gap before assuming a re-walk fixes it.** If
   `MAX_RECORDS_PER_SWEEP` truncation combined with unconditional
   `backfillOffset` advancement ([:433](../convex/discoveryPipeline.ts#L433))
   is dropping ranges, a faster sweep reproduces the same holes faster.

6. **Use `health_status` from the sweep response to prioritise the deep-eval
   queue** — not to replace the probe (§A4 documents why 8004scan's flag is not
   trustworthy alone), but to order `selectDeepEvaluationBatch`
   ([:954](../convex/discoveryPipeline.ts#L954)) so candidates 8004scan already
   believes are healthy get probed first. This targets the real bottleneck (C2)
   without loosening any gate. **Note: this requires a detail call per candidate
   (§D9), so it is not free** — but detail calls now cost ~134 ms and 1/3,000th
   of a minute's quota.

---

## Summary — the four things that matter

1. **The API upgrade is real and large: 3,000/min, 3,000,000/day, `offset`
   pagination works, `chain_id` works, concurrency 32 is served, and a full
   296,500-record BSC walk now takes ~7 minutes for 0.1% of daily quota** —
   down from an effective 33 days at the current configuration.

2. **It does not fix the bottleneck.** The stages that decide publication —
   registration cross-check and liveness probe — make **zero** 8004scan requests
   and are gated entirely on third-party servers at 8 s and 10 s timeouts. A
   quota increase buys nothing there.

3. **Coverage is not where the missing agents are.** 73.1% of the registry is
   already evaluated, and every high-value agent I could find via the
   vocabulary — RangeKeeper, Aave-HeyAnon, Venus-HeyAnon, V3Pools-HeyAnon — had
   **already been fetched, cross-checked and successfully probed**. The ones
   absent from the catalog were rejected by the classifier, which you have ruled
   out of scope for this audit. 435 agents in our own vocabulary have a healthy
   endpoint; 11 are published.

4. **One urgent action: put the new key in Convex.** Both keys answered at probe
   time, but if the stored one is the revoked one, the crons will fail silently
   — `fetchPage` throws and `withConcurrency` swallows it, so a dead key looks
   exactly like an empty registry.

---

*Probe scripts (`probe.mjs`–`probe6.mjs`) are in the session scratchpad at
`…/f153e891-…/scratchpad/`, outside the repo and untracked, along with the
extracted key file. Delete the scratchpad to remove both. No file in the repo
was modified by this audit.*
