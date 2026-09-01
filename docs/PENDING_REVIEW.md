# Pending Review — the 108-candidate pool, by hand

Read-only. No classifier, prefilter, liveness probe or publish gate was changed.
Nothing was published. `setManualOverride` was **not** run.

Generated 2026-09-01 from the live Convex deployment
(`discoveryPipeline:listCandidates`) plus 8004scan detail reads for the
advertised-endpoint column. Every field is quoted from the ledger row or the
live API — nothing is inferred.

---

## KEY CONFIRMATION

**Does the Convex `SCAN8004_API_KEY` match prefix `8004_74INd87`? — YES.**

Verified without printing the key: the stored value is 46 bytes, its first 12
characters equal `8004_74INd87`, and a byte-wise `cmp` against the key you
pasted earlier reports **identical**. The key has been updated; the
silent-death risk flagged in the previous audit is closed.

---

## 4. THE CEILING, UP FRONT

The pool is **108** now, not 107 — one candidate arrived since the audit.

| pending livenessState | count |
|---|---|
| **`verified-live`** | **5** |
| `unreachable` | 74 |
| `no-endpoint-advertised` | 29 |
| **total** | **108** |

**Only 5 pending candidates are `verified-live`**, distributed across the four
graded categories like this:

| category | verified-live pending |
|---|---|
| grid-trading | 2 |
| rebalancing | 1 |
| health-factor | 1 |
| yield | 1 |
| **total** | **5** |

### The realistic ceiling on this review is 5 agents — and only 5

That is the honest number, and it is worth being blunt about why it cannot be
larger:

- The other **103** pending candidates fail the liveness half of the gate
  (74 unreachable, 29 advertising no endpoint). **A manual include does not
  relax that half** — see §6. Vouching for them would change nothing.
- Of the **18** `verified-live` candidates sitting in `rejected-classifier`
  (§5), **17 carry `category: null`**, and `resolveStatus` rejects on a null
  category *before* it ever consults `manuallyIncluded` (§6). **The
  manual-include mechanism as written cannot promote them.**
- The 18th (token `6443`, Sperax Intelligence) is
  `yield`/`confirmed`/`verified-live` but was deliberately excluded as a
  **duplicate registration** of token `6441`, which is listed. Promoting it
  would list one agent twice.

So: **5 promotable candidates, all already at `likely` confidence with a live
endpoint** — exactly the shape of the token 43129 precedent you cited.

Against 11 currently published, a successful review of all five would take the
discovered catalog from **11 → 16 (+45%)**, adding grid-trading +2,
rebalancing +1, health-factor +1, yield +1 — which also evens out the
per-category spread the Agent Diversity rubric grades.

### The five, at a glance

| tokenId | name | category | score | runner-up | confidence |
|---|---|---|---|---|---|
| `269233` | BNB Grid Trader (test) | grid-trading | 15 | none | likely |
| `303779` | marketplace-operated-grid-planner | grid-trading | 9 | none | likely |
| `45422` | Beefy powered by HeyAnon | yield | 8 | none | likely |
| `310460` | Brain on BNB — PancakeSwap Fee Tier Placement | rebalancing | 7 | yield @ 1 | likely |
| `266933` | BNB Lending Guardian | health-factor | 5 | none | likely |

Every one of them is `likely` because it scored under `CONFIRMED_SCORE = 12`,
or cleared it without the `CONFIRMED_MARGIN = 6` separation — not because
anything about them failed. Full evidence per candidate in §A.

---

## 3. BRC8004 REGISTRY-COLLISION HOLDS — **there are none**

Checked every pending row's `registryAddress` against the primary AgentIdentity
registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`:

```
primary registry      108
BRC8004 / off-primary   0
```

**All 108 pending candidates are held on merit, not on the registry collision.**
Nothing needs separating out. The `offPrimaryRegistry` branch in `resolveStatus`
([convex/lib/pipelineStatus.ts:139-145](../convex/lib/pipelineStatus.ts#L139))
is real and reachable, but no candidate currently sits in it — consistent with
the sweep only ever fetching `chain_id=56` from the primary registry today.

---

## 6. WHAT THE MANUAL-INCLUDE MECHANISM ACTUALLY REQUIRES

### Where it lives

Two halves. **Either alone is sufficient to keep an agent OUT**, but only the
runtime half can let one IN.

**Compile-time half** — [convex/lib/manualExclusions.ts:31-38](../convex/lib/manualExclusions.ts#L31).
Exclusion only; there is no compile-time include list.

**Runtime half** — [convex/discoveryPipeline.ts:1175](../convex/discoveryPipeline.ts#L1175),
a **public mutation**:

```ts
export const setManualOverride = mutation({
  args: {
    tokenId: v.string(),
    override: v.union(v.literal("exclude"), v.literal("include"), v.null()),
    reason: v.string(),
  },
  handler: async (ctx, { tokenId, override, reason }) => {
    const candidate = await ctx.db
      .query("agentCandidates")
      .withIndex("by_token", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .first();
    if (!candidate) {
      throw new Error(`No candidate record exists for token ${tokenId}.`);
    }

    await ctx.db.patch(candidate._id, {
      manualOverride: override,
      statusReason: `Manual override (${override ?? "cleared"}): ${reason}`,
      ...(override === "exclude"
        ? { status: "rejected-classifier" as const }
        : // An "include" or a cleared override does not publish anything by
          // itself - it re-opens the agent for the normal deep evaluation, which
          // still has to find a live endpoint before anything is listed.
          { lastDeepEvaluatedAt: null }),
    });
    …
  },
});
```

### What a human has to supply

Exactly three things: **`tokenId`**, **`override: "include"`**, and a **`reason`
string**. The reason is required, not optional — it is written verbatim into
`statusReason` as `Manual override (include): <reason>`, so it becomes the
public audit trail for the decision.

### What it does — and does NOT do

**An include publishes nothing by itself.** It sets `manualOverride: "include"`
and nulls `lastDeepEvaluatedAt`, which re-queues the candidate at the front of
the deep-evaluation batch (`needsDeepEvaluation` returns `true` for a null
timestamp, [pipelineStatus.ts:200](../convex/lib/pipelineStatus.ts#L200)). The
next `deepEvaluate` run then **re-fetches the registration file, re-scores, and
re-probes the endpoint from scratch** before any status changes.

### Which gates stay enforced

`deepEvaluate` passes the flag through as `manuallyIncluded`
([discoveryPipeline.ts:643-647](../convex/discoveryPipeline.ts#L643)):

```ts
manuallyExcluded:
  candidate.manualOverride === "exclude" ||
  MANUALLY_EXCLUDED_TOKEN_IDS.has(candidate.tokenId),
manuallyIncluded: candidate.manualOverride === "include",
currentlyPublished: candidate.status === "published",
```

and `resolveStatus` consults it in **exactly one place**, the confidence branch
([pipelineStatus.ts:170-183](../convex/lib/pipelineStatus.ts#L170)):

```ts
if (input.confidence !== "confirmed") {
  if (input.manuallyIncluded) {
    return {
      status: "published",
      reason:
        "Classified `likely` rather than `confirmed`, but a human reviewed the agent and vouched for the category, and its endpoint answered a protocol-appropriate probe. The liveness half of the gate was still enforced.",
    };
  }
  return { status: "pending", reason: … };
}
```

**Everything above that branch still runs, in this order** — so these gates stay
enforced against a manually-included agent:

| gate | line | still enforced? |
|---|---|---|
| manual **exclusion** | [:124](../convex/lib/pipelineStatus.ts#L124) | yes — exclusion beats inclusion |
| **`category === null`** | [:132](../convex/lib/pipelineStatus.ts#L132) | **YES — and this is the one that matters** |
| off-primary registry (BRC8004) | [:139](../convex/lib/pipelineStatus.ts#L139) | yes → `pending` |
| liveness `unreachable` | [:147](../convex/lib/pipelineStatus.ts#L147) | **yes → `pending`** |
| liveness `no-endpoint-advertised` | [:162](../convex/lib/pipelineStatus.ts#L162) | **yes → `pending`** |
| confidence `likely` | [:170](../convex/lib/pipelineStatus.ts#L170) | **relaxed — the only thing an include buys** |

Note also `DELIST_AFTER_CONSECUTIVE_FAILURES = 3` keeps applying afterwards
([pipelineStatus.ts:67](../convex/lib/pipelineStatus.ts#L67)): a manually
included agent whose endpoint later goes dark is delisted on the third
consecutive failed probe exactly like any other. A human vouch is not permanent.

### The consequence that constrains this whole review

**`manuallyIncluded` is only reachable if the classifier assigned a category.**
The `category === null` check at
[:132](../convex/lib/pipelineStatus.ts#L132) returns `rejected-classifier` and
short-circuits — it never reaches line 170.

So a manual include on any of the 17 null-category, `verified-live`
classifier-rejects in §5 is **inert**: the re-queued deep evaluation re-scores
them, the classifier again returns `null`, and they land straight back in
`rejected-classifier` with the override recorded but unused.

Promoting those 17 would require a classifier change, which is out of scope
here. **The mechanism you have promotes `likely` → `published`. It cannot
promote `null` → anything.** That is precisely why token 43129 worked: it was
`health-factor` at `likely`, not `null`.

---

## 1 & 2. THE FULL PENDING DUMP

Sorted `verified-live` → `unreachable` → `no-endpoint-advertised`, grouped by
best-guess category within each, and by descending score within each category.

## A. PENDING — `verified-live` (5)


### category: `rebalancing` — 1

#### 1. `310460` — Brain on BNB — PancakeSwap Fee Tier Placement

**Description:** A pair on PancakeSwap lives in up to five pools at once — V2 at 0.25% and V3 at 0.01%, 0.05%, 0.25% and 1.00% — sharing a price and competing for the same flow. Every interface ranks them by the money already parked in them, which is a record of what other people did rather than a measure of what the pool pays, and the two come apart constantly: across six of the busiest pairs on this chain the tier holding the most capital was routinely not the tier paying best, and a 1.00% pool held real money on every one of them while trading on none. This measures each tier over a live window — turnover, the fees the pool actually paid out, and what a given amount of liquidity would have earned in each, counting both sides of the pool because a provider puts up both. It names the tiers holding money that did not trade at all, and states how long the better tier would have to keep paying before a move covers its own gas. It does not annualise: the window is about forty minutes of chain and travels with every figure. Impermanent loss is not in the number and the answer says so. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 7 |
| runner-up | `yield` @ 1 |
| margin | 6 |
| confidence | likely |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:54.920Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 7, under the 12 needed to auto-publish, and yield scored 1, too close to call outright.

**statusReason:** Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.

**livenessDetail:** A2A agent card returned HTTP 200 in 7ms (name="Brain On BNB AI — hireable agents", skills=7, protocol 0.3.0).

**matchedTerms:** `supporting phrase "fee tier" in the name`, `weak term "impermanent loss"`

**Classifier evidence:**
```
+6 rebalancing: supporting phrase "fee tier" in the name
+1 rebalancing: weak term "impermanent loss"
+1 yield: weak term "earn"
cross-check: the agent's own file calls it "Brain on BNB â PancakeSwap Fee Tier Placement" where 8004scan has "Brain on BNB — PancakeSwap Fee Tier Placement"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
a2a: https://agent.brainonbnb.com/a2a  [8004scan: unhealthy]
```


### category: `grid-trading` — 2

#### 1. `269233` — BNB Grid Trader (test)

**Description:** TEST DEPLOYMENT — not for production use. Autonomous PancakeSwap V3 BNB/USDT grid trader. Sells computed grid plans (levels, sizing, net edge after fees and slippage) and live strategy status reports, priced in $U via ERC-8183.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 15 |
| runner-up | none |
| margin | 15 (no runner-up) |
| confidence | likely |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:56.868Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it carries penalties (name contains "test").

**statusReason:** Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.

**livenessDetail:** A2A agent card returned HTTP 200 in 758ms (name="bnbGridTrader-agent", skills=2, protocol 0.3.0).

**matchedTerms:** `defining phrase "grid trader" in the name`, `defining phrase "grid plan" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+12 grid-trading: defining phrase "grid trader" in the name
+8 grid-trading: defining phrase "grid plan" in the description
+1 grid-trading: weak term "grid"
-6 penalty: name contains "test"
```
**Advertised endpoint(s):**
```
a2a: https://bnb-grid.172-104-171-139.nip.io/.well-known/agent-card.json  [8004scan: healthy]
```

#### 2. `303779` — marketplace-operated-grid-planner

**Description:** Marketplace-operated deterministic Grid planning seller. No trading, custody or financial execution. Not an official BNB reference agent.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:57.302Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.

**livenessDetail:** A2A agent card returned HTTP 200 in 366ms (name="marketplace-operated-grid-planner", skills=3, protocol 0.3.0).

**matchedTerms:** `defining phrase "grid plan" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+8 grid-trading: defining phrase "grid plan" in the description
+1 grid-trading: weak term "grid"
```
**Advertised endpoint(s):**
```
a2a: https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json  [8004scan: healthy]
```


### category: `health-factor` — 1

#### 1. `266933` — BNB Lending Guardian

**Description:** Monitors Venus lending positions and protects against liquidation via automatic repayment.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 5 |
| runner-up | none |
| margin | 5 (no runner-up) |
| confidence | likely |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:10.960Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 5, under the 12 needed to auto-publish.

**statusReason:** Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.

**livenessDetail:** A2A agent card returned HTTP 200 in 241ms (name="BNB Lending Guardian", skills=2, protocol 0.1.0).

**matchedTerms:** `supporting phrase "lending position" in the description`, `weak term "liquidation"`, `weak term "lending"`

**Classifier evidence:**
```
+3 health-factor: supporting phrase "lending position" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "lending"
```
**Advertised endpoint(s):**
```
mcp: https://bnb-guardian.172-104-171-139.nip.io/mcp/  [8004scan: unhealthy]
a2a: https://bnb-guardian.172-104-171-139.nip.io/a2a  [8004scan: unhealthy]
```


### category: `yield` — 1

#### 1. `45422` — Beefy powered by HeyAnon

**Description:** Safe execution layer for Beefy classic vaults and CLM pools on Ethereum, Optimism, BSC, Base, Avalanche, Arbitrum, Sonic, HyperEVM, Plasma, Monad, and Robinhood Chain. Validates vault compatibility, checks deposit limits, supports full-balance classic deposits, handles token approvals, and returns pre-validated calldata. Covers classic and CLM deposits/withdrawals, CLM staking and rewards, opportunity discovery, vault and pool details, and unified portfolio queries.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 8 |
| runner-up | none |
| margin | 8 (no runner-up) |
| confidence | likely |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:53.153Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 8, under the 12 needed to auto-publish.

**statusReason:** Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.

**livenessDetail:** MCP initialize returned HTTP 201 in 90ms (serverInfo=heyanon-erc8004-beefy 1.0.0).

**matchedTerms:** `supporting phrase "deposit limit" in the description`, `supporting phrase "vault compatib" in the description`, `weak term "vault"`, `weak term "staking"`

**Classifier evidence:**
```
+3 yield: supporting phrase "deposit limit" in the description
+3 yield: supporting phrase "vault compatib" in the description
+1 yield: weak term "vault"
+1 yield: weak term "staking"
```
**Advertised endpoint(s):**
```
mcp: https://erc8004.heyanon.ai/mcp/beefy  [8004scan: healthy]
web: https://heyanon.ai  [8004scan: skipped]
```


## B. PENDING — `unreachable` (74)


### category: `rebalancing` — 5

#### 1. `325413` — Sentinels LP Rebalancer

**Description:** SmartSentinels PancakeSwap LP rebalancing seller on BSC mainnet. Keeps ranges in Sentinels LP Rebalancer is a hireable AI agent on BNB Chain for PancakeSwap concentrated liquidity (CLMM) positions. It is not a custodial market maker — it sells structured LP range-reset plans when your position drifts out of range, stops earning fees, or faces rising impermanent loss. WHAT IT DOES Analyzes pool context and returns a concrete rebalancing brief: whether to widen range, recentre, pause, or hold — with timing, risk notes, and clear PancakeSwap next steps. Uses read-only on-chain tools; funds stay in your wallet. HOW IT WORKS 1) Discover on SmartSentinels Marketplace (Rebalancing shelf) or this ERC-8004 profile. 2) Hire and grant a scoped Altana KeyStore session (spend cap, expiry, PancakeSwap router allowlist only). 3) Paid jobs: agent signs a fixed ERC-8183 quote → you fund on-chain → agent delivers the plan via A2A on AWS Bedrock AgentCore. 4) You execute any swaps/LP changes yourself within Altana limits. Free Advantage preview available for demos. PROBLEMS IT SOLVES • LP out of range → no fees • Manual 24/7 range monitoring • Unclear when to reset vs pause • DeFi ops without a dedicated analyst PRICING 0.1 $U per paid job (ERC-8183, BSC mainnet). Advantage preview: free. Gas only for hire/grants. Not financial advice. INTERACT Marketplace: https://smartsentinels.net/hub/marketplace (Rebalancing) Advantage preview: Marketplace → Advantage tab Manage hire: https://smartsentinels.net/hub/my-dashboard?tab=hired Protocol: A2A (negotiate → fund → notify_funded)play under your Altana limits. AgentCore A2A + ERC-8183.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 17 |
| runner-up | `monitoring` @ 1 |
| margin | 16 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T10:34:46.463Z |
| consecutiveProbeFailures | 1 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it carries penalties (describes 10 distinct actions, which reads as a general-purpose capability catalogue rather than one focused service), and monitoring scored 1, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A562333538205%3Aruntime%2Fsslprebalancer_sslprebalancer-H04NynHcX4/invocations/.well-known/agent-card.json -> HTTP 401. [oasf] No A2A card resolved. Tried: https://github.com/agntcy/oasf -> HTTP 200 but the body is not an A2A agent card; https://github.com/agntcy/oasf/.well-known/agent-card.json -> HTTP 404; https://github.com/.well-known/agent-card.json -> HTTP 404; https://github.com/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "lp rebalanc" in the name`, `defining phrase "concentrated liquidity" in the description`, `supporting phrase "out of range" in the description`, `weak term "rebalanc"`, `weak term "impermanent loss"`, `weak term "drift"`

**Classifier evidence:**
```
+1 monitoring: weak term "notify"
+12 rebalancing: defining phrase "lp rebalanc" in the name
+8 rebalancing: defining phrase "concentrated liquidity" in the description
+3 rebalancing: supporting phrase "out of range" in the description
+1 rebalancing: weak term "rebalanc"
+1 rebalancing: weak term "impermanent loss"
+1 rebalancing: weak term "drift"
+1 yield: weak term "earn"
-9 penalty: describes 10 distinct actions, which reads as a general-purpose capability catalogue rather than one focused service
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
a2a: https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A562333538205%3Aruntime%2Fsslprebalancer_sslprebalancer-H04NynHcX4/invocations/.well-known/agent-card.json
oasf: https://github.com/agntcy/oasf/
```

#### 2. `315944` — AiKi PancakeSwap LP Rebalancer

**Description:** First-party, read-only reference agent that verifies PancakeSwap v3 LP NFT range state and produces evidence-backed rebalance recommendations.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:51.125Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [pancakeswap-v3-lp-rebalance-assessment] No A2A card resolved. Tried: https://www.useaiki.xyz/v1/reference/pancake/rebalancer/agent/315944 -> HTTP 200 but the body is not an A2A agent card; https://www.useaiki.xyz/v1/reference/pancake/rebalancer/agent/315944/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "lp rebalanc" in the name`, `weak term "rebalanc"`

**Classifier evidence:**
```
+12 rebalancing: defining phrase "lp rebalanc" in the name
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
?: https://www.useaiki.xyz/v1/reference/pancake/rebalancer/agent/315944  (from probe record; 8004scan lists none)
```

#### 3. `171927` — DeFiMatrix.agent

**Description:** Get personalized yield strategies and portfolio rebalancing based on real-time DeFi market data.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | `yield` @ 9 |
| margin | 0 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.551Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish, and yield scored 9, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "portfolio rebalanc" in the description`, `weak term "rebalanc"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "portfolio rebalanc" in the description
+1 rebalancing: weak term "rebalanc"
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 4. `293054` — bnb-lp-quant.agent

**Description:** PancakeSwap execution agent. Manages concentrated-liquidity ranges and runs U/WBNB spot rotations from client session keys.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 8 |
| runner-up | none |
| margin | 8 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:50.047Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 8, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "liquidity range" in the description`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "liquidity range" in the description
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 5. `302610` — test.agent

**Description:** Automated management of concentrated liquidity positions, execution of DEX token swaps, and optimization of grid trading strategies across multiple chains.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 5 |
| runner-up | `grid-trading` @ 9 |
| margin | -4 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:47.250Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it carries penalties (name contains "test"), and scored 5, under the 12 needed to auto-publish, and grid-trading scored 9, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "concentrated liquidity" in the description`, `supporting phrase "liquidity position" in the description`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "concentrated liquidity" in the description
+3 rebalancing: supporting phrase "liquidity position" in the description
+8 grid-trading: defining phrase "grid trading" in the description
+1 grid-trading: weak term "grid"
-6 penalty: name contains "test"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```


### category: `grid-trading` — 4

#### 1. `315945` — AiKi PancakeSwap Grid Trader

**Description:** First-party, read-only reference agent that verifies a PancakeSwap v3 grid configuration against live pool state and reports which rungs are in range. It recommends and never trades.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 24 |
| runner-up | `rebalancing` @ 3 |
| margin | 21 |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:54.682Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [pancakeswap-v3-grid-assessment] No A2A card resolved. Tried: https://www.useaiki.xyz/v1/reference/pancake/grid/agent/315945 -> HTTP 200 but the body is not an A2A agent card; https://www.useaiki.xyz/v1/reference/pancake/grid/agent/315945/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "grid trader" in the name`, `defining phrase "grid configuration" in the description`, `supporting phrase "rungs" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+3 rebalancing: supporting phrase "in range" in the description
+12 grid-trading: defining phrase "grid trader" in the name
+8 grid-trading: defining phrase "grid configuration" in the description
+3 grid-trading: supporting phrase "rungs" in the description
+1 grid-trading: weak term "grid"
```
**Advertised endpoint(s):**
```
?: https://www.useaiki.xyz/v1/reference/pancake/grid/agent/315945  (from probe record; 8004scan lists none)
```

#### 2. `292939` — bnb-grid-trader-test.agent

**Description:** Geometric grid trading on BNB/USDT via PancakeSwap. Sells computed grid plans and live strategy status over ERC-8183.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 14 |
| runner-up | none |
| margin | 14 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:59.542Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it carries penalties (name contains "test").

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "grid trading" in the description`, `defining phrase "grid plan" in the description`, `supporting phrase "geometric grid" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+8 grid-trading: defining phrase "grid trading" in the description
+8 grid-trading: defining phrase "grid plan" in the description
+3 grid-trading: supporting phrase "geometric grid" in the description
+1 grid-trading: weak term "grid"
-6 penalty: name contains "test"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 3. `172801` — DeFiBot.agent

**Description:** Automate grid trading, DCA, and yield compounding across major DEXs while you sleep.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 9 |
| runner-up | `yield` @ 9 |
| margin | 0 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:01.769Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish, and yield scored 9, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "grid trading" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+8 grid-trading: defining phrase "grid trading" in the description
+1 grid-trading: weak term "grid"
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 4. `323332` — Grid

**Description:** Places a fixed ladder of v3 ranges and requotes on inventory skew. Reports spread capture in bps and the share of rungs that filled.

| field | value |
|---|---|
| best-guess category | `grid-trading` |
| score | 7 |
| runner-up | none |
| margin | 7 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:47.050Z |
| consecutiveProbeFailures | 1 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 7, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [http] No A2A card resolved. Tried: https://misquote.vercel.app/agent?id=grid -> HTTP 404; https://misquote.vercel.app/agent?id=grid/.well-known/agent-card.json -> HTTP 404; https://misquote.vercel.app/.well-known/agent-card.json -> HTTP 404; https://misquote.vercel.app/.well-known/agent.json -> HTTP 404. [journal] No A2A card resolved. Tried: https://misquote-api.onrender.com/journal/grid -> HTTP 404; https://misquote-api.onrender.com/journal/grid/.well-known/agent-card.json -> HTTP 404; https://misquote-api.onrender.com/.well-known/agent-card.json -> HTTP 404; https://misquote-api.onrender.com/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `supporting phrase "rungs" in the description`, `supporting phrase "ladder" in the description`, `weak term "grid"`

**Classifier evidence:**
```
+3 grid-trading: supporting phrase "rungs" in the description
+3 grid-trading: supporting phrase "ladder" in the description
+1 grid-trading: weak term "grid"
```
**Advertised endpoint(s):**
```
?: https://misquote.vercel.app/agent?id=grid  (from probe record; 8004scan lists none)
```


### category: `health-factor` — 6

#### 1. `292058` — bnb-lending-guardian.agent

**Description:** Liquidation protection for Venus on BNB Chain. Reads a full lending position across Venus Core and all 8 isolated pools, computes the true health factor from liquidation thresholds, stress-tests it against -5% to -20% collateral drops, and returns the exact minimum repayment that restores a safe position.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 33 |
| runner-up | none |
| margin | 33 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:04.062Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend-bnb8183.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "health factor" in the description`, `defining phrase "liquidation protection" in the description`, `defining phrase "liquidation threshold" in the description`, `supporting phrase "lending position" in the description`, `supporting phrase "safe position" in the description`, `weak term "liquidation"`, `weak term "collateral"`, `weak term "lending"`

**Classifier evidence:**
```
+8 health-factor: defining phrase "health factor" in the description
+8 health-factor: defining phrase "liquidation protection" in the description
+8 health-factor: defining phrase "liquidation threshold" in the description
+3 health-factor: supporting phrase "lending position" in the description
+3 health-factor: supporting phrase "safe position" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "collateral"
+1 health-factor: weak term "lending"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend-bnb8183.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 2. `322885` — Venus Health Factor Monitor

**Description:** Reads any wallet's Venus Protocol lending position and returns its health factor, collateral, borrowings, per-market liquidation thresholds, and a plain-language risk recommendation. Read-only analysis over eth_call; supports BNB Chain mainnet (56) and testnet (97).

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 26 |
| runner-up | none |
| margin | 26 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:04:44.349Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [x402] No A2A card resolved. Tried: https://agensea-health-factor.vercel.app/x402 -> HTTP 404; https://agensea-health-factor.vercel.app/x402/.well-known/agent-card.json -> HTTP 404; https://agensea-health-factor.vercel.app/.well-known/agent-card.json -> HTTP 404; https://agensea-health-factor.vercel.app/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "health factor" in the name`, `defining phrase "liquidation threshold" in the description`, `supporting phrase "lending position" in the description`, `weak term "liquidation"`, `weak term "collateral"`, `weak term "borrow"`

**Classifier evidence:**
```
+12 health-factor: defining phrase "health factor" in the name
+8 health-factor: defining phrase "liquidation threshold" in the description
+3 health-factor: supporting phrase "lending position" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "collateral"
+1 health-factor: weak term "borrow"
```
**Advertised endpoint(s):**
```
?: https://agensea-health-factor.vercel.app/x402  (from probe record; 8004scan lists none)
```

#### 3. `315943` — AiKi Venus Health Factor Guardian

**Description:** First-party reference agent that reads Venus lending positions, derives a health factor, and reports evidence-backed liquidation risk. It is read-only until a separate constrained authority grant exists.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 25 |
| runner-up | none |
| margin | 25 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:05:00.617Z |
| consecutiveProbeFailures | 4 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [venus-health-factor-assessment] No A2A card resolved. Tried: https://www.useaiki.xyz/v1/reference/venus/agent/315943 -> HTTP 200 but the body is not an A2A agent card; https://www.useaiki.xyz/v1/reference/venus/agent/315943/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "health factor" in the name`, `defining phrase "liquidation risk" in the description`, `supporting phrase "lending position" in the description`, `weak term "liquidation"`, `weak term "lending"`

**Classifier evidence:**
```
+12 health-factor: defining phrase "health factor" in the name
+8 health-factor: defining phrase "liquidation risk" in the description
+3 health-factor: supporting phrase "lending position" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "lending"
```
**Advertised endpoint(s):**
```
?: https://www.useaiki.xyz/v1/reference/venus/agent/315943  (from probe record; 8004scan lists none)
```

#### 4. `270183` — AgentCensus Health Factor Monitor

**Description:** Live Venus Protocol position monitor on BSC. Send an account address, get a signed health report: health factor, liquidity, shortfall, HEALTHY/AT_RISK/LIQUIDATABLE verdict. Built by AgentCensus - the honest index of the BNB agent economy.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 12 |
| runner-up | `monitoring` @ 8 |
| margin | 4 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:04.430Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it monitoring scored 8, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [agentcensus health factor monitor] No A2A card resolved. Tried: https://agentcensus.xyz/erc8183 -> HTTP 404; https://agentcensus.xyz/erc8183/.well-known/agent-card.json -> HTTP 404; https://agentcensus.xyz/.well-known/agent-card.json -> HTTP 404; https://agentcensus.xyz/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "health factor" in the name`

**Classifier evidence:**
```
+8 monitoring: defining phrase "position monitor" in the description
+12 health-factor: defining phrase "health factor" in the name
```
**Advertised endpoint(s):**
```
?: https://agentcensus.xyz/erc8183  (from probe record; 8004scan lists none)
```

#### 5. `266229` — positioncrew-lending-rescue.agent

**Description:** Computes the smallest bounded Venus debt repayment or collateral top-up needed to reach a buyer-selected health factor.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 11 |
| runner-up | none |
| margin | 11 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:06.751Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 11, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "health factor" in the description`, `weak term "collateral"`, `weak term "lending"`, `weak term "debt"`

**Classifier evidence:**
```
+8 health-factor: defining phrase "health factor" in the description
+1 health-factor: weak term "collateral"
+1 health-factor: weak term "lending"
+1 health-factor: weak term "debt"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 6. `179543` — RiskOracle.agent

**Description:** Monitor your DeFi loan health, predict liquidation risks, and auto-adjust positions.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 9 |
| runner-up | `yield` @ 9 |
| margin | 0 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:09.141Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish, and yield scored 9, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "liquidation risk" in the description`, `weak term "liquidation"`

**Classifier evidence:**
```
+8 health-factor: defining phrase "liquidation risk" in the description
+1 health-factor: weak term "liquidation"
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```


### category: `yield` — 59

#### 1. `315946` — AiKi Venus Yield Optimiser

**Description:** First-party, read-only reference agent that reads live Venus supply rates across markets and reports where capital would earn most. It reports a route and never moves funds.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 30 |
| runner-up | none |
| margin | 30 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:45.773Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [venus-yield-route-assessment] No A2A card resolved. Tried: https://www.useaiki.xyz/v1/reference/yield/agent/315946 -> HTTP 200 but the body is not an A2A agent card; https://www.useaiki.xyz/v1/reference/yield/agent/315946/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent-card.json -> HTTP 404; https://www.useaiki.xyz/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the name`, `defining phrase "supply rate" in the description`, `defining phrase "earn most" in the description`, `weak term "yield"`, `weak term "earn"`

**Classifier evidence:**
```
+12 yield: defining phrase "yield optimi" in the name
+8 yield: defining phrase "supply rate" in the description
+8 yield: defining phrase "earn most" in the description
+1 yield: weak term "yield"
+1 yield: weak term "earn"
```
**Advertised endpoint(s):**
```
?: https://www.useaiki.xyz/v1/reference/yield/agent/315946  (from probe record; 8004scan lists none)
```

#### 2. `190411` — LiquidityCore.agent

**Description:** Interchain DEX built on Cosmos with IBC-enabled asset routing and auto-compounding.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 17 |
| runner-up | none |
| margin | 17 (no runner-up) |
| confidence | confirmed |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:48.886Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `defining phrase "auto-compound" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+8 yield: defining phrase "auto-compound" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 3. `326106` — Sentinels Yield Router

**Description:** SmartSentinels hireable yield optimisation seller for BNB Chain DeFi. Compares Lista, Venus, and PancakeSwap routes and returns APR-ranked briefs under Altana spend limits. Analysis only — does not move funds or custody your wallet. Hire via Hub Marketplace; paid jobs settle in $U through ERC-8183. Runtime: AWS Bedrock AgentCore A2A seller. Informational tooling — not financial advice.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T14:34:47.029Z |
| consecutiveProbeFailures | 1 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A562333538205%3Aruntime%2Fssyieldrouter_ssyieldrouter-zC4ZBpB9Z6/invocations/.well-known/agent-card.json -> HTTP 401. [oasf] No A2A card resolved. Tried: https://github.com/agntcy/oasf -> HTTP 200 but the body is not an A2A agent card; https://github.com/agntcy/oasf/.well-known/agent-card.json -> HTTP 404; https://github.com/.well-known/agent-card.json -> HTTP 404; https://github.com/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`, `weak term "apr"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
+1 yield: weak term "apr"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
a2a: https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A562333538205%3Aruntime%2Fssyieldrouter_ssyieldrouter-zC4ZBpB9Z6/invocations/.well-known/agent-card.json
oasf: https://github.com/agntcy/oasf/
```

#### 4. `3445` — DeltaPartner

**Description:** Powered by maximizing yields

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:59.186Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [web] No A2A card resolved. Tried: https://deltapartner.agent -> error sending request for url (https://deltapartner.agent/): client error (Connect): tunnel error: unsuccessful; https://deltapartner.agent/.well-known/agent-card.json -> error sending request for url (https://deltapartner.agent/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://deltapartner.agent/.well-known/agent.json -> error sending request for url (https://deltapartner.agent/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful. [mcp] MCP initialize failed: error sending request for url (https://deltapartner.agent/mcp): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield farming" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
?: https://deltapartner.agent  (from probe record; 8004scan lists none)
```

#### 5. `173099` — AlphaProtocolResearch.agent

**Description:** AlphaProtocolResearch provides comprehensive research on blockchain ecosystems, DeFi protocols, Layer 1 and Layer 2 networks, tokenomics, and market trends. Our reports help investors, founders, and organizations understand the rapidly evolving Web3 landscape.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:55.824Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`, `weak term "apr"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
+1 yield: weak term "apr"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 6. `190414` — RestakeHub.agent

**Description:** Restaking protocol that extends Ethereum security to other blockchain applications.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:51.016Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`, `weak term "staking"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
+1 yield: weak term "staking"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 7. `303626` — Connects.agent

**Description:** Crypto research assistant specializing in airdrop farming, DeFi analysis, and Web3 project evaluation. I help users identify high-potential airdrops, track testnet opportunities, and navigate blockchain ecosystems efficiently. From token analysis to quest completion strategies — your edge in the decentralized world. 🚀

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T18:34:48.390Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 8. `266231` — positioncrew-lp-rebalance.agent

**Description:** Evaluates a PancakeSwap V3 position and proposes a cost-, slippage-, inventory-, and break-even-bounded range shift or HOLD.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | `rebalancing` @ 1 |
| margin | 8 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:59.784Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish, and rebalancing scored 1, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 9. `177310` — TradePilot.agent

**Description:** Automated crypto trading bot with DCA, grid, and rebalancing strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | `rebalancing` @ 1 |
| margin | 8 |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:57.566Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish, and rebalancing scored 1, too close to call outright.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+1 grid-trading: weak term "grid"
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 10. `266232` — positioncrew-yield-optimizer.agent

**Description:** Compares block-pinned Venus stablecoin markets and returns a liquidity-, concentration-, migration-cost-, and risk-bounded allocation or HOLD.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:55.366Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 11. `10999` — CyberScout_E5A98A

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.897Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 12. `10998` — KineticHunter_71EAB1

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.826Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 13. `11004` — KineticEngine_814625

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.756Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 14. `11006` — CyberHunter_E1FA1E

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.692Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 15. `11015` — AxiomOracle_596EF4

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.626Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 16. `11023` — NovaNetwork_3EC053

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.562Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 17. `11021` — FusionGuardian_CE43CD

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.486Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 18. `11030` — EpochSeeker_F4285E

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.407Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 19. `11035` — IonProtocol_72536F

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.342Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 20. `11038` — PhotonNetwork_BDAD91

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.273Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 21. `11051` — GammaSeeker_C5B5C0

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.208Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 22. `11049` — CyberOracle_741179

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.141Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 23. `11061` — NexusSentinel_432C3E

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.079Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 24. `11066` — OmegaSentinel_32E739

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.015Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 25. `23781` — BetaSentinel_764127

**Description:** Multi-protocol yield aggregator and portfolio management AI.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:51.947Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield aggregat" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield aggregat" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 26. `10985` — OmegaBot_D00BC3

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.670Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 27. `10989` — DeltaMind_E93633

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.607Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 28. `10987` — AxiomMind_39DDE2

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.537Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 29. `10995` — FluxBot_CC5A73

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.471Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 30. `11000` — PhotonMind_A95A71

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.403Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 31. `11026` — NovaBot_D26326

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.336Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 32. `11033` — CyberBot_A29AFF

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.277Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 33. `11046` — NovaHub_2D0185

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.205Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 34. `11052` — GammaHub_403801

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.137Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 35. `11068` — NeuralMind_A42951

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:49.070Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 36. `23789` — NovaNode_03FAEC

**Description:** Cross-chain DeFi agent specializing in yield optimization strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:48.997Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [api] No A2A card resolved. Tried: https://api.example-agent.ai/v1 -> error sending request for url (https://api.example-agent.ai/v1): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/v1/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/v1/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent-card.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent-card.json): client error (Connect): tunnel error: unsuccessful; https://api.example-agent.ai/.well-known/agent.json -> error sending request for url (https://api.example-agent.ai/.well-known/agent.json): client error (Connect): tunnel error: unsuccessful.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
?: https://api.example-agent.ai/v1  (from probe record; 8004scan lists none)
```

#### 37. `166498` — Solidity-SmartContract.agent

**Description:** We are a professional Web3 development studio focused on blockchain infrastructure and decentralized applications. We provide end-to-end smart contract development, DeFi protocol building, NFT and tokenization solutions for Layer1 and Layer2 projects.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:59.098Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 38. `172618` — Pyth.agent

**Description:** Real-time low-latency price feeds for DeFi protocols and quantitative trading strategies.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:57.426Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 39. `179796` — RiskPulse.agent

**Description:** DeFi protocol analytics, TVL tracking, and risk monitoring platform.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:54.229Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 40. `180999` — DeFi-Yield-Optimizer.agent

**Description:** DeFi automation expert helping users maximize yields through intelligent optimization strategies and automated portfolio management.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:52.604Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 41. `197289` — defi_yield_optimizer.agent

**Description:** Helping investors and protocols maximize capital efficiency across DeFi ecosystems.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:34:49.424Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 42. `297622` — base1.agent

**Description:** Smart contract development, code review, security analysis, gas optimization, and DeFi development support.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:10.343Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 43. `297897` — alimhmb159.agent

**Description:** I audit Solidity smart contracts and optimize gas for DeFi protocols. I find critical vulnerabilities, prevent exploits, and reduce gas costs by 30-50%. Specialized in DeFi, EVM, L2, and secure architecture. Hire for audits, code reviews, and pre-launch security checks.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:08.673Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 44. `298449` — yousofbhuyan9.agent

**Description:** contributor trader defi

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:07.012Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 45. `298864` — sunshine.agent

**Description:** Smart-contract audits and gas optimization foe DeFi protocols.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:05.344Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 46. `299195` — erolpulluk.agent

**Description:** Smart-contract audits and gas optimization for Defi protocols.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:03.675Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 47. `299948` — nexpaid.agent

**Description:** Web3 research agent focused on crypto projects, DeFi protocols, tokenomics, airdrops, testnets, ecosystem updates, and on-chain trends. Helps analyze projects, summarize protocols, compare opportunities, and turn research into actionable insights

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:02.007Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 48. `300706` — ffcrypto.agent

**Description:** Automated AI assistant for code analysis, smart contract optimization, and DeFi tools.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:05:00.360Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 49. `300779` — caobang.agent

**Description:** Web3 research, airdrop strategy, DeFi opportunities, and blockchain automation. I help users discover, evaluate, and participate in promising crypto projects, test protocols, complete quests, interact with smart contracts, and optimize on-chain activities. Available for airdrop research, community campaigns, Web3 testing, transaction automation, and crypto project analysis.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:58.698Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 50. `302201` — bichphuong.agent

**Description:** I provide in-depth market and protocol research for DeFi and Web3 projects, including protocol analysis, market trends, tokenomics, competitive research, and risk assessment. I help users make informed decisions with clear, data-driven insights.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:57.026Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 51. `302511` — fact.agent

**Description:** Smart contract analysis, security checks, Web3 research, and blockchain development assistance. Helps identify vulnerabilities, analyze contract logic, and provide practical insights for DeFi and crypto projects.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:55.343Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 52. `303512` — Ashim111.agent

**Description:** Security verification and research for crypto, Web3, DeFi protocols, and smart contracts

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:53.678Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 53. `303692` — konoha.agent

**Description:** Crypto Market and Defi Strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:51.997Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 54. `304354` — NovaMind.agent

**Description:** An intelligent AI agent designed to help users analyze information, automate tasks, and turn complex data into clear, actionable insights. Built to be fast, practical, and easy to interact with

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:50.331Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 55. `307647` — chetaofalltrade.agent

**Description:** Smary contract audit, optimized for Defi

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:48.676Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 56. `317207` — tzrcrypto.agent

**Description:** smart contract audits and optimize gas for defi protocol

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T19:04:46.974Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 57. `317894` — sun490619.agent

**Description:** An AI agent specialized in automated Web3 workflow execution, smart contract interaction, and DeFi protocol data analysis.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T18:34:50.102Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 58. `300598` — apex-tracker.agent

**Description:** Autonomous DeFAI agent designed for high-tier smart money tracking and on-chain alpha detection. Apex-Tracker monitors institutional wallets, analyzes liquidity flows, and delivers instant, actionable insights.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-08-31T18:34:46.707Z |
| consecutiveProbeFailures | 2 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```

#### 59. `185769` — Gelato.agent

**Description:** Schedule and automate recurring on-chain tasks like yield harvesting and rebasing.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 4 |
| runner-up | none |
| margin | 4 (no runner-up) |
| confidence | likely |
| livenessState | `unreachable` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:51.878Z |
| consecutiveProbeFailures | 3 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 4, under the 12 needed to auto-publish.

**statusReason:** The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.

**livenessDetail:** [a2a] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404. [termix platform] No A2A card resolved. Tried: https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services -> HTTP 404; https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services/.well-known/agent-card.json -> HTTP 401; https://platform-backend.prod.termix.live/.well-known/agent-card.json -> HTTP 404; https://platform-backend.prod.termix.live/.well-known/agent.json -> HTTP 404.

**matchedTerms:** `supporting phrase "harvest" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+3 yield: supporting phrase "harvest" in the description
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card  [8004scan: unhealthy]
```


## C. PENDING — `no-endpoint-advertised` (29)


### category: `rebalancing` — 6

#### 1. `320966` — Range Keeper

**Description:** Watches a PancakeSwap V3 concentrated liquidity position on BNB Smart Chain and reports when it has stopped earning fees, how far the price has drifted, and what range would put it back to work at the width its owner chose. Read only: it proposes, it never signs, and it never holds your funds.

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 12 |
| runner-up | `yield` @ 1 |
| margin | 11 |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T13:04:54.308Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | unreachable |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "concentrated liquidity" in the description`, `supporting phrase "liquidity position" in the description`, `weak term "drift"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "concentrated liquidity" in the description
+3 rebalancing: supporting phrase "liquidity position" in the description
+1 rebalancing: weak term "drift"
+1 yield: weak term "earn"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 2. `2475` — Liquidity Provider

**Description:** Optimizes LP positions across DEXs to maximize fees while minimizing impermanent loss. 

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.826Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "lp position" in the description`, `weak term "impermanent loss"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "lp position" in the description
+1 rebalancing: weak term "impermanent loss"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 3. `3070` — babycaisubagent9_sharp9457

**Description:** Automated portfolio rebalancing

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.760Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "portfolio rebalanc" in the description`, `weak term "rebalanc"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "portfolio rebalanc" in the description
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 4. `3069` — babycaisubagent8_proudbuilder2465

**Description:** Automated portfolio rebalancing

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.709Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "portfolio rebalanc" in the description`, `weak term "rebalanc"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "portfolio rebalanc" in the description
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 5. `3127` — babycaisubagent66_quickassistant6584

**Description:** Automated portfolio rebalancing

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.654Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "portfolio rebalanc" in the description`, `weak term "rebalanc"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "portfolio rebalanc" in the description
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 6. `3161` — babycaisubagent100_cleverassistant9005

**Description:** Automated portfolio rebalancing

| field | value |
|---|---|
| best-guess category | `rebalancing` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:53.600Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "portfolio rebalanc" in the description`, `weak term "rebalanc"`

**Classifier evidence:**
```
+8 rebalancing: defining phrase "portfolio rebalanc" in the description
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
(none advertised)
```


### category: `health-factor` — 4

#### 1. `87002` — Nexus

**Description:** AI agent automating leverage-degen strategies on launchonbasis—asymmetric payoffs, conviction entries, liquidation risk management.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:09.341Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "liquidation risk" in the description`, `weak term "liquidation"`, `weak term "leverage"`

**Classifier evidence:**
```
+8 health-factor: defining phrase "liquidation risk" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "leverage"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 2. `87323` — Typhon

**Description:** AI leverage degen hunting 100x or complete ruin. I trade with size, move fast, and treat liquidation risk like seasoning.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 10 |
| runner-up | none |
| margin | 10 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:09.257Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "liquidation risk" in the description`, `weak term "liquidation"`, `weak term "leverage"`

**Classifier evidence:**
```
+8 health-factor: defining phrase "liquidation risk" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "leverage"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 3. `282692` — Addison_The Cript

**Description:** You are an elite, highly active Web3 & Crypto Quantitative Strategist. You deliver sharp, data-driven market predictions and analysis across Bitcoin, altcoins, DeFi, Layer-1/Layer-2 protocols, and Web3 ecosystems. Key Role & Behavior: - Deliver sharp, decisive, and highly accurate YES/NO market predictions based purely on objective on-chain data, tokenomics, and market structure. - Maintain a critical, anti-hype stance. Completely ignore baseless optimism ("to the moon" fluff) and emotional market sentiment. - Adopt an authoritative, confident, concise, and direct tone. Analytical Framework (Must evaluate these metrics before deciding): 1. On-Chain & Derivatives Data: Real-time exchange inflows/outflows, whale wallet accumulation, order book depth, open interest, leverage liquidation cascades, and funding rates. 2. Fundamental & Tokenomics: Supply schedules, upcoming vesting cliffs, protocol total value locked (TVL), real yield generation, and smart contract health factors. 3. Market Structure & Macro: Volume profile, support/invalidation levels, liquidity pools, and global macroeconomic liquidity shifts. 4. Risk Management: Downside risk-to-reward ratios, smart contract security risks, and liquidity depth. Response Guidelines: - State your clear prediction stance immediately (YES or NO). - Provide 3 concise, high-impact bullet points summarizing the core statistical evidence, key structural catalyst, and main invalidation risk. - Keep answers dense with facts, sharp, and direct to the point. Always make a firm, data-backed call.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 10 |
| runner-up | `rebalancing` @ 1 |
| margin | 9 |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:56.030Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish, and rebalancing scored 1, too close to call outright.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "health factor" in the description`, `weak term "liquidation"`, `weak term "leverage"`

**Classifier evidence:**
```
+1 rebalancing: weak term "liquidity pool"
+8 health-factor: defining phrase "health factor" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "leverage"
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
web: https://evoevo.ai/agent/detail?id=4591929
```

#### 4. `282693` — Nath_Cript

**Description:** You are an elite, highly active Web3 & Crypto Quantitative Strategist. You deliver sharp, data-driven market predictions and analysis across Bitcoin, altcoins, DeFi, Layer-1/Layer-2 protocols, and Web3 ecosystems. Key Role & Behavior: - Deliver sharp, decisive, and highly accurate YES/NO market predictions based purely on objective on-chain data, tokenomics, and market structure. - Maintain a critical, anti-hype stance. Completely ignore baseless optimism ("to the moon" fluff) and emotional market sentiment. - Adopt an authoritative, confident, concise, and direct tone. Analytical Framework (Must evaluate these metrics before deciding): 1. On-Chain & Derivatives Data: Real-time exchange inflows/outflows, whale wallet accumulation, order book depth, open interest, leverage liquidation cascades, and funding rates. 2. Fundamental & Tokenomics: Supply schedules, upcoming vesting cliffs, protocol total value locked (TVL), real yield generation, and smart contract health factors. 3. Market Structure & Macro: Volume profile, support/invalidation levels, liquidity pools, and global macroeconomic liquidity shifts. 4. Risk Management: Downside risk-to-reward ratios, smart contract security risks, and liquidity depth. Response Guidelines: - State your clear prediction stance immediately (YES or NO). - Provide 3 concise, high-impact bullet points summarizing the core statistical evidence, key structural catalyst, and main invalidation risk. - Keep answers dense with facts, sharp, and direct to the point. Always make a firm, data-backed call.

| field | value |
|---|---|
| best-guess category | `health-factor` |
| score | 10 |
| runner-up | `rebalancing` @ 1 |
| margin | 9 |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:55.787Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 10, under the 12 needed to auto-publish, and rebalancing scored 1, too close to call outright.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "health factor" in the description`, `weak term "liquidation"`, `weak term "leverage"`

**Classifier evidence:**
```
+1 rebalancing: weak term "liquidity pool"
+8 health-factor: defining phrase "health factor" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "leverage"
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
web: https://evoevo.ai/agent/detail?id=4591928
```


### category: `yield` — 19

#### 1. `12046` — roboclaw

**Description:** AI agent for earning on-chain. I do yield farming, auto-compound rewards, and find safe DeFi opportunities. Passive income, low risk, transparent results. Hire me to grow your crypto

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 19 |
| runner-up | none |
| margin | 19 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.037Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `defining phrase "auto-compound" in the description`, `weak term "yield"`, `weak term "farming"`, `weak term "earn"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+8 yield: defining phrase "auto-compound" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
+1 yield: weak term "earn"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 2. `3099` — babycaisubagent38_quicktrader6005

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:44.201Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 3. `3080` — babycaisubagent19_proudscout6033

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:12.046Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 4. `3071` — babycaisubagent10_sharpbuilder9361

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.937Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 5. `3153` — babycaisubagent92_magicengineer4429

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.851Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 6. `3149` — babycaisubagent88_magicpilot720

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.798Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 7. `3148` — babycaisubagent87_eagerworker1302

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.734Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 8. `3147` — babycaisubagent86_coolanalyst3938

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.663Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 9. `3138` — babycaisubagent77_quickhelper7537

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.590Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 10. `3129` — babycaisubagent68_cleverscout6373

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.509Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 11. `3125` — babycaisubagent64_magicdesigner2266

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.426Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 12. `3124` — babycaisubagent63_smartanalyst8720

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.248Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 13. `3123` — babycaisubagent62_magic5526

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.173Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 14. `3122` — babycaisubagent61_brightassistant2906

**Description:** Specialized in DeFi analytics and yield farming strategies

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 13 |
| runner-up | none |
| margin | 13 (no runner-up) |
| confidence | confirmed |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:35:11.111Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `supporting phrase "farming strateg" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+3 yield: supporting phrase "farming strateg" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 15. `45245` — Yield-GOO

**Description:** Automated yield farming agent that rotates capital across BSC lending and liquidity protocols to maximize risk-adjusted APY. YFX continuously monitors farm rewards, calculates impermanent loss exposure, and rebalances positions to maintain optimal capital efficiency across Venus, Alpaca, and PancakeSwap farms.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 11 |
| runner-up | `rebalancing` @ 2 |
| margin | 9 |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:51.321Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 11, under the 12 needed to auto-publish, and rebalancing scored 2, too close to call outright.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `weak term "yield"`, `weak term "apy"`, `weak term "farming"`

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+1 rebalancing: weak term "impermanent loss"
+1 health-factor: weak term "lending"
+8 yield: defining phrase "yield farming" in the description
+1 yield: weak term "yield"
+1 yield: weak term "apy"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 16. `45705` — Yield-Farmer-X

**Description:** Automated yield farming agent that rotates capital across BSC lending and liquidity protocols to maximize risk-adjusted APY. YFX continuously monitors farm rewards, calculates impermanent loss exposure, and rebalances positions to maintain optimal capital efficiency across Venus, Alpaca, and PancakeSwap farms.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 11 |
| runner-up | `rebalancing` @ 2 |
| margin | 9 |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:51.262Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 11, under the 12 needed to auto-publish, and rebalancing scored 2, too close to call outright.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `weak term "yield"`, `weak term "apy"`, `weak term "farming"`

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+1 rebalancing: weak term "impermanent loss"
+1 health-factor: weak term "lending"
+8 yield: defining phrase "yield farming" in the description
+1 yield: weak term "yield"
+1 yield: weak term "apy"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 17. `50036` — Yield-Farmer - Goo

**Description:** Automated yield farming agent that rotates capital across BSC lending and liquidity protocols to maximize risk-adjusted APY. YFX continuously monitors farm rewards, calculates impermanent loss exposure, and rebalances positions to maintain optimal capital efficiency across Venus, Alpaca, and PancakeSwap farms.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 11 |
| runner-up | `rebalancing` @ 2 |
| margin | 9 |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T17:34:51.194Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 11, under the 12 needed to auto-publish, and rebalancing scored 2, too close to call outright.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `weak term "yield"`, `weak term "apy"`, `weak term "farming"`

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+1 rebalancing: weak term "impermanent loss"
+1 health-factor: weak term "lending"
+8 yield: defining phrase "yield farming" in the description
+1 yield: weak term "yield"
+1 yield: weak term "apy"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 18. `6459` — OpenClaw AI Agent #6

**Description:** Personal AI assistant with Web3 capabilities - can execute DeFi operations, trading, and autonomous financial tasks on TRON & BNB Chain.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 11 |
| runner-up | none |
| margin | 11 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-08-31T23:07:04.818Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**Shortfall:** Held as pending because it scored 11, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield farming" in the description`, `weak term "yield"`, `weak term "farming"`, `weak term "staking"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield farming" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
+1 yield: weak term "staking"
```
**Advertised endpoint(s):**
```
(none advertised)
```

#### 19. `259` — CryptoTime

**Description:** ERC-8004 verified agent for Web3 trading, AI-driven timestamps, and Pieverse yield optimization—ready for nocturnal crypto sessions.

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 9 |
| runner-up | none |
| margin | 9 (no runner-up) |
| confidence | likely |
| livenessState | `no-endpoint-advertised` |
| lastDeepEvaluatedAt | 2026-09-01T18:04:52.959Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**Shortfall:** Held as pending because it scored 9, under the 12 needed to auto-publish.

**statusReason:** The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.

**livenessDetail:** The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.

**matchedTerms:** `defining phrase "yield optimi" in the description`, `weak term "yield"`

**Classifier evidence:**
```
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
(none advertised)
```



---

## 5. `rejected-classifier` WITH `verified-live` — the TRUE count

The previous audit sampled 300 rows and found zero. **That sample was
misleading.** `listCandidates` reads the `by_status_evaluated` index ordered by
`lastDeepEvaluatedAt` **descending**, so it returned the 300 most-recently
deep-evaluated rows — and every one of the live ones is older than that window.

Scanning **all 5,684** rejected-classifier rows (the count has grown from 5,679):

| livenessState | count |
|---|---|
| `no-endpoint-advertised` | 3,400 |
| `(never probed)` | 1,952 |
| `unreachable` | 314 |
| **`verified-live`** | **18** |
| **total** | **5,684** |

**18 exist.** They are real, live, already-probed agents rejected on wording
alone — exactly the class you suspected. Their category breakdown is the
problem:

| category | count | promotable by manual include? |
|---|---|---|
| `(no category)` | 17 | **NO** — `resolveStatus` short-circuits on a null category (§6) |
| `yield` | 1 | technically yes — but it is token 6443, a deliberate duplicate-registration exclusion |

Among the 17 are several that read as genuinely in-category to a human —
`RangeKeeper` (*"Moves your liquidity back into range so it keeps earning"*),
`Aave powered by HeyAnon`, `HealthGuard`, `Yield Allocator`,
`Brain on BNB — Venus Yield Ranking`, `mandaterebalance-agent`. Every one
scored 0–2 against a `LIKELY_SCORE` floor of 4, because none of their
descriptions contains a *defining* phrase from
[agentScoring.ts](../convex/lib/agentScoring.ts). **They cannot be reached by
the mechanism you have** — see §6.

Also present and correctly excluded: `Topaz Agent` (score **−15**, on the
compile-time exclusion list), `HODL.DANCE` (memecoin launchpad),
`Aster powered by HeyAnon` (perps), `The Official Shitcoin by Unibase`.
The classifier is not malfunctioning on these.

Worth flagging separately: **1,952 rejected-classifier rows have never been
probed at all.** They were rejected on the cheap pass — 8004scan's cached
`name` and `description` only — and `needsDeepEvaluation` gives
`rejected-classifier` a 14-day cooldown
([pipelineStatus.ts:209](../convex/lib/pipelineStatus.ts#L209)), so nothing has
ever fetched their registration file or called their endpoint. Some fraction of
them may be live. That is **unmeasured** here and would need a probe pass, not a
review.

Full dump of all 18 follows.



### category: `yield` — 1

#### 1. `6443` — Sperax Intelligence

**Description:** Automated DeFi yield optimization agent. Monitors liquidity pools, executes token swaps, manages yield farming positions, and provides real-time market analysis across multiple DEXs. DeFi Trading Agent For BNB Chain with SperaxOS

| field | value |
|---|---|
| best-guess category | `yield` |
| score | 18 |
| runner-up | `rebalancing` @ 1 |
| margin | 17 |
| confidence | confirmed |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T16:57:51.531Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** Manual override (exclude): Duplicate registration. Token 6443 (Sperax Intelligence) and token 6441 (DeFi Trading Agent SperaxOS) share the same owner (0x9c2499e3...a8a360), a byte-identical description opening, and the SAME A2A endpoint (https://modelcontextprotocol.name/.well-known/agent-card.json), which answers as one service (Sperax MCP Gateway, skills=0). Two identity NFTs pointing at one agent are one listing, not two. 6441 stays listed; 6443 is held out.

**livenessDetail:** A2A agent card returned HTTP 200 in 13ms (name="Sperax MCP Gateway", skills=0, protocol 1.0.0).

**matchedTerms:** `defining phrase "yield farming" in the description`, `defining phrase "yield optimi" in the description`, `weak term "yield"`, `weak term "farming"`

**Classifier evidence:**
```
+1 rebalancing: weak term "liquidity pool"
+8 yield: defining phrase "yield farming" in the description
+8 yield: defining phrase "yield optimi" in the description
+1 yield: weak term "yield"
+1 yield: weak term "farming"
```
**Advertised endpoint(s):**
```
a2a: https://modelcontextprotocol.name/.well-known/agent-card.json  [8004scan: unhealthy]
web: https://sperax.io  [8004scan: skipped]
```


### category: `(no category)` — 17

#### 1. `116170` — SLY

**Description:** The original singularry. Risk profile: aggressive. AI agent for autonomous DeFi trading on BNB Chain. Operated by Singularry — The DeFAI SuperApp.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 2 |
| runner-up | none |
| margin | 2 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-31T03:04:46.289Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 377ms (name="Singularry", skills=0, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "yield"
+1 yield: weak term "vault"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
mcp: https://app.singularry.org/api/mcp  [8004scan: healthy]
a2a: https://app.singularry.org/agents/1/agent-card.json  [8004scan: healthy]
web: https://www.singularry.org  [8004scan: skipped]
email: contact@singularry.org  [8004scan: skipped]
```

#### 2. `116972` — SilentEcho

**Description:** . Risk profile: conservative. AI agent for autonomous DeFi trading on BNB Chain. Operated by Singularry — The DeFAI SuperApp.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 2 |
| runner-up | none |
| margin | 2 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-31T02:37:07.364Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 667ms (name="Singularry", skills=0, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "yield"
+1 yield: weak term "vault"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
mcp: https://app.singularry.org/api/mcp  [8004scan: healthy]
a2a: https://app.singularry.org/agents/9/agent-card.json  [8004scan: healthy]
web: https://www.singularry.org  [8004scan: skipped]
email: contact@singularry.org  [8004scan: skipped]
```

#### 3. `304493` — Brain on BNB — Venus Yield Ranking

**Description:** Ranks every Venus core-pool market on BNB Chain by what it actually pays a supplier, computed from the rate per block and a block time measured against the chain — not the 10,512,000-blocks-a-year constant that three-second blocks implied and that most published BSC yield figures still assume. BSC now produces a block every 0.45 s, so that constant understates these rates by about 6.7x. Every figure is cross-checked against Venus's own published APY and a market where the two disagree is reported as divergent. Given a position size it returns the days until a move pays for its own gas, which below a certain size is never. Hireable over ERC-8183 for 0.10 $U; the deliverable is written on-chain in full. Run by Brain On BNB AI, agent #49467, whose domain claims this id at https://brainonbnb.com/.well-known/agent-registration.json

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 2 |
| runner-up | none |
| margin | 2 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T18:35:07.603Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 12ms (name="Brain On BNB AI — hireable agents", skills=7, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "yield"
+1 yield: weak term "apy"
cross-check: the agent's own file calls it "Brain on BNB â Venus Yield Ranking" where 8004scan has "Brain on BNB — Venus Yield Ranking"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
a2a: https://agent.brainonbnb.com/a2a  [8004scan: unhealthy]
```

#### 4. `45381` — Aave powered by HeyAnon

**Description:** Safe execution layer for Aave lending on Ethereum, Arbitrum, Avalanche, Optimism, Polygon, Base, BSC, Plasma, and Monad. Validates collateral requirements, checks health factors, verifies token approvals before returning pre-validated calldata, and exposes collateral asset addresses in portfolio data. Covers supply, borrow, repay, withdraw, liquidation, e-mode, collateral toggling, rate swapping, and on-chain reserve/user data queries.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 2 |
| runner-up | none |
| margin | 2 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:35:42.304Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** MCP initialize returned HTTP 201 in 333ms (serverInfo=heyanon-erc8004-aave 1.0.0).

**Classifier evidence:**
```
+8 health-factor: defining phrase "health factor" in the description
+1 health-factor: weak term "liquidation"
+1 health-factor: weak term "collateral"
+1 health-factor: weak term "borrow"
-9 penalty: describes 10 distinct actions, which reads as a general-purpose capability catalogue rather than one focused service
```
**Advertised endpoint(s):**
```
mcp: https://erc8004.heyanon.ai/mcp/aave  [8004scan: healthy]
web: https://heyanon.ai  [8004scan: skipped]
```

#### 5. `120028` — StellarVoyager

**Description:** . Risk profile: conservative. AI agent for autonomous DeFi trading on BNB Chain. Operated by Singularry — The DeFAI SuperApp.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 2 |
| runner-up | none |
| margin | 2 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:06:31.887Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 807ms (name="Singularry", skills=0, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "yield"
+1 yield: weak term "vault"
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
mcp: https://app.singularry.org/api/mcp  [8004scan: healthy]
a2a: https://app.singularry.org/agents/27/agent-card.json  [8004scan: healthy]
web: https://www.singularry.org  [8004scan: skipped]
email: contact@singularry.org  [8004scan: skipped]
```

#### 6. `269226` — Yield Allocator

**Description:** Deterministic yield allocation: risk adjusted ranking with concentration and TVL caps, unallocated remainder always reported

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 1 |
| runner-up | none |
| margin | 1 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T19:05:20.852Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 183ms (name="yieldopt-agent", skills=2, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "yield"
```
**Advertised endpoint(s):**
```
a2a: https://agents.chainhelix.io/yieldopt/.well-known/agent-card.json  [8004scan: healthy]
```

#### 7. `293902` — mandaterebalance-agent

**Description:** MandateX PancakeSwap V3 rebalancing reference agent (mandaterebalance-agent) - deterministic quote policy plus simulation/refusal receipts over ERC-8183. Access: the A2A endpoint requires an OAuth2 Bearer token. Obtain one via the client_credentials grant at https://bnbagent-417731043744.auth.us-east-1.amazoncognito.com/oauth2/token (scope: bnbagent-seller/invoke); client credentials are issued by the operator. Full buyer guide: https://github.com/bnb-chain/bnbagent-studio/blob/main/docs/guides/agentcore-a2a-access.md

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 1 |
| runner-up | none |
| margin | 1 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:06:06.773Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 285ms (name="mandaterebalance-agent", skills=2, protocol 0.3.0).

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
```
**Advertised endpoint(s):**
```
a2a: https://gvwyso8occ.execute-api.us-east-1.amazonaws.com/.well-known/agent-card.json  [8004scan: healthy]
```

#### 8. `133221` — eights.me

**Description:** find the best apy on meteora

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 1 |
| runner-up | `yield` @ 1 |
| margin | 0 |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:06:05.934Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 629ms (name="HYRE", skills=1, protocol 0.3).

**Classifier evidence:**
```
+1 rebalancing: weak term "rebalanc"
+1 yield: weak term "apy"
```
**Advertised endpoint(s):**
```
mcp: https://mpp.hyreagent.fun/agents/eights  [8004scan: unhealthy]
a2a: https://me.hyreagent.fun/agent/eights/.well-known/agent-card.json  [8004scan: unhealthy]
web: https://me.hyreagent.fun/agent/eights  [8004scan: skipped]
```

#### 9. `259574` — RangeKeeper

**Description:** Moves your liquidity back into range so it keeps earning

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 1 |
| runner-up | none |
| margin | 1 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:05:01.486Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 945ms (name="RangeKeeper", skills=1, protocol 0.3.0).

**Classifier evidence:**
```
+1 yield: weak term "earn"
```
**Advertised endpoint(s):**
```
a2a: https://bnb-agent-market.vercel.app/agents/rangekeeper/.well-known/agent-card.json  [8004scan: healthy]
```

#### 10. `2152` — POET Screener by Unibase

**Description:** PoetScreener is a better DexScreener by GrindingPoet All fees redirected to GrindinPoet

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-31T03:35:13.432Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 190ms (name="POET Screener by Unibase", skills=1, protocol 1.0.0).

**Advertised endpoint(s):**
```
a2a: https://bitagent.s3.ap-southeast-1.amazonaws.com/0x078cb66ce78A1370E1416A324D7108B95E89F18e/.well-known/agent-card.json  [8004scan: healthy]
web: https://testnet-api.bitagent.io/aip/0x5849df1608f435bcd4191110658ef8ae5e23d2929d6872faa586e88831715e27  [8004scan: skipped]
```

#### 11. `2127` — The Official Shitcoin by Unibase

**Description:** ShitCoin will be the biggest POS coin you've ever seen. No, not Proof of Stake, that's absurd, but "Piece Of Shit" coin.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-31T03:35:10.325Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 194ms (name="The Official Shitcoin by Unibase", skills=1, protocol 1.0.0).

**Advertised endpoint(s):**
```
a2a: https://bitagent.s3.ap-southeast-1.amazonaws.com/0xFe787f7FF1649837c02Dfb87ABFf45B7A71FAE35/.well-known/agent-card.json  [8004scan: healthy]
web: https://testnet-api.bitagent.io/aip/0x97486f0b8c669d7bc2bf40899d57db7f56afea1767090f771536a4fbcc39d74c  [8004scan: skipped]
```

#### 12. `2124` — ShitScreener by Unibase

**Description:** This guy is building his own DEX screener type website but where he does not charge you at all We all are waiting for a replacement of the DEX problem. Why don't we fund him? I found his wallet on his page as well so will be redirecting the fees there There was a whole trending page about the DEX issue - I have linked that below too. All fees redirected to @GrindingPoet His Wallet: FDu4Qyo3DpDx28WAzxNw81dfXbL9J4Uxw9dfNxqd5Efm

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-31T03:35:08.941Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 192ms (name="ShitScreener by Unibase", skills=1, protocol 1.0.0).

**Advertised endpoint(s):**
```
a2a: https://bitagent.s3.ap-southeast-1.amazonaws.com/0xDCb70D097dA39478Cdcf525655F79F7fFD15938D/.well-known/agent-card.json  [8004scan: healthy]
web: https://testnet-api.bitagent.io/aip/0xfcfc48e04117bad3d4b3cb3ab52c458a571d3bf5b00e382f679917486a8c98d0  [8004scan: skipped]
```

#### 13. `96231` — HODL.DANCE - Memecoin Launchpad on BSC

**Description:** HODL.DANCE is a memecoin bonding curve launchpad on BNB Smart Chain. AI agents can list tokens by volume or market cap, simulate trades with live quotes, execute buy/sell transactions, and deploy new tokens with IPFS logo upload - all autonomously via the @hodl-dance/skill CLI or direct smart contract calls. Automatic ERC20 approvals included. Tokens migrate to PancakeSwap V3 at 19 BNB raised.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T20:36:06.247Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 34ms (name="HODL.DANCE", skills=6, protocol 1.2.1).

**Advertised endpoint(s):**
```
a2a: https://hodl.dance/.well-known/agent-card.json  [8004scan: healthy]
oasf: https://hodl.dance/.well-known/openapi.json  [8004scan: skipped]
```

#### 14. `45564` — Token Swaps powered by HeyAnon

**Description:** Safe execution layer for token swaps on Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, zkSync, Scroll, Gnosis, Sonic, HyperEVM, Plasma, Monad, Robinhood Chain, Solana, and TON. Validates price impact, checks liquidity depth, finds competitive routes, and returns pre-validated calldata.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T18:05:44.673Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** MCP initialize returned HTTP 201 in 74ms (serverInfo=heyanon-erc8004-swaps 1.0.0).

**Advertised endpoint(s):**
```
mcp: https://erc8004.heyanon.ai/mcp/swaps  [8004scan: healthy]
web: https://heyanon.ai  [8004scan: skipped]
```

#### 15. `259573` — HealthGuard

**Description:** Watches your loan and repays before it can be liquidated

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T18:05:23.069Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** A2A agent card returned HTTP 200 in 280ms (name="HealthGuard", skills=1, protocol 0.3.0).

**Advertised endpoint(s):**
```
a2a: https://bnb-agent-market.vercel.app/agents/healthguard/.well-known/agent-card.json  [8004scan: healthy]
```

#### 16. `85400` — Aster powered by HeyAnon

**Description:** Safe execution layer for Aster spot and derivatives trading. ERC-8004 registered on Base as an agent metadata pointer. Validates order parameters, checks account and futures configuration, and returns pre-validated API requests for your AI agent. Covers deposits, withdrawals, spot and futures market/limit/trigger/trailing stop orders, SL/TP, position management, margin adjustments, internal transfers, balances, positions, funding rates, markets, and supported assets.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | 0 |
| runner-up | none |
| margin | 0 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:08:05.671Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | true |
| source | sweep |

**statusReason:** The classifier did not place this agent in any of the four graded categories.

**livenessDetail:** MCP initialize returned HTTP 201 in 335ms (serverInfo=heyanon-erc8004-aster 1.0.0).

**Advertised endpoint(s):**
```
mcp: https://erc8004.heyanon.ai/mcp/aster  [8004scan: healthy]
web: https://heyanon.ai  [8004scan: skipped]
```

#### 17. `113284` — Topaz Agent

**Description:** Agentic ve(3,3) DeFi execution and strategy agent for Topaz Dex on BNB Chain. Helps humans, protocols, DAOs, and other AI agents route swaps, optimize LP positions, plan gauge votes, design bribe campaigns, claim rewards, manage veTOPAZ locks and managed veTOPAZ relays (deposit/withdraw/claim), and build wallet-ready calldata. Non-custodial — builds transactions but never signs or broadcasts.

| field | value |
|---|---|
| best-guess category | `(no category)` |
| score | -15 |
| runner-up | none |
| margin | -15 (no runner-up) |
| confidence | — |
| livenessState | `verified-live` |
| lastDeepEvaluatedAt | 2026-08-30T17:07:52.208Z |
| consecutiveProbeFailures | 0 |
| crossCheckState | fetched |
| x402Supported | false |
| source | sweep |

**statusReason:** Held out by the manual exclusion list. A human reviewed this agent and rejected it; the automated pipeline does not overrule that.

**livenessDetail:** A2A agent card returned HTTP 200 in 342ms (name="Topaz Agent", skills=21, protocol 0.18.1).

**Classifier evidence:**
```
+8 rebalancing: defining phrase "lp position" in the description
-8 penalty: names 2 capabilities outside all four categories (gauge vote, bribe)
-15 penalty: describes 12 distinct actions, which reads as a general-purpose capability catalogue rather than one focused service
cross-check: its own description differs from 8004scan's cached copy
```
**Advertised endpoint(s):**
```
mcp: https://agents.topazdex.com/mcp  [8004scan: healthy]
a2a: https://agents.topazdex.com/.well-known/agent-card.json  [8004scan: healthy]
web: https://agents.topazdex.com  [8004scan: skipped]
```

---

## 7. TWO PATTERNS THE DUMP MAKES OBVIOUS

Neither is actionable through manual include, but both bear on the shrinking
catalog you described.

### 7a. The delisting churn has a name: six confirmed agents are dark

These sit in `unreachable` at **`confirmed`** confidence — they cleared the
classifier outright and are held only by the liveness half. They are almost
certainly the agents the catalog has been losing to
`DELIST_AFTER_CONSECUTIVE_FAILURES`:

| tokenId | name | category | score | probeFails | endpoint |
|---|---|---|---|---|---|
| `292058` | bnb-lending-guardian.agent | health-factor | **33** | 3 | termix.live |
| `315946` | AiKi Venus Yield Optimiser | yield | **30** | 3 | useaiki.xyz |
| `322885` | Venus Health Factor Monitor | health-factor | **26** | 2 | agensea-health-factor.vercel.app |
| `315943` | AiKi Venus Health Factor Guardian | health-factor | **25** | 4 | useaiki.xyz |
| `315945` | AiKi PancakeSwap Grid Trader | grid-trading | **24** | 3 | useaiki.xyz |
| `190411` | LiquidityCore.agent | yield | 17 | 3 | termix.live |
| `315944` | AiKi PancakeSwap LP Rebalancer | rebalancing | 13 | 3 | useaiki.xyz |
| `320966` | Range Keeper | rebalancing | 12 | 0 | **no endpoint advertised** |
| `12046` | roboclaw | yield | 19 | 0 | **no endpoint advertised** |

**Every one of these re-publishes automatically the moment a single probe
succeeds** — `resolveStatus` returns `published` for confirmed + `verified-live`
with no human involved, and the delist path explicitly preserves the record so
"one successful probe re-lists it automatically"
([pipelineStatus.ts:157](../convex/lib/pipelineStatus.ts#L157)). Nothing needs
vouching for. Five of the nine are one publisher (`useaiki.xyz`) and two are
another (`termix.live`), so **two hosts being down accounts for seven of the
nine.** If those hosts are transiently down rather than gone, the catalog
recovers on its own; if they are gone, no review recovers them.

### 7b. Roughly half the `pending` pool is two template farms

The `unreachable` list is dominated by two clusters that are not distinct agents:

- **~26 entries** scoring exactly `9` in `yield`, all pointing at
  `https://api.example-agent.ai/v1` — a literal placeholder domain
  (`CyberScout_E5A98A`, `KineticHunter_71EAB1`, `NovaNetwork_3EC053`, …).
- **~30 entries** pointing at `platform-backend*.prod.termix.live`, most scoring
  exactly `9` in `yield` with per-user names (`yousofbhuyan9.agent`,
  `sunshine.agent`, `caobang.agent`, …).
- In `no-endpoint-advertised`, **~17 entries** named
  `babycaisubagent<N>_<adjective><noun><digits>` scoring 13 `confirmed` in
  `yield`.

These are mass registrations that scored on shared boilerplate. They are
correctly held — all fail liveness — and they inflate the "107 pending" figure
into something that sounds far more promising than it is. **The pool is not 108
distinct opportunities; it is roughly 25 distinct agents plus three farms.**

---

## 8. WHAT THIS REVIEW CAN AND CANNOT DELIVER

| | count | mechanism |
|---|---|---|
| **Promotable by manual include today** | **5** | `setManualOverride(include)` → re-probe → published |
| Re-publish on their own if a host recovers | 9 | nothing to do; automatic |
| Live but null-category, unreachable by the mechanism | 17 | would need a classifier change (out of scope) |
| Held on liveness, no human vouch can help | 103 | gate stays enforced by design |
| Never probed at all, status unknown | 1,952 | would need a probe pass (unmeasured) |

**5 is the number.** It takes the discovered catalog from 11 to 16.

No mutation was run. To act on any of the five, the call is
`discoveryPipeline:setManualOverride` with `{ tokenId, override: "include",
reason }` — and the liveness gate, the delist rule, and the exclusion list all
stay enforced afterwards.
