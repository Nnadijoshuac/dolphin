# Dolphin

**A marketplace for ERC-8004 agents on BNB Smart Chain.**

There are 307,559 agent identities registered on this chain. Of the first 281
Dolphin actually called, twelve answered.

That gap is the whole product.

| Surface | Where | Stack | Ships to |
|---|---|---|---|
| **Website** | `web/` | Next.js 16 · Tailwind v4 | [dolphinamp.vercel.app](https://dolphinamp.vercel.app) |
| **Mobile app** | repo root | Expo SDK 57 · Expo Router · NativeWind | iOS / Android via EAS, web export via GitHub Pages |
| **Backend** | `convex/` | Convex · viem | one deployment, shared by both |

```bash
cd web && npm install && npm run dev      # the website, on :3000
npm install && npx expo start             # the app, from the repo root
```

Both need `NEXT_PUBLIC_CONVEX_URL` / `EXPO_PUBLIC_CONVEX_URL` pointing at the
**same** Convex deployment. That shared URL is the only thing keeping the two
surfaces honest with each other. Full setup is in [§IX](#ix-running-it).

---

## I. The problem

ERC-8004 gives an agent an on-chain identity: a token, an owner, a wallet, and a
`tokenURI` pointing at whatever the publisher wants to say about itself. It is a
registry. Registration costs gas and proves nothing.

Measured against BSC mainnet on 2026-09-07:

```
   307,559   identities in the registry
    27,742   advertise an A2A endpoint
     5,474   advertise an MCP server
     1,348   new registrations per day
         5   have a domain 8004scan has verified
```

An agent with neither an A2A endpoint nor an MCP server cannot be hired by
anyone — there is no door to knock on. That is 89% of the chain. Of the
remainder, most advertise a URL that 404s, times out, points at
`http://localhost:3000`, or serves a card that isn't a card. The newest hundred
A2A registrations on any given page are dominated by `<name>.agent` identities
carrying an identical *"Autonomous \<noun\> agent registered through…"*
template.

A registry is not a marketplace. A marketplace is a registry that has been
**called**.

## II. The one idea

> **Nothing enters the catalog that has not answered.**

Not "has a URL". Not "the indexer says it's healthy" — 8004scan reports token
302257 as `unhealthy / Not a valid AgentCard (missing name)`, and that agent
returns live, wallet-signed quotes. Not "it responded to a ping".

An agent is in the catalog when Dolphin has resolved its card, called its own
protocol at the endpoint that card names, and received back a menu of work it
sells. Everything else in this repository is downstream of that sentence:

- The catalog table holds only agents that answered. Candidates, rejects, and
  never-probed records live elsewhere or nowhere.
- The probe sends **byte-for-byte what a hire sends**, because a probe that
  resolves its target differently is measuring a different endpoint.
- Every number rendered anywhere carries a status, a source and a timestamp, and
  a number with no live source renders as *unavailable with a stated reason* —
  never as a plausible-looking figure.

The last one is a hard project constraint (`AGENTS.md` §5), enforced in the type
system on both clients and in the backend's own `unavailableMetricValue()`.

## III. The shape

Two products. One backend. Neither client shapes agent data; both render what
Convex returns, which is what stops them drifting.

```
   ┌───────────────────────────┐   ┌───────────────────────────┐
   │        Mobile app         │   │          Website          │
   │   Expo SDK 57 · Router    │   │        Next.js 16         │
   │        (repo root)        │   │          (web/)           │
   │                           │   │                           │
   │   own package.json        │   │   own package.json        │
   │   own lockfile            │   │   own lockfile            │
   └─────────────┬─────────────┘   └─────────────┬─────────────┘
                 │                               │
                 │   no workspaces, no shared node_modules,
                 │   no code shared in either direction
                 └───────────────┬───────────────┘
                                 ▼
        ┌────────────────────────────────────────────────┐
        │                  convex/                       │
        │                                                │
        │   agents.list / .search / .get / .facets       │
        │   agentHires · agentJobs · agentReviews        │
        │   agentSessions · agentRetention · walletAuth  │
        └───────┬────────────────────────────────┬───────┘
                │                                │
    ┌───────────▼───────────┐        ┌───────────▼───────────┐
    │  DISCOVERY  (30 min)  │        │   PROTOCOL READS      │
    │  discovery.ts         │        │   convex/protocols/   │
    │                       │        │                       │
    │  VERIFICATION (10 min)│        │   Venus Comptroller   │
    │  verification.ts      │        │   PancakeSwap V3 PM   │
    │  probe.ts             │        │   Aave V3 Pool        │
    │                       │        │                       │
    │  FACETS       (6 h)   │        │   on demand, cached   │
    └───────────┬───────────┘        └───────────┬───────────┘
                ▼                                ▼
    ┌───────────────────────┐        ┌───────────────────────┐
    │  8004scan indexer     │        │  BNB Smart Chain (56) │
    │  + the agent's own    │        │  ERC-8004 identity    │
    │    A2A card / MCP     │        │  ERC-8183 escrow      │
    │    server             │        │  ERC-8004 reputation  │
    └───────────────────────┘        └───────────────────────┘
```

Every outbound arrow on the left goes through `convex/lib/safeFetch.ts`. Every
one of those URLs was chosen by a stranger.

## IV. The life of an agent

Five stages. An agent that fails any of them is not listed, and the reason it
was not listed is one readable sentence anyone can look up.

### 1 · Discovery — every 30 minutes, ~1 request, zero catalog writes

`discovery.ts` asks 8004scan for what is new since the last high-water mark:

```
GET /agents?chain_id=56&created_after=<cursor>&sort_by=created_at&sort_order=asc
```

Token ids only increase, so `created_after` returns exactly the new
registrations — about 28 per cycle in the steady state. A separate budgeted
backfill walks the `has_a2a=true` and `has_mcp=true` slices to catch up on the
~33,000 identities that already publish an endpoint. Both retry, and both fall
back to an unfiltered walk if 8004scan's own filters time out, which they
measurably do at ~10.5 s under load. Discovery degrades in speed; never in
correctness.

### 2 · The cheap screen — pure string work, no network, **no rows**

`lib/screen.ts` throws away registrations that are not services at all: empty
descriptions, numeric noise, repeated tokens, collectible series, campaign
templates, persona agents. Rules about **form**, never about topic.

It writes nothing. A rejected record is *counted* into `discoveryCursor`, and
the incremental cursor guarantees it is never fetched twice. Its predecessor
wrote a database row per rejection; see [decision 3](#3-persist-the-expensive-decision-re-derive-the-cheap-one).

The bias is deliberate and asymmetric: anything dropped here is never probed, so
a wrong rejection silently costs a listing forever. Anything wrongly *kept*
costs one fetch and one probe — and the probe is the real gate. Every threshold
is set loose on purpose.

### 3 · Verification — every 10 minutes, fanned out, one function per agent

`verification.ts` selects the due batch off `by_state_next_probe` and schedules
**one Convex action per agent**, capped at 200 per cycle. A hung endpoint burns
its own 20-second timeout and nothing else's. No two agents share an invocation,
which is the entire answer to *"can one dead agent block the pipeline?"*

`lib/probe.ts` then does the actual asking:

```
   A2A                                  MCP
   ─────────────────────────────────    ────────────────────────────────
   1  resolve the card                  1  initialize  (2025-06-18)
      advertised URL, then                 JSON or SSE frame
      /.well-known/agent-card.json
      /.well-known/agent.json           2  tools/list
      → the card's own `url` is            ≥ 1 tool  ⇒  LIVE
        the real JSON-RPC endpoint

   2  message/send {skill:"list"}
      a menu with ≥ 1 service ⇒ LIVE

   3  message/send {skill:"negotiate"}
      quote must pass normalizeQuote
      against the registered wallet
      ⇒ LIVE, and it sets `pricing`
```

Stages 2 and 3 use the same envelope builder, the same endpoint resolver and the
same quote validator the hire path uses — imported, not reimplemented. That
invariant is [decision 5](#5-the-probe-sends-exactly-what-a-hire-sends), and it
is the most expensive lesson in this repository.

Not probed at all: reference-only service labels (`web`, `oasf`, `ens`, `did`,
`email`, `docs`, `icon`) fail without a request. Templated `{agentId}` URLs are
`invalid` and are **never** substituted — substituting one manufactures a false
"live" claim for an agent its own platform reports as unbound.

### 4 · The catalog — written sparingly, on purpose

Only a `live` verdict writes to `agents`. And an unchanged re-probe writes
**zero bytes**: `lastVerifiedAt` lives on `agentVerification`, and the upsert
compares the user-visible fields before patching. Every write to `agents`
invalidates the paginated queries the entire frontend is subscribed to, so a
write has to mean that something a person would actually see has changed.

Reads are index ranges, never scans:

| Query | Index | Answers |
|---|---|---|
| `agents.list` | `by_status_rank` / `by_status_category_rank` | browse, cursor-paginated |
| `agents.list` + protocol | `by_status_protocol_category_rank` | "agents I can actually run" |
| `agents.search` | `search_text` (search index) | server-side, relevance-ordered |
| `agents.get` | `by_key` | the detail page, one point lookup |
| `agents.signals` / `getMany` | batched by key | never one query per rendered row |
| `facets.list` | one document | the browse chips, as data |

`LiveMetric<T>` wrappers — status, source, timestamp, methodology — are
constructed in the query's return mapping, not stored. The label and the
methodology sentence are constant per field; storing them multiplied every
document for no gain.

### 5 · Leaving, and coming back

A listed agent is re-probed every 24 hours. When it fails:

```
   live ──fail──► degraded ──fail ×3──► unavailable
     ▲              │                        │
     └──────────────┴────one success─────────┘
```

`degraded` is still visible and marked — the honest state between *working* and
*gone*. At three consecutive failures it drops out of browse and search. **The
row is never deleted**, so an existing hire's page and a shared link still
resolve and say the agent is not currently hireable. One successful probe
relists it. No human in the loop.

Backoff is set by *why* it failed, because a transport failure recovers on its
own and a structural one does not: `1 h → 4 h → 12 h → 24 h → 3 d → 7 d` for
`unavailable`; a flat 30 days for `invalid`. And when **8004scan** is the thing
that's down, `deferProbe` reschedules without touching state — the one failure
mode that would otherwise delist the entire catalog at once.

### The funnel, measured

Left: the pipeline this replaced, read off the live deployment on 2026-09-07.
Right: the first three cycles of the current one, against the same registry.

```
   BEFORE                              AFTER
   ────────────────────────────        ────────────────────────────
   ledger rows          257,991        records walked         2,400
     rejected-prefilter 251,922          screened out         1,922   (0 rows)
     rejected-classifier  5,921          candidates queued      478
     pending                122          probed                 281
     published               26            live                  12  ◄ the catalog
   visible to a user         12            unavailable          188
                                           invalid               81

   ~9,900 rows per listed agent        2 rows per listed agent
```

`convex/` went from 11,833 lines to 8,978 while *gaining* MCP support, an SSRF
boundary, pagination and full-text search.

The finding that most justified the rebuild: **all twelve live agents are MCP.**
Every one would have been unlistable under the old backend, which spoke only
A2A on the listing path. They also arrived carrying categories the old
hard-coded taxonomy had no room for — `prediction`, `payments`, `defi`,
`general` — and those appeared in the browse chips with no code change at all.

## V. The life of a hire

Hiring is deliberately four separable things, and Dolphin never lets one imply
another. Identity is not authorization. Authorization is not payment. Payment is
not execution.

```
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │   IDENTITY   │   │   PAYMENT    │   │AUTHORIZATION │   │  EXECUTION   │
  │              │   │              │   │              │   │              │
  │ SIWE sign-in │   │  ERC-8183    │   │ Altana scoped│   │  the agent   │
  │ wagmi wallet │   │  escrow job  │   │   session    │   │   does work  │
  │              │   │              │   │              │   │              │
  │ who you are  │   │ money moved  │   │ what an agent│   │ not simulated│
  │              │   │ and verified │   │  may spend   │   │  by Dolphin  │
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
     required          only if the        gated off —         never faked
                       agent quoted        see below
```

### Signing in

`walletAuth.ts` implements SIWE. The server builds the EIP-4361 message, stores
it, and verifies the signature **against its own stored copy** — never against a
message the client sends back, because a client that chooses its own message can
sign anything and present the result as a login. Sessions are stored as SHA-256
of the bearer token, so a dump of that table yields no usable credential, and
expiry is enforced on read rather than by a sweep.

### Free hires

`agentHires.hireReadOnlyAgent` writes a subscription record. No signature over
money, no spend cap, no allowlist — a wallet address and a row. It costs exactly
zero, which is why the read-only price model can honestly price it at zero
without claiming anything about what the publisher charges.

### Paid hires

Paid hires settle over **ERC-8183**, not x402 — a decision made by measurement
rather than by assumption. Every service endpoint of all 17 catalog agents was
called live on 2026-08-31 and **not one answered HTTP 402**. What the paid
agents actually publish, in their own cards and descriptions, is an on-chain
job-escrow kernel negotiated over A2A. Three independent sellers were pulled for
real wallet-signed quotes; all three named the same kernel, the same token and
the same chain.

`convex/agentPayments.ts` is exactly two things, and keeping them
distinguishable matters:

- **A relay.** It POSTs to the seller on the client's behalf, because a browser
  genuinely cannot: 2 of the 3 live sellers answer a CORS preflight with 405 and
  no `Access-Control-Allow-Origin`, so the identical request succeeds from a
  server and is blocked from a browser. A relay forwards bytes. It holds no key
  material and can move no token.
- **A witness.** `recordJobPayment` does not take the client's word that a
  payment happened. It reads the kernel on BSC itself and checks the job exists,
  is funded, was funded by *this* wallet, pays *this* agent's registered wallet,
  and carries the amount quoted. Only then does a row land — and the writer is
  an `internalMutation`, so there is no public way to assert a payment that
  didn't happen.

The seller is never trusted about who gets paid. A quote names an address; that
address must equal the agent's registered ERC-8004 wallet, which Dolphin reads
from the catalog itself rather than accepting as an argument. If the client
supplied both halves of that comparison, a tampered client would simply supply a
matching pair.

The transaction is signed in the browser, by the user's passkey. Convex can
report what happened. It can never cause it.

### Reviewing

Two questions, not five stars: *did it do what it said it would*, and *would you
hire it again*. A five-star mean over a marketplace this size reorders on a
single opinion, and "how did you feel about it" is the wrong question for
software that moves money.

Three gates, all in the mutation because a gate the client owns is not a gate:
the reviewer is **authenticated**, has **hired it**, and has **lived with it for
24 hours**. A cancelled hire still qualifies — excluding people who tried an
agent and stopped would select for satisfied users by construction. A review
carries its own provenance: `hiredAt` and `paidJobId` are copied onto it at
write time, so a paid review can be shown as the materially stronger signal it
is. Reviewers who want it can mirror the review to the ERC-8004 Reputation
Registry on-chain.

### Retention — the first honest ranking signal

Every agent in this catalog costs the same, `reputationScore` is null for a
third of it and exactly 0 for the rest, and `feedbackCount` measures activity
rather than quality. On the evidence the app can show, two agents in a category
are indistinguishable.

`agentRetention.ts` computes the one signal nobody else has, from `agentHires`
alone — no new table, no new source. And it computes it carefully: the
denominator is only hires **old enough to have survived the window**. A hire
made yesterday cannot have lasted a week; counting it as a failure punishes an
agent for being hired recently, and counting it as a success is a lie. This is
also why `cancelHire` patches the row instead of deleting it — a deleted hire
would vanish from the denominator and flatter every agent it happened to.

Small numbers are reported as numbers, never as percentages.

## VI. Wallets, and the two accounts

Dolphin uses two accounts, and the distinction is load-bearing.

| | Connected wallet | Dolphin Wallet |
|---|---|---|
| What | MetaMask / WalletConnect | Altana passkey smart account |
| Built with | wagmi `injected()`, Reown AppKit | `@altananetwork/sdk` |
| Used for | identifying you on a hire record | holding a scoped session |
| Can an agent spend from it? | **never** | only inside a granted session |
| Where | both products | browser targets, plus native iOS/Android |

They cannot be the same account, and that is a fact about the SDK rather than a
design preference: it ships exactly two usable signer families — private key and
WebAuthn passkey. `signerFromInjected` appears only in the package's own doc
comments and is never implemented or exported (verified by grepping `dist/`).
Both wallet screens say so in as many words.

Dolphin uses the **passkey** signer. Altana never persists key material and
cannot return a generated private key, so a private-key wallet would make this
app solely responsible for custody with no recovery path. See
`ALTANA_SIGNER_STRATEGY` in `src/wallet/altana-policy.ts`.

### The session lifecycle

```
 1. CREATE                2. FUND                  3. GRANT
 ┌────────────────┐       ┌────────────────┐       ┌────────────────┐
 │ createPasskey  │       │ send BNB to    │       │ grantSession   │
 │ Wallet()       │  ───► │ the address    │  ───► │  calls: [addr] │
 │                │       │                │       │  spend: cap/d  │
 │ Face ID /      │       │ counterfactual │       │  expiry: N d   │
 │ Windows Hello  │       │ and empty till │       │                │
 └────────────────┘       │ this happens   │       │ one passkey tap│
  no seed phrase          └────────────────┘       └───────┬────────┘
  no key leaves            no gas until funded             │
  the secure element                                         ▼
                                             ┌───────────────────────┐
                                             │ recorded in Convex    │
                                             │ agentSessions —       │
                                             │ public detail only,   │
                                             │ never a key           │
                                             └───────────┬───────────┘
 4. THE AGENT ACTS, INSIDE THE BOUNDARY                  │
 ┌───────────────────────────────────────────────────────▼─────────────┐
 │  execute(session, calls)                                            │
 │                                                                     │
 │    allowlisted contract, within cap   ──►  proceeds                 │
 │    any other contract                 ──►  REVERTS                  │
 │    spend over the cap                 ──►  REVERTS                  │
 │    any call after expiry              ──►  REVERTS                  │
 │                                                                     │
 │  Enforced by the Altana account contract at validation time, on     │
 │  chain — not by Dolphin, and not by the agent choosing to behave.   │
 └─────────────────────────────────┬───────────────────────────────────┘
                                   ▼
 5. REVOKE, AT ANY TIME — from the wallet screen and from the hire record
    itself. Immediate. The row is kept and marked revoked rather than
    deleted, so "I revoked that" stays checkable afterwards.
```

**Not every agent gets a session.** Granting spend authority to an agent that
only delivers information would imply a capability it does not have:

| Category | Session? | Allowlisted contract | Why |
|---|---|---|---|
| Health factor | yes | Venus Core Pool Comptroller | acting before a liquidation *is* the job |
| Rebalancing | yes | PancakeSwap V3 Position Manager | rebalancing a position means moving it |
| Yield | yes | Aave V3 Pool | moving capital to the best venue is the job |
| Grid trading | **no** | — | no wired data source, no verified venue address — a session would be authority into a blind spot |
| Monitoring | **no** | — | information delivery, by definition |

Every allowlisted address is one this repo had **already** verified
independently against the protocol's own deployments file, for its live-stats
reads. This feature introduced no new contract address, deliberately: an
allowlist is the one place a wrong address becomes real authority over real
money. A consequence worth knowing — these allowlists are narrower than a full
strategy would need, and a call outside them is rejected on-chain. That is the
guardrail working.

`calls` is never omitted. Altana reads an omitted or empty `calls` as *"any
contract"*, so `buildSessionPermissions` throws rather than emit permissions
without it, and the Convex mutation refuses to record an empty allowlist.

**Session granting is currently gated off** — `FEATURE_SESSION_EXECUTION` in
`altana-policy.ts` is `false`, and the grant UI is removed from the rendered
tree rather than disabled. Not because it is unfinished. A granted session's key
is never delivered to an agent and nothing in Dolphin can execute with one, so
offering the grant charged real mainnet BNB for a permission that could not be
used. The gate lifts when there is something on the other end of it.

## VII. The decisions

Each of these is a fork the project actually stood at. Dated lines are incidents
this repository can point to.

#### 1. Two products, one backend — and the backend is deliberately thick

The Expo web export is not a website: it renders React Native through
`react-native-web` into a client-side shell with no server rendering, no
per-route metadata, and a DOM of `<div>`s. That is fine for an app and fatal for
`/agent/[id]`, which is the page that has to be indexed, linked and shared. The
reverse merge — dropping the native app for a PWA — loses app-store distribution
and the native wallet integrations. Solito or a shared `packages/ui` is the real
third option; it was not taken for reasons of sequence rather than analysis, and
that is written down honestly in `Agent/DECISION-2026-09-08-two-frontends.md`
along with the triggers for revisiting it.

The cost is not "two codebases" — it is **one-directional drift**, and it always
lands in the client layer, never the shared one. Reviews, retention, the
cancel path and onboarding each existed on mobile with the backend complete
before reaching the website. Hence the rule: if a rule can be enforced
server-side it must be, and neither client may re-implement it.

> 2026-09-06 — the backend swapped `walletAddress` for `sessionToken` on every
> authenticated write. `web/src/convex/api.ts` is hand-annotated, so nothing
> failed to compile, and every hire on the website failed at runtime.
> `web/npm run check:convex-api` exists because of that outage and runs first in
> CI.

#### 2. Identity is `agentKey`, everywhere, never a bare token id

```
   56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:302257
   └┬┘ └────────────────────┬─────────────────┘ └──┬──┘
 chainId          registry address (lowercase)   tokenId
```

Byte-identical to the `agent_id` 8004scan publishes. BNB Chain has more than one
ERC-8004-shaped registry and their token ids collide, so a bare id is not an
identity. The old schema keyed its ledger on the qualified triple and every
other table — hires, reviews, escrow jobs, session grants, live stats — on a
bare `tokenId`. The old code already had a branch admitting it: an entire second
registry was held at `pending` forever, with the stated reason that publishing
one of its agents *"would silently merge two agents"*.

Bare ids are still accepted on the **read** path via `coerceAgentKey`, so
existing deep links keep working. Nothing writes one.

The registry address is lowercased rather than checksummed, because it is being
used as a database key and a key that can be spelled two ways is two keys.

#### 3. Persist the expensive decision. Re-derive the cheap one.

The single most consequential line in the rebuild. The old pipeline wrote a row
for every record its string prefilter rejected — 251,922 rows, 97.6% of a
257,991-row database that existed to describe 26 agents. It bought incremental
sweeps with storage proportional to the **registry**, forever, against a
registry growing by ~1,348 identities a day.

The inversion is the point: re-running a string function costs microseconds and
zero storage; re-running a probe costs a network round trip. The ledger cached
the former and had run the latter on 148 records in nine days.

> 2026-09-02 — the deployment crossed its storage ceiling (349 MB of documents,
> ~1.05 GB with indexes) and the discovery sweep was commented out. It had not
> advanced for five days when the rebuild started.

Nothing on the current schedule can repeat it, because nothing on it writes a
row per record seen. `agentStatsHistory`, the one table that only grows, is
bounded on both axes — one observation per hour per agent-category, pruned to a
maximum.

#### 4. Categories are open strings. Stats categories are a closed set.

Two different things are called a category here, and confusing them is the
mistake to avoid.

`agents.categorySlug` is `v.string()` — *what drawer does this agent browse in*
— so a category nobody has thought of yet costs no code change. The browse chips
are read from `catalogFacets`, computed from the data. `prediction` was invented
by the registry and reached the UI with no deploy.

`agentLiveStats.category` is a closed union — *which hand-written protocol
reader runs* — and that set really is finite, because each member is code
written against a specific contract. `lib/statsCategory.ts` is the only bridge
between them and returns `null` for a category with no reader, which renders as
an explicit "not connected" rather than a number.

> The old `AgentCategory` was a validator union in six modules and both clients.
> Adding `trading` on 2026-09-03 meant a schema change, a scorer edit, a ruleset
> version bump and a re-judge of the whole ledger — and the category still sat
> empty for two days, because the search vocabulary deciding what 8004scan was
> *asked* for was a separate hard-coded list nobody extended.

The screen's largest old rule was a 90-term DeFi vocabulary that rejected
anything not mentioning on-chain finance. That was a category filter wearing a
spam filter's clothes, and it is the single biggest reason the catalog could
never grow past a handful of DeFi tools.

#### 5. The probe sends exactly what a hire sends

`lib/probe.ts` imports `buildA2ARequest`, `resolveA2AEndpoint` and
`normalizeQuote` from `lib/erc8183.ts`. It does not reimplement any of them.
Four violations of this are on the record, each of which made working agents
look dead — and two were real defects in the **hire** path that only the probe's
disagreement exposed:

```
   probe asked only the optional {skill:"list"}   →  5 sellers reported broken
   envelope hand-rolled as params:{skill}         →  all but one family rejected
   endpoint derived by stripping the card path    →  wrong URL for 2 of 3 shapes
   buildA2ARequest omitted the spec-required kind →  3 strict sellers rejected
```

There is also now exactly **one** gate. The old backend had two — `liveness.ts`
decided what got published, `sellability.ts` decided what got listed — and they
disagreed, so "is this agent in the marketplace" had two answers (26 and 12) and
neither was authoritative.

#### 6. Rank is a stored number, not a read-time sort

Cursor pagination requires it. A cursor is a position in an index; if the
ordering is computed at read time, two rows can swap places between page one and
page two, and the reader sees one agent twice and never sees another.

`rank` is also explicitly **not a quality score** and is never rendered as a
number. It is shelf position. Every input is a fact Dolphin verified itself or
read from a named source. A `test` / `demo` / `sandbox` marker is a rank
*penalty* rather than a rejection — the filter it replaced hard-rejected any
name matching `/\btest\b/`, and a working PancakeSwap grid-trading agent
deployed as `bnb-grid-trader-test.agent` survived only because a human had
curated it separately.

#### 7. Curation boosts rank. It never exempts from verification.

Nine editorial agents used to be a 160-line TypeScript literal compiled into the
backend, merged ahead of everything and exempt from every gate — so adding one
required a deploy, and three of them were failing the listing gate while still
being merged in. `curated: true` is now a flag on an ordinary row. A curated
agent whose endpoint dies is delisted like any other.

#### 8. Every outbound fetch goes through one boundary

Agent cards, A2A and MCP calls, icons, and the registration file read — that last
one worst of all, because its URL comes from an on-chain `tokenURI` that anyone
can set to anything for the price of gas. `lib/safeFetch.ts` enforces
https/http only; rejects literal IPs, `localhost`, `.local`, and the private /
loopback / link-local / CGNAT / IPv6-ULA ranges; follows redirects **manually**,
at most 3, re-validating every hop; caps bytes *while streaming*, because a
`content-length` header is a claim rather than a limit; and forwards none of
Dolphin's own headers, cookies or credentials.

What it is not: a DNS-rebinding defence. Closing that window needs
connection-level control the Convex runtime does not expose. The honest
mitigation is that the runtime holds nothing worth reaching — recorded here
rather than left for someone to discover.

> Found and fixed during the rebuild: `resolveA2AEndpoint` on the **hire** path
> was fetching a publisher-controlled card URL with default redirect following
> and no size cap.

#### 9. Payments settle over ERC-8183 because x402 had no counterparty

Not a judgement about the protocols. Every endpoint of all 17 catalog agents was
called; zero returned HTTP 402. The SDK ships x402 as `fetchWithX402` /
`signX402Payment` and it works as documented — the only thing missing is a
seller. Nothing in `erc8183.ts` assumes it is the only rail; it assumes it is
the only rail with a counterparty today, and a second one slots in beside it the
moment some endpoint in this catalog answers 402.

#### 10. `null` is not zero, and "unavailable" is not "empty"

`pricing: null` means *no price published*, never *free*. The previous catalog
priced every agent at a hard-coded `0 BNB` as marketplace policy while real
ERC-8183 quotes went unread, so paid agents rendered as free and the manage
screen printed "Free" over a hire that had cost money.

`reputationScore` is null unless at least one feedback sits behind it — an
average over zero is an artefact, not a rating, and showing one would be a
fabricated number in the place users trust most. Performance charts need at
least two dated, sourced observations; an agent nobody has opened twice has no
chart, and that is the honest answer rather than a flat line.

The rule extends to *absences*. When the backend is unreachable, both surfaces
say the catalog is unreachable. Neither says the catalog is empty.
(`web/src/components/backend-status.tsx`.)

## VIII. The map

```
   convex/                     the backend both clients read
     schema.ts                 12 tables, each commented with why it exists
     discovery.ts              incremental sweep + budgeted backfill
     verification.ts           fan-out, backoff, delist, recover
     agents.ts                 list / search / get / getMany / signals
     facets.ts                 the browse chips, as data
     agentHires.ts             free hires
     agentPayments.ts          ERC-8183: relay + witness, never signer
     agentReviews.ts           two questions, three gates
     agentRetention.ts         the one ranking signal nobody else has
     agentSessions.ts          Altana grants — reference detail, never a key
     categoryStats.ts          live protocol reads + the track record
     walletAuth.ts             SIWE
     lib/
       screen.ts               the cheap screen (writes nothing)
       probe.ts                the one gate
       erc8183.ts              quote envelopes, dialects, provider check
       safeFetch.ts            the outbound boundary
       rank.ts                 shelf position, not quality
       statsCategory.ts        open catalog category → closed reader set
     model/agent.ts            agentKey, and the internal model
     sources/scan8004.ts       the ONLY file that knows 8004scan's field names
     protocols/                one file per protocol
       venus.ts                health factor, derived per-market
       pancakeswap.ts          V3 LP positions → rebalancing
       aave.ts                 supplied collateral → yield
       unavailable.ts          explicit stubs, never TODOs in a real module

   src/                        the Expo app
     app/(tabs)/index.tsx      Discover — catalog + category chips
     app/(tabs)/search.tsx     server-side search
     app/(tabs)/my-agents.tsx  real hires + device-only previews
     app/(tabs)/wallet.tsx     wallet and capability status
     app/agent/[id].tsx        detail; hiring happens in hire-sheet.tsx
     app/category/[slug].tsx   full category listing
     app/manage/[id].tsx       post-hire: delivery, review, cancel
     app/account/index.tsx     account + Dolphin Wallet
     app/onboarding/index.tsx  first-launch explainer
     wallet/                   Reown AppKit, Altana, the native passkey bridge

   web/                        the Next.js site — see web/README.md
     src/app/page.tsx          discover
     src/app/search/           search
     src/app/agent/[id]/       detail + generated OpenGraph image
     src/app/manage/[id]/      post-hire
     src/app/my-agents/        hires
     src/app/wallet/           wallet
     src/app/onboarding/       explainer
     src/convex/api.ts         hand-annotated backend contract — see below

   Agent/                      git-ignored working context: the product scope,
                               architecture records, decisions, session logs.
                               Start at Agent/AGENT_INDEX.md. A fresh clone
                               will not have it; source comments cite it.
```

Two mirrors are maintained **by hand** and are a standing hazard:
`src/types/agent.ts` ↔ `web/src/types/agent.ts`, and `convex/*.ts` ↔
`web/src/convex/api.ts`. The second caused a production outage and is now
guarded by `web/npm run check:convex-api`, which parses the real Convex modules
and asserts every function the site declares still exists, is public, and still
takes the arguments declared. The first is not guarded and should be.

## IX. Running it

Node 20+, npm, and an Expo SDK 57-compatible native toolchain for device builds.

### The backend

```bash
npx convex dev        # interactive browser login on first run
```

It writes `CONVEX_DEPLOYMENT` and `EXPO_PUBLIC_CONVEX_URL` into `.env.local`
itself, and `convex/_generated/` is real codegen output once it has run — do not
hand-write stand-ins for it. Leave it running in a second terminal; it pushes
function changes live.

**`npx convex dev` *is* the backend's typecheck.** Standalone `tsc` cannot see
across the generated API, and a real defect got through exactly that gap:
Convex serializes an action's return, so `undefined` becomes `null` and
`runAction` is `Promise<null>` — invalid in a `Promise<void>` handler, and
invisible to `tsc` alone.

### The website

```bash
cd web && npm install
cp .env.example .env.local     # then set NEXT_PUBLIC_CONVEX_URL
npm run dev                    # http://localhost:3000
npm run verify                 # convex-api · isolation · typecheck · lint · test
```

Deployment, environment variables and the two guard scripts are documented in
full in [`web/README.md`](web/README.md). Short version: Vercel builds `web/` via
its own Git integration, nothing in `.github/workflows` deploys it, and CI is
the gate Vercel does not provide.

### The app

```bash
npm ci
cp .env.example .env
npx expo start
```

```dotenv
EXPO_PUBLIC_CONVEX_URL=
EXPO_PUBLIC_REOWN_PROJECT_ID=
EXPO_PUBLIC_BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
EXPO_PUBLIC_ALTANA_RP_ID=
```

`EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` values are inlined into public bundles by
design. None is a secret, which is exactly why nothing private may ever carry
those prefixes. The one real secret in this project (`SCAN8004_API_KEY`) is
Convex-side only.

Wallet deep-link return through `dolphin://` needs a native build. The static
web export deliberately shows a native-build-required wallet state.

### Native builds (EAS)

Three profiles. The one that matters for getting the app onto someone else's
phone is **`preview`**: internal distribution, and Android builds an **APK**
rather than an app bundle, because an `.aab` cannot be sideloaded and a reviewer
with a link needs a file that installs.

```bash
eas login
eas init                                                # writes extra.eas.projectId, once

eas build --profile preview --platform android          # installable APK
eas build --profile preview --platform ios              # needs an Apple Developer account
eas build --profile preview:simulator --platform ios    # no Apple account needed
```

**Set the client environment before building.** These are read at build time and
baked in, so a build made without them ships a degraded app rather than failing
loudly — with `EXPO_PUBLIC_CONVEX_URL` unset the catalog loses every discovered
agent:

```bash
eas env:create --scope project --name EXPO_PUBLIC_CONVEX_URL      --value <url>
eas env:create --scope project --name EXPO_PUBLIC_REOWN_PROJECT_ID --value <id>
eas env:create --scope project --name EXPO_PUBLIC_BSC_RPC_URL     --value <url>
eas env:create --scope project --name EXPO_PUBLIC_ALTANA_RP_ID    --value <domain>
```

`appVersionSource` is `local`, so `app.json`'s `version` is authoritative and a
build's identity does not depend on remote state. A `development` profile is
deliberately absent: `developmentClient` builds need `expo-dev-client`, which
this project does not depend on.

### Verifying

```bash
npx tsc --noEmit
npm run lint
npx expo install --check
npx expo-doctor
npx expo export --platform web
```

## X. What is true, and what is not yet

The most useful thing a README can do is separate the two.

**Verified live, against real infrastructure**

- The full discovery → verification → catalog pipeline, against BSC mainnet and
  the real 8004scan registry. Idempotency proved by accident when a deploy-time
  cron raced a manual run: 800 records seen twice produced 197 rows and zero
  duplicates.
- Pagination, server-side search, category filtering, facets, deep-link
  compatibility for bare token ids, and an unknown agent returning `null` rather
  than throwing.
- SIWE sign-in, including replay and forged-token rejection.
- ERC-8183 quote negotiation against three independent live sellers, both quote
  dialects, with the provider check confirmed byte-for-byte against the
  registered agent wallet.
- The ERC-8004 Reputation Registry address, verified six ways before a line was
  written against it.
- `createPasskeyWallet`, `recoverFromPasskey`, balance reads and the
  session-granting UI, in a real browser against a real WebAuthn ceremony, on
  both products.

**Built, compiles, not yet observed**

- **The native passkey path has never raised a Face ID or fingerprint prompt.**
  It typechecks, lints and bundles for Android, and it is built against the
  installed SDK sources read directly rather than against changelog prose — but
  iOS and Android only run a ceremony for a domain the app has proved it owns.
  That needs `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` served over HTTPS from the relying-party host,
  matching `ios.associatedDomains` in `app.json`.
  `src/wallet/altana-rp-id.ts` holds the exact file contents. Until they are
  served the OS declines, and the app surfaces that refusal rather than
  pretending. Altana say the same of their own side: their CI proves the
  WebAuthn forwarding with mocks and is not yet exercised on physical devices.
- **On-chain session enforcement has not been watched happen here.** Dolphin's
  Altana wallets are on BSC **mainnet**, so a grant costs real BNB. The
  grant → in-bounds → out-of-bounds-rejected → revoke lifecycle is built to the
  documented API; the revert-at-validation-time behaviour is Altana's guarantee,
  not this repo's observation. `scripts/spike-b-auth.mjs` produces that proof
  against chain 97 the moment its derived address is funded — it grants a
  one-hour session limited to one harmless precompile and a one-wei daily cap,
  executes once, revokes, and confirms the revoked session is rejected. It has
  never been reported as passed here, because the address has never been funded.

  ```powershell
  $env:ALTANA_TEST_PRIVATE_KEY = "<disposable-testnet-private-key>"
  npm run spike:altana
  Remove-Item Env:\ALTANA_TEST_PRIVATE_KEY
  ```

  `scripts/spike-altana-env.mjs` is the free companion: no key, no funding, no
  transaction. It reports what the SDK does and does not support in the current
  environment.
- **No agent in the catalog has yet returned a payable quote**, so `pricing` is
  null on all of them and the paid-hire path is unexercised end to end against a
  live seller in this deployment.

**Honestly unavailable, and labelled as such in the product**

- Grid trading, trading and monitoring stats. Grid trading is the instructive
  one: this backend reads PancakeSwap V3 **LP-range positions**, which is a
  different on-chain footprint from a price-ladder grid bot's order book. Saying
  so is the answer; approximating one with the other is not.
- Aave APY (needs a ray-to-APY conversion not yet written) and Lista DAO reads.
- Venus health factor is a real derived read — per-market, from
  `getAssetsIn` + `getAccountSnapshot` + collateral factor + oracle price, since
  Venus exposes no single ratio — but it is **unverified against a live funded
  position**. Spot-check it against app.venus.io before trusting it in a demo.

**Backlog, written down rather than hidden**

- Review comments are free text with no moderation. Capped in length, stored as
  typed. It is the reason the structured answers carry the signal and the
  comment is decoration.
- `src/types/agent.ts` ↔ `web/src/types/agent.ts` is hand-mirrored and unguarded.
- The backfill has walked a fraction of the endpoint-publishing population; the
  catalog is the newest slice, not the whole chain.

---

Working on this repo? Read [`AGENTS.md`](AGENTS.md) first — it is the
contributor contract, and it overrides defaults you may be carrying about Expo,
Next, or this stack. `Agent/project-scope.md` holds the product scope.

Licensed under the MIT terms in [LICENSE](LICENSE) — still the copyright line
Expo's template shipped with. Replace it before publishing.
