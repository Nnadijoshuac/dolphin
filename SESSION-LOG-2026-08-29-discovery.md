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
