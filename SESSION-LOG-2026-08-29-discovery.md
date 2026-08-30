# Session log — automated agent discovery (2026-08-29)

Running log for the session that replaces hand curation with an automated
discovery pipeline. Every number below came from a live command run against the
real 8004scan API on 2026-08-29, not from a code read or an estimate. The
finished summary lives in `HANDOVER.md`; this file is the working record of how
each conclusion was actually reached.

---

## Task 0 — investigation, before any design

### The registry, measured

```
GET https://api.8004scan.io/api/v1/agents?chain_id=56&is_testnet=false&limit=2&offset=0
-> HTTP 200, {"items": [...], "total": 289938, "limit": 2, "offset": 0}
```

**289,938 ERC-8004 identities on BSC mainnet.** Highest token id observed:
`317382` (so the id space is sparser than the count — roughly 27k ids are gaps).

### Pagination

- `limit` caps at **100**. `limit=200/500/1000` all return **HTTP 422**.
- `offset` works to the end of the set (`offset=289000` returns rows).
- `sort_by` accepts `token_id`, `created_at`, `total_score`, `name`, with
  `sort_order=asc|desc`. **`sort_by=token_id&sort_order=asc` is the important
  one**: it makes offset pagination stable, because an ERC-8004 token id only
  ever increases, so new registrations append at the end and never shift the
  offsets of pages already walked. That is what makes a resumable cursor sweep
  correct rather than merely plausible.
- `sort_by=created_at&sort_order=asc` returned the exact same first page as
  `token_id&asc` (ids 0, 1, 2) — the two orderings agree.

### Rate limits — confirmed from response headers, not from notes

```
x-ratelimit-limit-minute: 600      x-ratelimit-remaining-minute: 599
x-ratelimit-limit-day:  100000     x-ratelimit-remaining-day:  99828
```

The 600/min · 100,000/day figure carried in `HANDOVER.md` is correct and live.

### **The rate limit is not the constraint. Latency is.** (the key Task 0 finding)

A full sweep is 289,938 ÷ 100 = **2,900 requests** — 2.9% of the daily budget.
Trivially affordable in request terms. But measured wall time is not:

| shape | measurement |
|---|---|
| `limit=100`, sequential, assorted offsets | 5.3s – 25.3s per page |
| `limit=100`, 20 random page offsets, concurrency 4 | p50 **18.7s**, p90 35.3s, max 59.6s |
| effective page throughput at concurrency 4 | **0.180 pages/s** |
| **implied full 2,900-page sweep** | **≈ 268 minutes (4.5 hours)** |

Raising concurrency does not fix it — the bottleneck is server-side offset
scanning, not our request rate:

| concurrency | effective throughput | timeouts (60s) |
|---|---|---|
| 2 | 0.07 req/s | 3 / 24 |
| 4 | 0.17 req/s | 0 / 24 |
| 8 | 0.21 req/s | 1 / 24 |

At concurrency 8 the p50 *doubled* (13s → 31s) for a 24% throughput gain, and
requests started timing out. **Concurrency 4 is the sweet spot** and is what the
pipeline uses.

A Convex action's ceiling is 10 minutes. 4.5 hours does not fit in one action,
so **a full sweep must be incremental across cron cycles** — this is settled by
measurement, not preference.

### Random sample of 100 real records — read by hand

Drawn as a **cluster sample**, stated honestly: 20 random page offsets across
the full 0–289,938 range at `limit=100` (2,000 pooled records), then a random
100 shuffled out of that pool. A pure simple-random sample (100 independent
`limit=1` fetches at random offsets) was attempted first and abandoned — it
measured p50 13s / p90 60s per request with repeated timeouts, because the API
scans to the offset regardless of limit.

**Of 100 records read by hand, 0 were a real, single-purpose agent in any of the
four graded categories.** The breakdown:

| what it was | count |
|---|---|
| `Ave.ai Trading Agent` — one identical templated description, mass-registered | ~35 |
| EvoEvo persona agents (`"An EvoEvo AI Agent focused on sports."` and LLM persona flavour text) | ~45 |
| `Agent #NNNNN` with an empty description | 6 |
| numeric garbage (name `"01166"`, description a 77-digit string) | 6 |
| `X.agent on Termix Platform` | 3 |
| one each: Debot, Q402 (Quack AI), Purr-Fect Claw, `BigApple` / "Citizen of XTown" | 4 |

Aggregates over the full 2,000-record pool:

```
description null/empty  :  6.8%      supported_protocols empty : 51.0%
description < 30 chars  :  9.9%      x402_supported true       : 16.8%
name matches /^Agent #/ :  6.7%      is_verified true          :  0.0%
image_url null          : 13.9%      total_feedbacks > 0       :  0.0%
health_score present    :  7.5%      star_count > 0            :  0.1%
```

Six description templates account for **~85% of the registry**:
`Ave.ai` (630/2000), the EvoEvo family (~867/2000), Debot (48), Purr-Fect Claw
(42), Quack AI (28), Termix.

**What this means for the design.** The real/spam ratio is not "mostly spam" —
it is *overwhelmingly* spam, and the base rate of a real four-category DeFi
agent is well under 1 in 100. Dolphin currently lists 11. So a blind sweep of
289,938 records spends 4.5 hours of API latency to surface, at that base rate,
maybe a few dozen candidates. **Precision matters more than sweep coverage**,
and a topical gate — does this text mention DeFi at all — is the single highest-
value cheap filter, because an agent that never says liquidity, lending,
liquidation, yield, grid or a protocol name cannot be in one of the four
categories.

### The finding that changed the architecture: search reports `total`

8004scan's `search=` parameter returns a `total` alongside its items, so the
size of the topically-relevant slice can be measured directly rather than
guessed:

```
"health factor"           total=16     "grid trading"          total=9
"concentrated liquidity"  total=20     "lp position"           total=5
"rebalance"               total=42     "venus"                 total=13
"liquidation"             total=325    "pancakeswap"           total=56
"yield"                   total=225    "aave"                  total=3
"apy"                     total=341    "liquidity"             total=325
```

A **50-term DeFi vocabulary sweep** was then run for real:

```
terms=50  requests=65  wall=102s  UNION = 1,446 unique agents
```

**1,446 candidates for 65 requests in 102 seconds**, versus 2,900 requests and
4.5 hours to see all 289,938. The search path reaches the topically relevant
slice roughly **45× cheaper**, and it is the same API and the same key.

It also immediately surfaced real agents Dolphin has never listed — visible in
just the first two results of each query:

```
315943  AiKi Venus Health Factor Guardian
315944  AiKi PancakeSwap LP Rebalancer
315945  AiKi PancakeSwap Grid Trader
315946  AiKi Venus Yield Optimiser
304494  Brain on BNB — Portfolio Rebalance Pricer
269228  Health Factor Monitor
303779  marketplace-operated-grid-pl…
```

The prior sessions' 5-query search was simply too narrow, exactly as the
2026-08-28 "Grid Trader" episode already suggested.

Spam *inside* the topical union looks different from registry-wide spam — it is
DeFi-flavoured templating, which is why the pre-filter needs its own signatures
for it rather than reusing the registry-wide ones:

```
131  "Autonomous trading agent (simple-mode). AI agent for autonomous DeFi t…"
 44  "AI agent for liquid-staking"
 38  "BUILD# autonomous trading agent. Trades Aster DEX perps via EIP-#…"
 16  "Risk management AI for DeFi protocols and automated rebalancing."
 15  "gm"        12 "defi"        8 "GFDG"
 15  BORT Liquidity Oracle ##  /  BORT Protocol Sage ##  /  BORT Yield Weaver ## …
```

### Detail endpoint — what liveness can actually be built on

`GET /api/v1/agents/56/{tokenId}` carries far more than the list item, including
three separate endpoint fields not present in the list shape:

```
mcp_server, mcp_version, a2a_endpoint, a2a_version, agent_url,
services, health_status, health_score, is_endpoint_verified,
endpoint_verified_domain, endpoint_verification_error, endpoint_last_checked_at,
agent_type, categories, tags, supported_protocols, agent_wallet, is_active
```

`categories` and `tags` came back `[]` on every agent checked — 8004scan does
not classify into anything usable, confirming the prior sessions' finding.

`health_status` is 8004scan's **own cached** probe (`"(cached)"` appears in its
messages, and `checked_at` was up to 12 hours stale on the agents inspected).
That is exactly the second-hand signal the brief says not to substitute for our
own check.

### Liveness probing — proven working, live

Real probes run against real advertised endpoints, this session:

```
265375 BNB LP Range Rebalancer   A2A card  -> 200 in 2291ms  name="bnbLpRangeRebalancer-agent" skills=2 v0.3.0   LIVE
269228 Health Factor Monitor     A2A card  -> 200 in 1778ms  name="healthmon-agent"           skills=2 v0.3.0   LIVE
304494 Brain on BNB Rebalancer   A2A card  -> 200 in 1217ms  name="Brain On BNB AI…"          skills=7 v0.3.0   LIVE
45650  V3 Pools HeyAnon          MCP init  -> 201 in 1758ms  serverInfo=heyanon-erc8004-v3pools 1.0.0           LIVE
45381  Aave HeyAnon              MCP init  -> 201 in 1265ms  serverInfo=heyanon-erc8004-aave    1.0.0           LIVE
```

Two protocols, both answering. Note **304494's card resolved at the spec's
`/.well-known/agent-card.json` path even though its registration advertises the
`/a2a` base** — a probe that only fetched the advertised URL verbatim would have
called a live agent unreachable. Note also that 8004scan reports 304494 as
`overall_status: "unhealthy"`, `health_score: 0`, while our own probe found it
answering — a concrete instance of the indexer being wrong, which is the whole
argument for probing directly.

Not every agent has an endpoint to probe at all: `12046` (roboclaw, the
editorial "Yield Maximizer") and `315943` have `mcp_server`, `a2a_endpoint`,
`agent_url` and `services` all null. "No endpoint advertised" is a third
outcome, distinct from "unreachable", and the pipeline records it that way.

### Task 0.5 — registry fragmentation. The brief's suspicion is correct.

Two separate identity registries exist on BNB Chain. Both were read directly
on-chain via `eth_call` against a BSC RPC — not taken from a search result, per
AGENTS.md §9's rule about contract addresses:

| contract | `name()` | `symbol()` | size |
|---|---|---|---|
| `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `"AgentIdentity"` | `AGENT` | 289,971 indexed by 8004scan |
| `0xfA09B3397fAC75424422C4D28b1729E3D4f659D7` | `"BRC8004 Identity Registry"` | `BRC8004` | `totalSupply() = 26` |

**8004scan covers the first and not the second.** Verified three ways rather than
assumed: all **3,446** records across both Task 0 samples carry
`contract_address: 0x8004a169…a432` and nothing else; `search=BRC8004` returns
`total=0`; and passing `contract_address=0xfA09…59D7` as a filter is silently
**ignored** — it returns the full 289,971-record set, all from the other
contract. (Worth knowing on its own: 8004scan's list endpoint accepts unknown
query parameters without erroring, so a filter that looks like it works may not.)

The first registry is the one `src/services/chain.ts`'s
`verifyAgentRegistration()` already reads, so **Dolphin's own independent
on-chain check and 8004scan's coverage do line up** — that part needed
confirming and is fine.

**But BRC8004's 26 agents are invisible to Dolphin today, and at least one of
them is real and in a graded category.** The registry has no ERC721Enumerable
`tokenByIndex`, so it was walked by `ownerOf`/`tokenURI` over ids 0–40; 26 tokens
answered. Reading their registration URIs directly:

```
token 25  data:application/json,{"name":"lista-earn-autocompounder",
          "description":"Autonomous stablecoin-vault rotation agent on ListaDAO Earn",
          "strategy":"stablecoin-vault-auto-rotate-highest-net-apy",
          "protocol":"ListaDAO Moolah ERC-4626", ...}          <- a real YIELD agent
token 21  https://api.fengshuibnb.com/master-xuan/.well-known/agent-card.json
token 26  https://weavr-eight.vercel.app/.well-known/agent-registration.json
token 23  https://raw.githubusercontent.com/nickthelegend/xorr-agent-backend/.../agent_card.json
token 11  data:application/json,{"name":"0xUniko","services":[{"name":"MCP",
          "endpoint":"npx @bnb-chain/mcp@latest"}]}
tokens 15-20  six registrations all pointing at one shared registration file
token 12  https://example.com/agent.json                        <- placeholder
token  1  {"name":"Test","description":"A test agent for BRC8004 protocol demonstration"}
```

Registration URIs come in four transports — `ipfs://`, `https://`,
`data:application/json;base64,` and raw `data:application/json,` (both
percent-encoded and not). The tokenURI cross-check in Task 2 has to handle all
four, and that is true of the main registry as well.

**DECISION: BRC8004 is swept and evaluated, but its agents are never
auto-published this session.** The reason is a concrete key collision, not
caution for its own sake: Dolphin's catalog is keyed on a **bare tokenId**
throughout — `agentDirectory` and `discoveredAgents` both index
`["chainId", "tokenId"]`, and `agents.getAgent` resolves a reference by splitting
on `:` and taking the last segment. BRC8004 token 25 and AgentIdentity token 25
are different agents with the same id. Publishing both would silently merge them.
Fixing that properly means a registry-qualified key that reaches into how both
frontends build and parse agent ids — which is UI code AGENTS.md §11 puts
off-limits by default. So `agentCandidates` carries `registryAddress` from the
start and records BRC8004 agents honestly as pending with that exact reason,
which leaves the next session a ready-made list and a one-line change rather than
a rediscovery job.

### Registry growth rate — measured, for the cadence calculation

`total` moved from **289,938 to 289,971 in roughly 70 minutes** across this
session's own calls: **~28 new registrations per hour**. That is the number the
new-registration tail sweep is sized against, not a guess.

### Answers to the four questions Task 0 asks

1. **Real/spam ratio in a random sample**: 0 of 100 were a real four-category
   agent. ~85% of the registry is six mass-registration templates.
2. **Signals that separate them**: an exact-duplicate normalised description
   shared with hundreds of other registrations; an empty or sub-30-character
   description; a name that is the bare `Agent #<id>` default or pure digits; a
   collectible series name (`BORT <thing> ##`); and above all the absence of any
   DeFi vocabulary whatsoever.
3. **Is a full sweep realistic in one pass?** **No.** 2,900 requests is only
   2.9% of the daily budget, but at a measured 0.180 pages/s it is 4.5 hours of
   wall time against a 10-minute action ceiling. It must be incremental.
4. **So the sweep is three paths, not one**: a vocabulary search sweep (cheap,
   high-yield, every cycle), a descending new-registration tail sweep (bounded
   time to first sight for anything newly registered), and an ascending
   cursor-resumable backfill of the whole registry (completeness, budgeted per
   cycle).

---

# Continuation — 2026-08-30: Tasks 1–6 built, wired and run live

Everything below is output from real commands against the real deployment and
the real 8004scan API on 2026-08-30. No projections.

## Where this picked up

Tasks 0 and 0.5 were already logged above. `convex/lib/prefilter.ts` (Task 1)
and `convex/lib/agentScoring.ts` (Task 2's scorer) existed but were **wired into
nothing** — no caller anywhere, and both referenced two modules that did not
exist (`pipelineStatus.ts`, `registrationFile.ts`). Nothing had ever run.

## A blocker found before anything could be verified

`npx convex dev` refused the whole deployment:

```
InvalidModules: The environment variable name 8004SCAN_API_URL is invalid.
Environment variable names must begin with a letter and may only include
characters a-z, A-Z, 0-9, and underscores.
```

**The Convex backend has been un-pushable since commit `b47aeba`** — no backend
change since then could have reached the deployment. Renamed to
`SCAN8004_API_URL`. The value was never readable under the old name, so every
call site had been silently running on its hardcoded default.

## Stage 1 — the pre-filter, over a real batch

Search + tail sweep, one run, 71 requests, **62 seconds**:

```
unique records seen     2,255
rejected by pre-filter  1,331   (59.0%)
  campaign-template       645
  persona-agent           225
  empty-description       172
  collectible-series      160
  off-topic               112
  numeric-noise            11
  repeated-token            6
survivors to classifier   924
```

Over the backfill path the ratio is far harsher, which matches Task 0's finding
that the topical slice is where the real agents are. One backfill run of 8,300
records: **8,084 pre-filtered out (97.4%), 216 unclassifiable, 0 classified into
any of the four categories.** The search path found 85 in 2,255. That is the
whole argument for precision over sweep coverage, now measured on both paths.

## Stage 2 — the classifier, over the 924 survivors

```
classified into one of the four    85
  yield          51
  rebalancing    14
  health-factor  13
  grid-trading    7
rejected as not one of the four   839
```

### The tricky cases, run WITHOUT the denylist telling it the answer

```
113284 Topaz Agent        -> REJECTED  score -15
   -8  names 2 capabilities outside all four categories (gauge vote, bribe)
  -15  describes 12 distinct actions -> general-purpose capability catalogue
6428  Tator Trader        -> REJECTED  score -48
  -32  names 8 outside all four (bridge, perp, prediction market, launch token...)
  -18  describes 13 distinct actions
292939 bnb-grid-trader-test.agent -> grid-trading, likely (KEPT)
   -6  name contains "test"   <- the old filter HARD-REJECTED this real agent
```

**Both manual-denylist entries are now caught by the classifier on their own
evidence**, and the real grid-trading agent the old `\btest\b` rule would have
thrown away is kept. The denylist is retained anyway (see Task 6 below).

### The honest cost of the breadth penalty

The same penalty also demotes the HeyAnon "safe execution layer" family, which
are genuine single-protocol agents that happen to enumerate a whole action set:

```
45381 Aave powered by HeyAnon  -> REJECTED (11 -> 2, 10 distinct actions)
43129 Venus powered by HeyAnon -> health-factor, likely (5)
```

45381 is unaffected in practice (hand-curated editorially, never routed through
this gate). 43129 was previously listed by the old keyword sync and would have
been dropped — it was restored through the manual `include` valve with its
reasoning recorded. **This is a real limitation, not one tuned away**: the same
penalty that catches Topaz and Tator unaided also catches these.

## Stage 2b — the registration-file cross-check

Over 87 deep-evaluated candidates: **85 fetched, 2 unreachable, 0 with no
tokenURI.** 6 showed drift between the agent's own current file and 8004scan's
cached copy. Both unreachable cases were `ipfs://` (public gateway refusals).

## Stage 3 — liveness, probed directly

Across the 87 deep-evaluated candidates:

```
verified-live                 16
unreachable                   44
  - DNS / connection          26
  - HTTP 4xx/5xx              14
  - HTTP 200, not an A2A card  4
no-endpoint-advertised        27
```

The 4 "200 but not a card" are agents whose endpoint is alive but does not serve
what it advertises — e.g. token 315943 returns a real capability descriptor at
its `a2a_endpoint`, but with no `name` field it is not an A2A agent card.
Holding those pending is deliberate: "verified live" means the agent answered
**in the protocol it advertises**, not that some HTTP server responded.

## Stage 4 — icons

```
8004scan-image        64
generated-fallback    50
registration-file     14   <- icons 8004scan's cache never had
```

**All 16 listed agents now render from Dolphin's own storage. Zero hotlinks,
zero blanks.** Token 45381 is the one agent that fell through to the generated
fallback despite having an 8004scan image URL: that URL 307-redirects to
`blob.8004scan.app` and the fetch did not land an allowed image content-type.
Worth revisiting; it is one agent, and the fallback is honest in the meantime.

## Task 5 — submission, end to end

```
submitAgent(315943) -> {"state":"under-review", ...}    (returns immediately)
...seconds later:
getSubmissionStatus(315943) -> {
  "state":"held-pending",
  "category":"health-factor", "confidence":"confirmed",
  "liveness":"unreachable",
  "reason":"The agent's advertised endpoint did not answer a
            protocol-appropriate probe, so Dolphin cannot confirm it works."
}
```

A confirmed classification and still not listed, because the endpoint did not
answer in its advertised protocol. That is the path working, not failing.

## Task 6 — the safety valve, both directions

```
setManualOverride(6443, "exclude")  -> graded listings 17 -> 16, 6443 gone
setManualOverride(43129, "include") -> re-evaluated, published; liveness still
  enforced (MCP initialize 201, serverInfo=heyanon-erc8004-venus)
```

6443's exclusion is a real quality decision, not a test artefact: tokens 6441
and 6443 share an owner (`0x9c2499e3...a8a360`), a byte-identical description
opening, **and the same A2A endpoint URL**. Two identity NFTs pointing at one
service are one listing, not two.

## Three bugs the live runs found that a code read would not have

1. **An unbounded backfill killed the Convex action with no error message** — it
   accumulated tens of thousands of records in memory and judged and persisted
   them all in one invocation. Capped at 8,000 records/sweep; the offset
   persists, so the next cycle resumes exactly where the last stopped.
2. **The incremental skip never fired for rejected records.** It was gated on
   `lastDeepEvaluatedAt !== null`, which is never true for a pre-filter
   rejection, so every rejected record was re-judged and re-patched on every
   cycle — the exact waste the ledger exists to prevent. Measured re-writing
   **8,296 of 8,300** records it had judged an hour earlier. After the fix, the
   same search sweep: **2,247 of 2,255 skipped, 8 new, 0 rewritten.**
3. **`getPipelineStats` exceeded Convex's 16MB per-execution read cap** once the
   ledger passed ~12,000 rows. Replaced with counters maintained on insert and
   on status transition, plus a paginated recount action for repair.

## Measured throughput, for the cadence calculation

```
search sweep      53 terms -> 71 requests -> 2,255 records in 62s
backfill          80 pages in 196s  =  0.41 pages/s
                  (Task 0 measured 0.180 pages/s; the API is faster today)
full registry     2,916 pages -> ~2 hours of pure wall time
per-cycle bound   8,000 records ~= 80 pages, so ~36 hourly cycles per full pass
registry total    291,543 (was 289,938 when Task 0 measured it)
```

## The funnel as it now stands

```
registry                 291,543
ledger (evaluated)        50,044
  rejected pre-filter     45,781
  rejected classifier      4,176
  pending                     76
  published                   11
catalog (listAgents)          17   (16 graded + 1 monitoring, deliberately
                                    not one of the four graded categories)
```
