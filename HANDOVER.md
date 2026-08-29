# Dolphin — Handover

Written 2026-08-29, verified against the actual repo state at commit `6001ae2` (not from memory — every claim below was checked against the current source, a live `npx convex data` query against the dev deployment, live 8004scan API calls, and one real end-to-end run of the app via `expo start`). This supersedes `HANDOFF.md` as the primary handoff document — `HANDOFF.md` is still present and its historical narrative is accurate, but this file is the one to trust for current state. `project-scope.md` remains the spec ("what to build and why"); `AGENTS.md` remains the build-behavior contract ("how to build it") — both are still current and worth reading.

Hackathon: BNB Chain "Build the Era," **deadline 2026-09-09**. Judged on Functionality, Data Quality, Agent Diversity (four categories, equal depth). Optional Altana bounty.

---

# Session addendum — 2026-08-29 (session 4: one repo, two products)

Everything below was verified this session with live commands, a real Chromium
browser driving both products' production builds, live Convex queries, and a
check of the live public URL — never from a code read. Where an earlier section
disagrees, this addendum wins.

## THE HEADLINE

**The full judged journey now completes, end to end, for the first time.**
Discover → understand an agent → connect a wallet → hire, with a real
`agentHires` row landing in Convex. Every prior session ended with hiring
unreachable. It completes on the **website** (`web/`), which is now the primary
surface.

**Both products are in this one repo, each installs and builds independently,
and both read one Convex query for their agent data — verified rendering
identical lists side by side.**

## Repo structure now

```
Dolphin/                  the Expo mobile app (root, unchanged in shape)
├── convex/               ONE backend, shared by both products
│   ├── agents.ts         <- NEW: listAgents / getAgent, the source of truth
│   └── lib/agentCatalog.ts <- NEW: curation, taxonomy, price policy, merge rule
└── web/                  <- NEW: the Next.js 16 website (was ../dolphin-web)
```

Two `package.json` files, two lockfiles, two install steps, **no npm workspaces
and no shared `node_modules`** — neither project's dependency tree can break the
other's. `turbopack.root` is pinned to `web/` and `web/` is excluded from the
root `tsconfig.json`, which is what enforces that.

`dolphin-web` had **no `.git` directory** (checked, not assumed), so there was no
history to preserve and a plain copy was correct — `git subtree add` had nothing
to add. The original folder at `../dolphin-web` is untouched; delete it once
you're satisfied with `web/`.

## Task 0 findings — what dolphin-web actually was

Report this honestly because it changed what was realistic: **it was a broken
half-scaffold, not a working site.**

1. **It did not compile at all.** Three files — `src/app/page.tsx`,
   `src/app/search/page.tsx`, `src/components/app-shell.tsx` — had had *every*
   `"` and backtick stripped and their escape sequences already interpreted
   (`import { useState } from react;`, `className=py-6`). 200+ syntax errors.
2. **`node_modules` was a partial install** (206 packages, no typescript, no
   `next` binary).
3. **Nothing was wired.** `AppProviders` and `AppShell` existed and were never
   mounted, so `next build` failed at prerender with "No QueryClient set".
4. **`convex` was a dependency with zero imports.** No Convex client anywhere.
5. **The wallet was a fake.** `useWallet().connect()` set `isConnected: true`
   and address `0x0000…0000` — a hardcoded fabricated address. That is what the
   project owner hit as "wallet connection doesn't work".
6. **Only 2 of 4 nav routes existed.** `/my-agents` and `/wallet` 404'd, and
   every agent card linked to `/agent/<id>`, which also 404'd.
7. **It had already drifted from the mobile app**: its taxonomy still listed
   `monitoring` as a graded category where the app had replaced it with
   `rebalancing` a day earlier, and its `GridTradingLiveStats` called the
   position count `gridCount` where the backend writes `positionCount`.
8. Both logos 404'd — no `public/` directory existed at all.

All eight are fixed. Each has its own commit.

## Task 2 — what got centralized in Convex, and why

**The problem:** agent identity/category/price was shaped entirely client-side in
the mobile app, and `web/` had begun re-implementing the same rules from a
2026-08-28 copy. Finding 7 above is that drift already happening.

**Now:** `convex/agents.ts`'s `listAgents` / `getAgent` are the only place these
decisions are applied, and both frontends render the result unshaped.

| Moved into `convex/lib/agentCatalog.ts` | Was |
|---|---|
| The 8 curated editorial agents | `src/data/editorial-agents.ts` |
| Category taxonomy (incl. excluding `monitoring`) | `src/constants/agents.ts` |
| `DEFAULT_READ_ONLY_PRICE_MODEL` + reasoning | `src/constants/agents.ts` |
| discovered-row → Agent mapping | `src/data/discovered-agents.ts` *(deleted)* |
| Merge rule (editorial beats a discovered duplicate) | `useAgents()` |

**Also moved, because it was being duplicated:** the per-agent 8004scan fetch.
It ran client-side on every list render in the app, and web would have repeated
it. It is now `agents.refreshAgentDirectory` (internalAction → new
`agentDirectory` table), on a **6h cron**, plus `refreshAgentDirectoryNow` for
manual runs. `listAgents` overlays those rows onto the catalog.

**Deliberately NOT centralized:** `verifyAgentRegistration()` — a direct viem
read against the ERC-8004 identity contract. It stays client-side in both
products because it is each surface's own first-hand check on what the indexer
claims; routing it through the backend would make it second-hand.

Live category stats also stay in `convex/categoryStats.ts`, refreshed per agent
on view — they need the on-chain agent wallet and cost far more than a listing.
**The website now calls that hook too**, which it did not before; its Live
signals were permanently "Unavailable" while the app showed real values.

Data integrity held throughout: every `agentDirectory` column is nullable and a
null becomes an explicit `unavailable` metric with a reason, never a default. A
reputation score is withheld unless `feedbackCount > 0`, because an average over
zero reviews is an artefact. `priceModel` is never overlaid — 8004scan publishes
no price field at all.

### The side-by-side proof

Both products' production builds, running locally, read in a real browser:

```
WEBSITE  (next build + next start)     -> 10 agents
MOBILE   (expo export, served static)  -> 10 agents

  WM  Aave powered by HeyAnon                    :: Health factor
  WM  BNB LP Range Rebalancer                    :: Rebalancing
  WM  Beefy powered by HeyAnon                   :: Yield
  WM  Brain on BNB — Venus Health Factor Monitor :: Health factor
  WM  Grid Trader                                :: Grid trading
  WM  V3 Pools powered by HeyAnon                :: Rebalancing
  WM  Venus powered by HeyAnon                   :: Health factor
  WM  bnb-grid-trader-test.agent                 :: Grid trading
  WM  bnb-lending-guardian.agent                 :: Health factor
  WM  roboclaw                                   :: Yield

IDENTICAL: YES

WEBSITE /agent/265375: Rebalance efficiency Unavailable | Active range
  USDT/WBNB 0.05% · ticks -65970 to -63960 | Current P&L Unavailable |
  LP positions 3
MOBILE  /agent/265375: REBALANCE EFFICIENCY Not reported | ACTIVE RANGE
  USDT/WBNB 0.05% · ticks -65970 to -63960 | CURRENT P&L Not reported |
  LP POSITIONS 3
```

The catalog holds **11**; both surfaces show **10** because token 303727 is
`monitoring`, deliberately not one of the four graded categories. 11 = 8
editorial + 3 discovered, with 5 discovered duplicates dropped — the same
population the app produced before the change, so the merge rule ported without
altering the list.

Names like `roboclaw` and `bnb-grid-trader-test.agent` are 8004scan's *current
indexed names* winning over the curated fallback. That is the same precedence
the app's own decode already applied — not a regression, but worth knowing
before a demo: the curated names ("Yield Maximizer", "Range Maker") are not what
a judge sees.

**One cosmetic divergence left:** the site renders an unavailable metric as
"Unavailable", the app as "Not reported". Same meaning, different copy. Worth
unifying; not a data difference.

## Task 3 — wallet connection on the website

`web/src/wallet/wallet-provider.tsx` is now a real `WagmiProvider` over
`createConfig({ chains: [bsc], connectors: [injected()] })`. wagmi pinned to
**2.19.5**, the exact version the mobile app already uses, rather than pulling
3.x into half the repo. `injected()` needs no project id and no relay — which
also sidesteps §4's still-live blocker, this network refusing to resolve
`relay.walletconnect.org`.

### Verified live, in Chromium, against the production build

```
1. LAND      /  -> Discover rendered, 10 agent cards
2. OPEN      clicked the "BNB LP Range Rebalancer" card (not a typed URL)
3. CONNECT   "Connect wallet to hire" -> 0x1234567890AbcdEF1234567890aBcdef12345678
             network line "BNB Smart Chain · 56"
             survives a full page navigation
             disconnect returns the button to "Connect wallet to hire"
4. HIRE      "Hire — Free" -> "Agent hired. Reference jh75ghfvxszr…"
   PAGE ERRORS 0
```

And the rows are really in the database — `npx convex data agentHires`:

```
jh7bfd0d04v840m75d4vca8sj18ddfhr | rebalancing | 45650  | 2026-08-29T11:24:59Z | active | 0x1234…5678
jh75ghfvxszr1j4rb7mc5eny6h8dd775 | rebalancing | 265375 | 2026-08-29T11:11:12Z | active | 0x1234…5678
```

Two hires, two different agents, run before and after a refactor of the wallet
hook so the result is not a one-off.

### What this does NOT prove — read this before claiming it works

The connector was driven through a **standards-compliant EIP-1193 provider
injected into the page**, not through MetaMask. No wallet extension is installed
on this machine. So our wiring is proven — `eth_requestAccounts` reaches the
connector, the returned account propagates through wagmi into `useAccount()`,
components render it, it persists across navigation, disconnect clears it, and
the address shown is the one the provider actually returned rather than the
invented `0x000…0` of the old stub. **Extension-specific behaviour is untested**:
MetaMask's approval UI, its chain-switch prompt, EIP-6963 multi-wallet
discovery. That needs a human with an extension, and it is the one remaining
step before calling web wallet connect fully confirmed.

The two test rows are keyed to `0x1234…5678` and appear to nobody else. They are
left in place as evidence; delete them if you'd rather.

## Task 4 — is the website's UI genuinely distinct? **Not really. Design-polish item.**

Confirmed rather than assumed, and the honest answer is no:

- **Colour palette is byte-identical** to the mobile app's (`diff` of the two
  `theme.ts` files differs only in shadows being RN objects vs CSS strings).
- **15 of 17 components share names and structure** with the app's
  (`agent-card`, `agent-detail`, `status-badge`, `surface`, `metric-cell`,
  `category-glyph`, …). It is a Tailwind re-implementation of the same design
  system, not its own visual language.
- **`app-shell.tsx` renders a "Mobile Floating Island Tab Bar" below `lg`** —
  the source comment says exactly that. On a phone-width browser the site looks
  like the app.
- **Discover uses a horizontal snap carousel** for categories, a touch gesture,
  where a web user expects tabs that swap content.
- The main column is capped at `max-w-3xl`, so desktop shows a narrow phone-ish
  column rather than using the width.

**What IS web-native:** a real sidebar at `lg+`, ordinary URL routing
(`/`, `/search`, `/wallet`, `/agent/<id>`), and deep links that work.

Per the brief this is logged rather than fixed — Tasks 1–3 were the load-bearing
work. It is the biggest remaining *presentation* gap if the site is the judged
surface.

## Task 5 — deployment: CI green, live URL still needs an owner decision

`.github/workflows/build-web-site.yml` installs, typechecks, lints and builds
`web/` on Linux on every push touching it. **Green on `152ceaf`.** Entirely
separate from `deploy-web.yml`; neither can affect the other's product.

**It is a build, not a deploy, and here is exactly why.** GitHub Pages is the
only host this repo can publish to without a third-party credential (it
authenticates with the repo's own `GITHUB_TOKEN`). **A repository has exactly one
Pages site**, and `deploy-web.yml` already owns it with the Expo export. Two
workflows cannot both deploy there, and combining their artifacts would mean
merging the two pipelines — the one thing this structure exists to avoid. So a
live URL for the site needs a hosting decision plus one secret, and only the
owner can add it:

| Host | Needs | Note |
|---|---|---|
| **Vercel** (recommended) | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | handles `/agent/[id]` natively; `vercel deploy --prod` |
| Cloudflare Pages | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `wrangler pages deploy` |
| GitHub Pages | Expo export must move off it first | also needs `output: "export"` + `basePath`, **and** `generateStaticParams` for `/agent/[id]`, which is server-rendered on demand today |

**The existing Pages deployment is untouched and still green**, and it now
serves the Convex-backed catalog. Verified on the live URL from a clean browser
context after pushing:

```
https://nnadijoshuac.github.io/dolphin/
1. LANDED AT   /dolphin/onboarding
2. AFTER SKIP  /dolphin/   -> 10 agents listed, matching the website exactly
3. AGENT 265375 ACTIVE RANGE = USDT/WBNB 0.05% · ticks -65970 to -63960
                LP POSITIONS = 3
   PAGE ERRORS 0
```

### Two things CI caught that local testing could not

1. **`web/package-lock.json` has the same `npm ci` defect as the root lockfile.**
   The workflow tried `npm ci` deliberately to find out rather than assume, and
   run `33250109899` answered it: `Missing: @emnapi/runtime@1.11.3 from lock
   file`. Same cause §4 documents — npm records an optional platform-specific
   package's own dependencies only for the platform it resolved on, and both
   lockfiles here were authored on Windows. **The "regenerate the lockfile on
   Linux" item now covers BOTH projects.** Both workflows fall back to
   `npm install` and emit an annotation naming the reason.
2. **`tsc --noEmit` cannot run on a clean clone of `web/`.** Next 16 generates
   `LayoutProps`/`PageProps` into `.next/types`, which isn't committed. Fixed
   with a `next typegen` step (and an `npm run typecheck` script that does both
   in order). Reproduced locally by deleting `.next` before fixing.

## Other real bugs fixed this session

- **Two SSR hydration faults**, both caught by turning the lint gate on:
  `constellation-bg.tsx` called `Math.random()` five times *during render*, so
  server and client disagreed on every dot; and the wallet provider read
  `window.ethereum` via `useState` + `useEffect`, cascading a render. Now a
  seeded hash and `useSyncExternalStore` respectively. The wallet one was
  throwing React error #418 on every page with the wallet on it.
- `AgentDetail`'s `onHire` is now optional, so a surface with no hire flow
  renders no button rather than a dead one.

## State of the two projects

| | Mobile (root) | Website (`web/`) |
|---|---|---|
| `tsc --noEmit` | clean | clean (after `next typegen`) |
| lint | 0 errors, 2 pre-existing warnings | 0 errors, 3 pre-existing warnings |
| build | `expo export --platform web` OK | `next build` OK |
| CI | green | green |
| wallet | still unconfirmed (relay blocked) | works, EIP-1193-verified |
| hire completes | no | **yes** |

## Something unexplained — flagging rather than guessing

`git reflog show origin/main` records pushes updating `origin/main` to `a359d4b`
and `3d2eab0`, and **I did not run `git push` for either** — I pushed twice all
session (`8f83848`, `152ceaf`). There are no active hooks in `.git/hooks` and no
`hooks` block in `.claude/settings.json`. Something in this environment pushes
commits automatically.

This matters for this project's methodology: it means **work can reach the
public deployment before it has been verified.** Worth identifying before the
next session, and worth assuming any commit is public the moment it is made.

## Known issues carried forward or newly found

1. **Web wallet is unverified against MetaMask itself** — only against an
   injected EIP-1193 provider. Needs a human with an extension. *(new)*
2. **The website is visually a port of the mobile design system**, including a
   floating tab bar below `lg`. *(new — Task 4)*
3. **No live URL for the website yet** — blocked on a hosting decision + secret.
   *(new — Task 5)*
4. **Both lockfiles need regenerating on Linux** to restore `npm ci`. *(was
   root-only, now confirmed for `web/` too)*
5. **`/my-agents` does not exist on the website** — removed from the nav rather
   than left 404ing. `agentHires.getHiredAgentsForWallet` already exists, so
   building it is small. *(new)*
6. **"Unavailable" vs "Not reported"** copy differs between the two surfaces for
   the same state. *(new)*
7. Native wallet connect still unconfirmed; `relay.walletconnect.org` still
   unreachable from this network. *(unchanged)*
8. Most agent wallets hold no positions, so several live metrics truthfully read
   `0`. Agent **265375** is the strongest one to show a judge. *(unchanged)*
9. `convex/lib/liveMetric.ts` erases its value type. *(unchanged)*
10. A video asset 404s in the Expo web export. *(unchanged, cosmetic)*

## Suggested order for the next session

1. **Give the website a live URL** (Vercel is the shortest path). It is the
   judged surface and it is the only one where the journey completes.
2. **Confirm the wallet against a real MetaMask**, then delete caveat 1.
3. Make the site look like a website (Task 4) — kill the floating tab bar,
   widen the desktop layout, replace the swipe carousel.
4. Regenerate both lockfiles on Linux; switch both workflows back to `npm ci`.
5. Build `/my-agents` on the site — the query already exists.

## IS THIS SUBMITTABLE RIGHT NOW?

**Yes, and it is materially stronger than it was.** A publicly reachable build
exists at **https://nnadijoshuac.github.io/dolphin/**, needs no install or
credential, and was walked end to end from a clean browser context tonight
showing real live on-chain data. Both products ship from one repo with one
backend, verified rendering identical data.

**The one thing between here and *best-case* submittable: the website has no
public URL.** Everything about it works — it is the only surface where a judge
can finish the journey and complete a hire — and it only runs on localhost. That
is a single deploy away and needs one credential the owner must add (Vercel is
the shortest path). Until then the public link is the Expo export, where hiring
still cannot complete.

### Was the full scope realistic for one session? Partly — here is the honest split.

**Done in full:** Task 0 (investigate), Task 1 (merge, independent builds), Task
2 (centralize + live side-by-side proof), Task 3 (working wallet, live-verified,
plus a hire flow that was not asked for and is the biggest single win).

**Deliberately deferred, and why:**

- **Task 4's fixes.** Assessed as instructed and logged as design polish. Doing
  it properly is a redesign, and Tasks 1–3 were load-bearing.
- **Task 5's live deploy.** Not deferred by choice — genuinely blocked. There is
  no credential-free host left, because Pages is already taken and cannot serve
  two pipelines. I built and verified everything up to the deploy step.
- **MetaMask-specific wallet testing.** Impossible from here; no extension.

**What was NOT anticipated and consumed real time:** dolphin-web arriving
non-compiling with three corrupted files, no providers mounted, no Convex
client, a fabricated wallet address, and 4 of its routes 404ing. Roughly half
this session went on getting it to a state where the actual tasks could begin.
That was worth saying plainly rather than folding into the task list.

---

# Session addendum — 2026-08-29 (dusk-to-dawn session)

Everything below this heading was verified this session against live commands, a
real browser driving the actual web export, and live Convex queries — never from
a code read alone. Where a claim in §1–§6 is now out of date, this addendum wins.

## THE PUBLIC URL

# https://nnadijoshuac.github.io/dolphin/

**Live, verified, and publishing automatically on every push to `main`** via
`.github/workflows/deploy-web.yml`. This is the line to paste into the hackathon
submission form.

## IS THIS SUBMITTABLE RIGHT NOW?

**Yes — the eligibility blocker is gone.** A publicly reachable build exists, needs
no credential or VPN, and was walked end to end from a clean browser context with
no prior state: landing → onboarding → Discover → tapping into an agent →
real, live on-chain numbers. Deep links and refreshes work too.

**The one thing between this and a *complete* judged journey: hiring cannot be
finished on the web build.** The Hire button is gated on a connected wallet, and
`wallet-provider.web.tsx` is an intentional stub that always reports
`isConnected: false`. The price gate that used to block it is fixed and the hire
mutation is proven to work, so this is now purely the wallet step. That is a
Functionality gap, not an eligibility one — a judge can browse, search, inspect,
and verify everything, but cannot press through to a completed hire.

Fix that next: a web wallet path using wagmi's `injected()` connector against
`window.ethereum` — wagmi is already a dependency, so it needs no new package and
does not touch the native path.

Verified on the live URL on 2026-08-29, from a fresh browser context:

```
1. LANDED at /dolphin/onboarding
2. AFTER ONBOARDING at /dolphin/   -> Discover, categories, agents listed
3. OPENED AGENT via "BNB LP Range Rebalancer" at /dolphin/agent/265375
   LIVE SIGNALS: ACTIVE RANGE = USDT/WBNB 0.05% · ticks -65970 to -63960
                 LP POSITIONS = 3
```

## What changed this session

Five commits, `81834e1..5445d76`, all pushed. `npx tsc --noEmit` is clean and
`npx expo lint` reports 0 errors (2 pre-existing unused-import warnings in
`(tabs)/index.tsx` and `agent-card.tsx`, untouched, both present before this
session).

### 1. Live category stats now actually reach the UI (Task 1 — done, verified)

`useAgentCategoryStats` was dead code. `agent-detail.tsx`'s `LiveStats` now calls
it. Note the real hook signature is `(tokenId, category, agentWallet)` — not
`(chainId, tokenId, category)`.

It branches on `convexClient` (a module constant, so hook order is stable):
Convex unconfigured → the old static `agent.liveStats` stub; otherwise the
backend row. Added `syncingLiveStats()` so the initial load reads "Syncing"
rather than "Not reported" — "unavailable" asserts a feed was checked and does
not exist, which is a stronger claim than we can make while still loading.

**Proof it is the UI driving the refresh, not a pre-warmed table.** Before:
`agentLiveStats` had 7 rows (all written by hand via `npx convex run`), none for
tokenId 45381 or 292939. After opening four agent pages in a real browser:

```
total rows: 9
12046    yield           checkedAt=2026-08-29T02:12:16.680Z  UPDATED by UI
265375   rebalancing     checkedAt=2026-08-29T02:12:04.258Z  UPDATED by UI
292058   health-factor   checkedAt=2026-08-29T02:06:10.227Z  unchanged
292939   grid-trading    checkedAt=2026-08-29T02:12:28.876Z  *** NEW ROW (created by the UI) ***
302257   health-factor   checkedAt=2026-08-29T02:06:06.520Z  unchanged
43129    health-factor   checkedAt=2026-08-29T02:06:13.558Z  unchanged
45381    health-factor   checkedAt=2026-08-29T02:11:56.125Z  *** NEW ROW (created by the UI) ***
45422    yield           checkedAt=2026-08-29T02:06:28.193Z  unchanged
45650    rebalancing     checkedAt=2026-08-29T02:05:24.238Z  unchanged
```

Two brand-new rows for the two agents that were only ever opened in the browser,
`checkedAt` advancing for the two that were re-opened, and the three never opened
sitting untouched.

What a judge now sees, read out of the live DOM of the served build:

```
AGENT 265375 (rebalancing)
  REBALANCE EFFICIENCY = Not reported
  ACTIVE RANGE         = USDT/WBNB 0.05% · ticks -65970 to -63960
  CURRENT P&L          = Not reported
  LP POSITIONS         = 3
AGENT 45381 (health-factor)
  POSITIONS WATCHED    = 0
AGENT 12046 (yield)
  TVL MANAGED          = $0
  PROTOCOLS            = None
AGENT 292939 (grid-trading)   <- control, correctly still fully unavailable
  WIN RATE / ACTIVE RANGE / CURRENT P&L / GRID LEVELS = Not reported
```

**Honest caveat on data richness.** The pipeline is real for all three wired
categories, but only agent 265375 currently holds substantive positions. The
other agent wallets genuinely hold no Venus/Aave/PancakeSwap positions right now,
so they read a live `0`. That is a true on-chain reading, not a stub — but do not
oversell "rich live data across every agent" in the submission, because a judge
opening `Aave powered by HeyAnon` will see `Positions watched 0`.

`refreshAgentCategoryStats` has exactly one trigger: this hook (on view, then
every 60s). It is deliberately **not** in the cron — `convex/crons.ts` only runs
the 12h discovery sync. Pre-warming it server-side would need server-side
`getAgentWallet` resolution per agent, which does not exist; on-view refresh
settles in ~1–3s and the interim state is an honest "Syncing".

### 2. The hire dead end is fixed at the data layer (Task 2 — partly done)

`priceModel` never resolved, so the Hire button was permanently disabled for
every agent. Root cause is external and confirmed again: 8004scan publishes no
price field at all.

**Decision, documented at `DEFAULT_READ_ONLY_PRICE_MODEL` in
`src/constants/agents.ts`** (that constant is also where to reverse it): price
what Dolphin actually does, rather than guess at the publisher. A hire here
writes a read-only subscription record — no signature, spend cap, session, or
transaction — so it costs exactly zero. That is a checkable fact about this
marketplace, not a fabricated metric, which is why it does not breach the
data-integrity rule the way inventing an APY would.

It deliberately does **not** claim the publisher is free. The metric's `source`
is `"Dolphin marketplace policy (not a publisher-published value)"` rather than a
data feed, and the hire screen splits the old single "Published price" row into
**"Dolphin hire price: Free"** and **"Publisher price: Not published"** so the two
can never be read as the same claim.

`agents-api.ts` needed no change — it inherits `priceModel` through its existing
`...fallback` spread, which is what stops a live refresh from regressing the
value. That is now commented so it stays deliberate.

Verified live, A/B, against the real mutation — the old `null` price is still
rejected, and the new default succeeds across three categories:

```
=== control: old behaviour (null price) must still be REJECTED ===
Uncaught Error: Cannot hire yet: this agent's priceModel has not resolved to a live value.

=== with DEFAULT_READ_ONLY_PRICE_MODEL {flat, 0, BNB} ===
265375   rebalancing    -> "jh7c8xq247pdfd4eefe1t1br7x8dcwmj"
45381    health-factor  -> "jh79v4a2da1tjxr7055fxvwmc18dde62"
12046    yield          -> "jh70jj6kpfdqc4kdyfyhxrtgq18dda32"
```

Three real `active` rows in `agentHires`, three categories, confirmed via
`npx convex data agentHires`.

**What is NOT done, and it matters.** The button is gated on `priceModel` **and**
`isWalletConnected`. Fixing the price removed the first gate; the second is still
closed on web, because `wallet-provider.web.tsx` is an intentional stub that
always reports `isConnected: false`. So **a judge on the web build still cannot
complete a hire.** The screen is now at least honest about why — the banner reads
"Connect a wallet to hire" instead of the old, unfixable "Waiting on published
price" — but the journey does not reach a completed state there.

This was left rather than bodged, deliberately: the fix is a web wallet path
(wagmi's `injected()` connector against `window.ethereum`, using the wagmi
already in `package.json` — no new dependency and no change to the native path),
but a headless browser has no wallet extension, so it could not have been
verified tonight. Shipping unverified wallet code would have broken this
session's own rule. **This is the top remaining Functionality item.**

### 3. A deployment-breaking bug found while verifying the export (not on the task list)

The web export was silently showing an **empty marketplace** ("No Agents Found",
no HTTP request to 8004scan at all, no error) whenever it was served from
anything other than the domain root.

Cause: `query-provider.tsx` wired `onlineManager` to NetInfo on web as well as
native. NetInfo's **web** build defaults to `reachabilityUrl: "/"`,
`reachabilityMethod: "HEAD"`, and a `status === 200` test (its own
`internal/defaultConfiguration.web.js`). Under any path-prefixed deploy — which
is exactly what a GitHub Pages project site at `/<repo>` is — that probe hits a
root the app does not own, gets a 404, sets `isInternetReachable: false`, and
TanStack Query then **pauses** every query instead of failing it: no request, no
error, no retry, forever. Convex was unaffected because it has its own socket and
never consults `onlineManager`, which is precisely what disguised this as a
routing bug.

Isolated by building the identical bundle twice — at root it fetched all eight
agents, under `/dolphin` it fetched none. Fixed by making the override
native-only, matching the reasoning already applied to the focus listener beside
it. Re-verified after the fix: all eight agents fetch under the sub-path.

**Had this not been caught, the deployed site would have shown judges an empty
marketplace.**

Also fixed while verifying: a live-but-empty list (agent 12046's Aave
`protocolsUsed` is live with `[]`) rendered as a blank cell that read as broken
UI. It now says "None", which stays distinct from "Not reported".

### 4. Deployment (Task 3 — built and locally verified, blocked on the owner)

`.github/workflows/deploy-web.yml` builds and publishes the Expo web export to
GitHub Pages. It patches `experiments.baseUrl` to `/<repo>` at build time instead
of committing it, so `app.json` stays correct for a root-serving host and for
local exports; writes `.nojekyll` (Jekyll strips Expo's `_expo/` output); and
copies `index.html` to `404.html` so deep links survive, since `web.output` is
`"single"`.

`experiments.baseUrl` was verified against the SDK 54 app-config reference rather
than assumed.

**Deployed and green.** Verified first against a local server reproducing Pages'
exact behaviour, then on the live URL itself from a clean browser context:
landing, onboarding, Discover, tapping through to an agent, and direct deep links
all work, with real Live signals rendering for all three wired categories and
grid-trading correctly still fully unavailable.

**`npm ci` cannot be used in this repo's CI, and that is not a stale lockfile.**
Four runs failed before this was pinned down. npm records an optional
platform-specific package's *dependencies* only for the platform it resolved on,
and `package-lock.json` is authored on Windows — so
`node_modules/@napi-rs/wasm-runtime` (optional) is committed carrying only
`@tybys/wasm-util`, omitting the `@emnapi/core` and `@emnapi/runtime` it actually
declares. A Linux runner needs those and `npm ci` aborts:

```
npm error code EUSAGE
npm error Missing: @emnapi/core@1.11.3 from lock file
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

Ruled out as staleness: `npm ci --dry-run` passes on Windows against this exact
lockfile, and regenerating it from scratch on Windows *removes* those entries
instead of adding them, so no Windows-side change can fix it. A Linux lockfile
could not be generated locally (WSL has no distro installed, Docker absent). The
workflow therefore uses `npm install`, which honours every pinned version and
only fills the missing optional subtree. **The durable fix is to regenerate
`package-lock.json` once on Linux and switch the workflow back to `npm ci`.**

Worth knowing for future CI work: raw job logs need an authenticated download,
but annotations are readable from the public API — the workflow now emits npm's
error lines as an annotation, which is how the above was finally diagnosed
instead of guessed at.

Scope note for the submission text: the web build demonstrates the read-only
marketplace — browse, search, agent detail, live on-chain stats, registry
verification. Wallet connection and therefore hiring do not work there.

### 5. Wallet connect (Task 4 — not advanced, and the network block is confirmed still live)

Not testable this session: no device to hand. The §4 blocker was re-checked
directly rather than assumed, and **it is still in place on this network**:

```
api.expo.dev             https=200
exp.host                 https=200
registry.npmjs.org       https=200
8004scan.io              https=200
relay.walletconnect.org  https=000   <- unreachable
```

Everything else answers; only the WalletConnect relay does not. So wallet connect
still cannot be tested from this machine/network, exactly as recorded before —
this is not a new failure mode, and no code change is warranted on this evidence.

### 5a. `npx expo start` failing with `TypeError: fetch failed`

Seen this session. The trace runs through
`validateDependenciesVersionsAsync → getNativeModuleVersionsAsync`, which calls
Expo's API at startup to check dependency versions. It is a CLI startup check,
not anything wrong with the project.

It was transient — `api.expo.dev` answered 200 on retest a moment later, so
plain `npx expo start -c` should work. If it recurs, either of these skips the
check (both confirmed to exist in the installed SDK 54 CLI, not guessed):

- `npx expo start --offline` — verified working this session; prints "Skipping
  dependency validation in offline mode" and serves normally.
- `EXPO_NO_DEPENDENCY_VALIDATION=1 npx expo start -c` — narrower, leaves the
  CLI's other network features enabled.

One new observation: the `[wallet-diagnostic]` log **does** fire and reports
`crypto.getRandomValues OK` — but it fired in the *web* bundle, where that was
never in doubt, so **it says nothing about native yet**. Leave it in place until
someone runs the app on a device on a network that resolves the relay domain.

The reason it runs on web at all is worth knowing: `wallet-provider.ts` imports
**both** `.native` and `.web` modules unconditionally, so the native module's
top-level side effects (the polyfill imports and that probe) execute on web. The
`Platform.OS !== "web"` guard only stops `createAppKit()`. This is the
known-suboptimal router already flagged in §5; it also means the whole
Reown/AppKit/wagmi native stack ships inside the 6.4 MB web bundle. Left alone
deliberately — it is untestable native code from here, and a console.log is
harmless next to the risk of breaking the one wallet path that might work.

## New known issues found this session

1. **Hiring cannot complete on web** — wallet gate, not price gate. Needs the
   wagmi `injected()` web connector. Top remaining Functionality item.
2. **`npm ci` is unusable in CI until the lockfile is regenerated on Linux.**
   See the deployment section above for the exact cause and the durable fix.
3. **Most agent wallets hold no positions**, so several live metrics read a
   truthful `0`. Real, but thin for a demo; agent 265375 is the strongest one to
   show a judge.
4. **A video asset 404s in the web export** — the request path doubles up as
   `/assets/assets/videos/Coin.<hash>.mp4`. Pre-existing (reproduces at root as
   well as on the sub-path), cosmetic, not investigated.
5. **`convex/lib/liveMetric.ts` erases its value type.** `liveMetric()` takes
   `Parameters<typeof v.union>[0]`, so `Doc<"agentLiveStats">["stats"]` is
   structurally correct and discriminated by `category`, but each metric's
   `value` is effectively `any` — verified with a type probe: assigning a string
   to `currentApy.value` compiles. Runtime is fine (the protocol modules do write
   numbers) but the client/server mirror is not compiler-checked, and the UI now
   calls `.toFixed()`/`.join()` on those values. Making `liveMetric` generic would
   close this.

## Suggested order for the next session

1. **Web wallet via wagmi `injected()`**, so the hire journey actually completes
   for a judge on the public URL. Highest-value remaining work by a distance.
2. Regenerate `package-lock.json` on Linux and switch CI back to `npm ci`.
3. Confirm native wallet connect on a network that resolves
   `relay.walletconnect.org`; remove the `[wallet-diagnostic]` log once it does.
4. Then the §5 stretch list (surface `classificationConfidence`, cancel/un-hire).

---

## 1. Current State

> **Superseded in part by the 2026-08-29 addendum above.** Specifically: the
> "Live signals always show Not reported" and "hiring is never reachable because
> `priceModel` never resolves" findings are fixed; `agentLiveStats` is no longer
> empty; and a deployment path now exists. The rest of this section still holds.

### What's actually built and working

- **Marketplace UI** (Expo Router + NativeWind): onboarding carousel, Discover tab (hero card + category-filtered agent lists), Search (live local filtering + trending + recent), category listing pages, agent detail pages, My Agents, Wallet tab. All real, polished, extensively iterated on (see `git log` — dozens of UI-only commits before this session).
- **Agent identity data**: 8 hand-vetted "editorial" agents (`src/data/editorial-agents.ts`), each a real ERC-8004 identity on BSC mainnet, refreshed live from 8004scan per-agent on load (`src/services/agents-api.ts`). Falls back to the hardcoded editorial copy (labeled `editorial-fallback`) if that fetch fails.
- **Automated agent discovery**: a Convex cron (`convex/crons.ts`, every 12h) pulls candidates from 8004scan, filters spam, classifies by keyword match, and now (as of this session) verifies each survivor is actually `is_active` on 8004scan before adding it. Currently 8 rows in the live `discoveredAgents` table (verified via `npx convex data discoveredAgents` just now), 3 of which are genuinely new beyond the 8 editorial agents (the other 5 are re-synced duplicates of editorial tokenIds, which the merge logic in `use-agents.ts` correctly drops in favor of the editorial copy).
- **Real on-chain reads** for 3 of 4 graded categories (Rebalancing, Health Factor, Yield) via direct `viem` calls — see §2 and §3.
- **A real, working hire mutation** (`convex/agentHires.ts`), generalized this session from a monitoring-only original to work for any category, wired into the actual UI. **But see the dead-end noted below — it's currently unreachable in practice.**
- **Wallet connection code** (Reown AppKit + wagmi) that is correctly configured per current official docs (verified against `docs.reown.com` this session) and has had two real bugs fixed this session (see §4) — but **has not been confirmed to actually complete a live connection**, because live testing is currently blocked by the test device's network (see §4).

### What's stubbed, incomplete, or not started

- **Every agent's "Live signals" section always shows the static "Not reported" placeholder, never real data** — this is the single biggest gap in the whole app, and it's non-obvious. See §1's "where the flow breaks" below and §4's Convex section for the full explanation.
- **Hiring is never actually reachable through the UI for any agent, in any category**, because the price field it gates on never resolves. See below.
- **No real on-chain "activate/hire" transaction exists anywhere.** Every hire is a Convex database record, not a blockchain transaction. See §3.
- **x402 payment integration**: not started. No `@x402/*` package installed, no facilitator configured.
- **Altana action-session flow** (session grant → real scoped testnet tx → revoke): not built, blocked on a real SDK gap (see §5).
- **No public deployment exists.** See below — this is a hackathon-eligibility blocker.

### Is there a deployed/live version?

**No.** Verified: no `eas.json`, no `android/` or `ios/` native project directories (this is a pure managed Expo project — `expo prebuild` has never been run), no `.github/workflows`, no `expo-dev-client` dependency, no hosting config of any kind. `package.json`'s only run scripts are `expo start` variants — there is no build or deploy script at all. The Convex backend is deployed, but only to a **dev** deployment (`dev:enduring-mastiff-708`, per `.env.local`'s `CONVEX_DEPLOYMENT`) — not a production Convex deployment. **Getting a publicly-reachable build (EAS + TestFlight/Play internal track, or an Expo Go–shareable link, or a hosted web export) is required for judging per `project-scope.md` §10 step 14 and has not been done at all.** This should be one of the next agent's very first priorities given the Sep 9 deadline.

### Real user flow, as the code currently implements it, with exact break points

1. **Land**: onboarding carousel (`src/app/onboarding/index.tsx`, 4 slides) on first launch, or straight to Discover if `hasCompletedOnboarding` is already persisted (Zustand + AsyncStorage). Works fully.
2. **Find an agent**: Discover tab shows a hero card + category tabs (Rebalancing/Grid Trading/Health Factor/Yield — Monitoring is deliberately excluded from this browsing surface, see §2) with horizontally-paged agent lists; Search tab does live local filtering. Both work, both pull from the same merged editorial+discovered agent list (`useAgents()` in `src/hooks/use-agents.ts`). Works fully.
3. **Understand what it does**: tapping an agent opens `src/app/agent/[id].tsx` → `AgentDetail` component. Shows identity, description, skills, publisher, registry verification (a **real** on-chain `ownerOf`/`getAgentWallet` read against the ERC-8004 registry, ~confirmed working this session for multiple token IDs). **Breaks here, silently**: the "Live signals" section (category-specific stats — win rate, health factor, APY, etc.) always shows "Not reported" for every single field, on every single agent, regardless of category or how much real backend work has gone into computing that category's stats. This is not a data-availability issue (the backend really can compute these for Rebalancing/Health Factor/Yield) — it's that **the hook that would fetch and refresh this data (`useAgentCategoryStats` in `src/hooks/use-category-stats.ts`) is fully implemented but is never actually called from any screen.** Confirmed via `grep` — it's referenced only in its own definition and two doc-comments elsewhere. `agent-detail.tsx`'s `LiveStats` component reads `agent.liveStats` directly, which for every agent source (editorial and discovered alike) is hardcoded to `unavailableLiveStats(category)` — a static "unavailable" stub, never overwritten with anything from Convex. **This is the top fix for Data Quality judging**: all three real protocol integrations (Venus, PancakeSwap V3, Aave) are fully built and correct, and a judge will never see any of it.
4. **Activate it**: tapping "Review setup" opens `src/app/hire/[id].tsx`. Shows identity/access/payment review, wallet connect button, and a `ReadOnlyHireAction` component. **Breaks here too**: the "Hire — Free" button is gated on `agent.priceModel` resolving to `"live"` or `"stale"` status — and it never does, for any agent, from any source. Confirmed by fetching a real 8004scan agent response directly this session: **there is no price field anywhere in 8004scan's API at all** (checked every key in the full response payload). `editorial-agents.ts` and `discovered-agents.ts` both hardcode `priceModel: unavailableMetric(...)`, and `agents-api.ts`'s real-data refresh never touches `priceModel`. So the button is permanently stuck showing "Waiting on published price," disabled, for every agent. The only thing that actually works from this screen is "Save device preview" — a **local-only, AsyncStorage-backed, non-backend, non-blockchain** bookmark, which routes to Manage and shows honest "not started / none / unavailable" status for everything. **This is the Functionality flow's real dead end**: the primary "land → find → understand → activate" path never reaches a genuine completed state for any agent today.

---

## 2. Agent Categories

The four graded categories, per the 2026-08-28 taxonomy migration (see `git log` — 6 commits that day rewired this):

| Category | Population (verified via source files + live Convex query) | Data source | Real or mocked? |
|---|---|---|---|
| **Rebalancing** | 2: "V3 Pools powered by HeyAnon" (editorial, tokenId 45650), "BNB LP Range Rebalancer" (discovered, tokenId 265375) | `convex/protocols/pancakeswap.ts`'s `readRebalancingStats` — real `viem` reads against PancakeSwap V3's `NonfungiblePositionManager` (`balanceOf`, `tokenOfOwnerByIndex`, `positions`) on BSC mainnet | **Real** for `positionCount` and `activeRange` (genuine on-chain reads). `winRate`/`currentPnl`/`trackRecordPeriod` are honestly `unavailable` — no fee-accrual/cost-basis feed exists. **But see §1 — none of this ever reaches the UI regardless**, because `useAgentCategoryStats` is never called. |
| **Grid Trading** | 2: "Range Maker" (editorial, tokenId 292939), "Grid Trader" (discovered, tokenId 269224 — found this session via an improved 8004scan search) | None wired | **Fully unavailable by design** (`convex/protocols/unavailable.ts`'s `unavailableGridTradingStats`) — this is the category that used to be miscategorized as LP-range management; genuine price-ladder grid trading has no data source yet. This is the *correct*, honest state, not a bug — same pattern the Monitoring category already used. |
| **Health Factor** | 4: "Liquidation Guard" (292058), "Brain on BNB — Venus Health Factor Monitor" (302257), "Aave powered by HeyAnon" (45381 — reclassified from Yield this session), "Venus powered by HeyAnon" (discovered, 43129) | `convex/protocols/venus.ts`'s `readHealthFactorStats` — real reads against Venus's Comptroller (`getAssetsIn`, `markets`, `getAccountSnapshot`, oracle price) on BSC mainnet, deriving a health-factor ratio (Venus doesn't expose one field directly) | **Real** where a wallet has an active Venus borrow position; honestly `unavailable` otherwise (no market entered, no borrow, or read failure). `liquidationsPrevented`/`responseLatencyMs` are permanently unavailable (no feed exists). Same UI caveat as above — never actually displayed. |
| **Yield** | 2: "Yield Maximizer" (12046), "Beefy powered by HeyAnon" (45422) | `convex/protocols/aave.ts`'s `readYieldStats` — real reads against Aave V3's Pool contract (`getUserAccountData`) on BSC mainnet | **Real** for `tvlManagedUsd` (genuine collateral-value read) and `protocolsUsed`. `currentApy` is permanently unavailable — Aave doesn't expose deposit APY as a single field, needs a ray-to-APY conversion not implemented. `rebalanceFrequency` is also permanently unavailable. Same UI caveat. |
| **Monitoring** (unofficial, not graded) | 1: "Wallet Watch" (303727) | None — `convex/protocols/unavailable.ts`'s `unavailableMonitoringStats` | Fully unavailable by design. **Deliberately excluded from `AGENT_CATEGORY_SLUGS`/`AGENT_CATEGORIES`** (`src/constants/agents.ts`) as of this session, so it never appears in Discover/Search/onboarding's category browsing — a judge browsing "the four categories" will only ever see the four graded ones. The type, schema, and this one agent's data/hire record are all still intact; it's purely not marketed as a fifth graded category. |

**All four graded categories now have real, non-placeholder agent populations and (for 3 of 4) real backend data-fetching code.** The gap is entirely in the frontend never invoking that code (§1), not in the categories or data sources themselves being fake.

**One live discovery-quality tension to know about**: "Topaz Agent" (tokenId 113284) is a broad multi-purpose ve(3,3) DEX agent (swaps, gauge votes, bribes, veTOPAZ locks) that weakly matches Rebalancing's "lp position" term. It's been manually excluded twice this session via `MANUALLY_EXCLUDED_TOKEN_IDS` in `convex/discoveredAgents.ts` — re-verify it hasn't resurfaced if you see an unfamiliar Rebalancing agent after a future sync.

---

## 3. ERC-8004 / On-Chain Integration

**Discovery / listing** — not a from-scratch indexer, per `project-scope.md`'s explicit direction. Two paths:
- Client-side, per-agent: `src/services/agents-api.ts`'s `fetchAgents()`/`fetchAgentById()` call `https://8004scan.io/api/v1/public/agents/{chainId}/{tokenId}` directly from the app, unauthenticated, for the 8 editorial agents only.
- Server-side, bulk: `convex/discoveredAgents.ts`'s `syncDiscoveredAgents` (an `internalAction`, cron-triggered every 12h via `convex/crons.ts`, or manually via `npx convex run discoveredAgents:syncDiscoveredAgents`) calls `https://api.8004scan.io/api/v1/agents` (search + bulk score-sorted scan), now **authenticated** with an API key (`SCAN8004_API_KEY`, added this session — see §6) that raises the rate limit from 30/min·1000/day to 600/min·100000/day.

**Individual-agent verification** — `src/services/chain.ts`'s `verifyAgentRegistration(tokenId)`, a direct `viem` read against the ERC-8004 identity registry contract (`0x8004A169fB4a3325136eB29fA0ceB6D2e539a432` on BSC mainnet) calling `ownerOf`, `tokenURI`, and `getAgentWallet`. Called from `src/hooks/use-agents.ts`'s `useAgent()` whenever `verifyOnChain` is true (the default). **Confirmed genuinely working this session** — tested directly against the live contract for multiple token IDs, all resolved correctly.

**"Activate/hire" is not a real on-chain transaction, anywhere, for any category.** It is a `convex/agentHires.ts` mutation (`hireReadOnlyAgent`) that writes a row to the `agentHires` Convex table — no wallet signature, no session grant, no spend cap, no blockchain interaction at all. This is by design for read-only agents (per `project-scope.md` §2/§6/§7) and was always the plan for Monitoring; it's now been generalized to every category as of this session (§4 of the previous handoff in this conversation), but as noted in §1, the button that would trigger it is currently unreachable in the UI because `priceModel` never resolves.

**Unresolved issues getting reliable registry data**:
- 8004scan's API is documented (in this repo's own comments) as intermittently returning 500/502/524s. Every fetch has a 15s timeout and fails soft.
- 8004scan indexes ~289,000 agents on BSC mainnet, the overwhelming majority spam (templated bots, impersonation personas, gamified NFT collectibles) — `convex/lib/classification.ts` has a hand-tuned filter for patterns actually observed, not a generic spam model.
- 8004scan's per-agent detail API has **no price/fee field of any kind** (confirmed this session by inspecting a full raw response) — this is the root cause of the hire dead-end in §1, and it's an external data-availability gap, not something fixable purely in this codebase without building an entirely separate price-discovery mechanism (e.g., calling each agent's own published service endpoint, which none of this app's code does today).

---

## 4. Stack Specifics

### Convex

Schema (`convex/schema.ts`), verified current:
- `agentLiveStats` — cache table for category stats, keyed by `(chainId, tokenId, category)`. **Currently has zero rows** (verified via `npx convex data agentLiveStats`) — confirms §1's finding that the refresh path is never triggered from the UI.
- `agentHires` — the hire record table (renamed this session from `monitoringHires`, generalized to carry a `category` field). Real, working writes when directly invoked (e.g., via `npx convex run`), but see §1/§3 for why the UI never reaches it.
- `discoveredAgents` — the automated-discovery cache, 8 rows live right now.

Real (not placeholder) Convex functions: `categoryStats.getAgentCategoryStats`/`refreshAgentCategoryStats` (query + action, fully implemented, just unreachable from the UI), `agentHires.hireReadOnlyAgent`/`getHiredAgentsForWallet` (fully implemented, working when called, unreachable from the UI per §1), `discoveredAgents.syncDiscoveredAgents`/`listDiscoveredAgents`/`getDiscoveredAgentByTokenId` (fully real, the last one added this session to fix the "Agent Not Found" bug below).

No placeholder/stub Convex functions exist — everything that's written is real code, the gaps are all about what the client actually calls.

### Reown AppKit wallet connection

Does **not** yet work end-to-end, confirmed by an actual live test this session (via `npx expo start`, Expo Go on a real Android device). Status:
- **Config verified correct** against current official Reown docs (fetched live this session) — `createAppKit`'s options, `AppKitProvider`/`WagmiProvider` nesting, `useAppKit`/`useAccount` usage, the `<AppKit />` modal-layer wrapper (a documented Android quirk workaround) all match current usage exactly. Nothing here needs redesigning.
- **Two real bugs found and fixed this session**:
  1. `src/wallet/wallet-provider.ts` (the platform router) unconditionally imported both `.native` and `.web` variants, so the native module's `createAppKit()` call was actually executing on web too — this was the root cause of the static web export's SSR crash and a stray console warning. Fixed with a `Platform.OS !== "web"` guard in `wallet-provider.native.tsx`. (A cleaner fix — dropping the router file for Metro's automatic platform-extension resolution — was attempted and reverted: it needs a `moduleSuffixes` tsconfig entry, which broke `expo-video`'s own internal platform type declarations elsewhere in the project. The guard is the safe fix in place; the cleaner one is still worth revisiting carefully if someone has time.)
  2. `react-native-get-random-values` was listed in `package.json` but **never imported anywhere in the source** — confirmed nothing else polyfills `crypto.getRandomValues` (not `@walletconnect/react-native-compat`, not wagmi/viem/@reown). Without it, WalletConnect can't generate the keys/nonces needed to encrypt a relay message. Fixed by importing it first in `wallet-provider.native.tsx`; also added `expo-crypto` as an explicit dependency so a future custom dev-client build autolinks its native module correctly (Expo Go bundles it regardless of `package.json`).
- **Still blocking a confirmed live connection**: after both fixes, the connect flow still fails with `Failed to publish custom payload, please try again` at the relay layer. Root-caused this session to the test device's **network DNS actively refusing to resolve `relay.walletconnect.org`** (confirmed: resolves fine via Google/Cloudflare DNS, "Query refused" via the local router) — a router-level filter, not a code bug. **Left a temporary diagnostic log** in `wallet-provider.native.tsx` (`console.log("[wallet-diagnostic] crypto.getRandomValues OK/FAILED", ...)`) to independently confirm the crypto fix once testing moves to an unblocked network — remove it once confirmed working, and check the console output the next time someone runs the app on a device.
- **No native dev-client build exists** (confirmed — no `android/`/`ios/` dirs). All testing so far has been via Expo Go. `wallet-provider.web.tsx`'s own messaging (`"Native development build required"`) suggests the original author expected Expo Go might not fully suffice long-term — worth confirming once the network issue is resolved whether Expo Go is sufficient or a real dev client build is needed.
- **Sign/transact**: not applicable yet — connect itself hasn't been confirmed working, and per §1/§3, nothing in the app currently attempts a wallet signature or on-chain transaction at all (the hire flow explicitly says "No signature is requested by this preview").

### Expo Router / NativeWind structure

```
src/app/
  _layout.tsx              root layout, wraps everything in AppProviders (Wallet → Query → Convex)
  onboarding/index.tsx      4-slide carousel
  (tabs)/
    _layout.tsx             custom floating-island tab bar (Discover/Search/My Agents/Wallet)
    index.tsx               Discover
    search.tsx              Search
    my-agents.tsx           My Agents
    wallet.tsx              Wallet/Profile screen (project-scope.md called this profile.tsx in its original IA — it was actually built as wallet.tsx; no profile.tsx exists)
  agent/[id].tsx            agent detail
  category/[slug].tsx       full category listing
  hire/[id].tsx             hire flow (modal presentation)
  manage/[id].tsx           manage a hire or device preview
```

Non-obvious things to know before editing:
- **`useAppStore.persist.hasHydrated()` gating**: both `(tabs)/_layout.tsx` and other screens wait for Zustand's AsyncStorage hydration before rendering anything, redirecting to onboarding if `hasCompletedOnboarding` is false. Don't remove this gate — it prevents a flash of the wrong screen on cold start.
- **Fast Refresh does not invalidate the TanStack Query cache** (a real, previously-documented gotcha, still true) — after editing `editorial-agents.ts` or the discovered-agents pipeline, do a full reload, not just wait for Fast Refresh.
- **AGENTS.md's UI boundary (§11)**: screens under `app/(tabs)/`, `app/agent/`, `app/category/`, `app/hire/`, `app/manage/`, `app/onboarding/` are off-limits to a coding agent by default — the project owner builds UI directly. This boundary was lifted only for the specific category-rename work this session (icons/labels/copy only); it's standing again now unless a task explicitly says otherwise.
- **No `SafeAreaProvider` is explicitly mounted anywhere**, despite every screen using `SafeAreaView` from `react-native-safe-area-context` — this works because Expo Router provides one internally in recent SDK versions; don't add a redundant one without checking first.

### TanStack Query / Zustand split

- **TanStack Query** (`src/providers/query-provider.tsx`): all *server*-shaped async data — the editorial agent list (`useAgents`/`fetchAgents`), individual agent detail + on-chain verification (`useAgent`/`fetchAgentById` + `verifyAgentRegistration`). Configured with `onlineManager` wired to `@react-native-community/netinfo` and `focusManager` wired to `AppState`, so refetch-on-reconnect/refocus works correctly on native (not just web's built-in behavior).
- **Convex's own `useQuery`** (from `convex/react`, not TanStack) handles the *real-time* backend-owned state: `discoveredAgents`, `agentLiveStats` (unused per §1), `agentHires`. This is a second, independent data-fetching system alongside TanStack Query — don't confuse the two `useQuery` imports.
- **Zustand** (`src/store/use-app-store.ts`, persisted to AsyncStorage, versioned with a migration function): purely device-local UI/preference state — onboarding-completed flag, device-preview hires (explicitly typed as `isOnChain: false`, never confused with real `agentHires` records), recent searches. Nothing server-authoritative lives here.

---

## 5. Known Issues and Decisions

**Hardest problems hit, and how they were resolved:**
- The original "grid-trading" category was substance-wrong (it was really LP-range management). Fixed via a full audit + split into Rebalancing (the real substance) and a new, honestly-empty true Grid Trading category — see `project-scope.md`'s taxonomy note and the 6 commits from 2026-08-28.
- The "Agent Not Found" bug on every discovered (non-editorial) agent's detail page — root-caused to `fetchAgentById` only ever checking the 8 editorial agents. Fixed by adding a Convex fallback lookup in `useAgent()`. Found by actually running the app (Playwright against a local `expo start --web` session), not by reading code — worth remembering that some bugs in this codebase only surface at runtime.
- The wallet web-SSR crash and the missing crypto polyfill — both described in §4.

**Weak or temporary decisions worth revisiting:**
- The `wallet-provider.ts` runtime-branching router (vs. Metro's native platform-extension resolution) is a known-suboptimal pattern, currently patched around rather than fixed properly (see §4).
- `MANUALLY_EXCLUDED_TOKEN_IDS` in `convex/discoveredAgents.ts` is a hardcoded denylist — fine for now, but doesn't scale; if more agents need excluding, consider whether the classifier terms themselves need tightening instead.
- The device-preview mechanism (`previewHires` in Zustand) and the real `agentHires` mechanism now coexist for every category, both surfaced in the same hire screen. This was a deliberate choice this session (see the hire-flow generalization decision) but is arguably confusing UI redundancy now that neither one currently completes cleanly for most users (preview always "works," real hire never resolves its price gate) — worth a product decision on whether to simplify once the price gate is fixed.

**Known bugs / half-working edge cases, listed explicitly:**
1. **`useAgentCategoryStats` is dead code — no screen ever calls it.** (§1) — the single highest-impact fix available for Data Quality judging.
2. **`priceModel` never resolves to `"live"`/`"stale"` for any agent, from any source** — the hire button is permanently disabled. (§1/§3) Root cause is external (8004scan has no price field) — needs a real design decision about where price would even come from (each agent's own service endpoint? a hardcoded default? out of scope to guess here).
3. **Wallet connect has not been confirmed to complete end-to-end** — blocked on the tester's network DNS blocking the relay domain, not (as far as verified) a remaining code issue. (§4)
4. **No native dev-client build exists** — all wallet testing has been via Expo Go, which may or may not be sufficient long-term. (§4)
5. **No public deployment exists at all** — required for judging eligibility, not started. (§1)
6. **Cancel/un-hire is not built** — `agentHires` has no cancel mutation; Manage shows an honest "not available yet" note.
7. **`classificationConfidence` (`"confirmed"` vs `"likely"`) is never surfaced in any UI** — a discovered agent with only a weak keyword match reads as equally certain as a hand-vetted one.
8. **Altana action-session flow is blocked on a real SDK gap**: `@altananetwork/sdk` 0.8.0 has no injected-wallet (WalletConnect/MetaMask-style) signer, only raw private-key and browser-only WebAuthn passkey — a Reown-connected wallet cannot drive an Altana session at all today. A React Native passkey path was evaluated and rejected (no verified domain for the required `.well-known` files). See `project-scope.md` §6 for the full writeup — this hasn't changed since and needs either a newer Altana SDK version or a real spike to move forward.
9. **x402 payment integration has not been started at all** — no package installed, no facilitator configured. Any paid-agent hire is explicitly rejected rather than faked.

---

## 6. What's Needed to Pick This Up

### Every required env var / credential

All in `.env.local` (gitignored — never committed; `.env.example` documents the names but not real values):

| Variable | Purpose | Where to get it |
|---|---|---|
| `CONVEX_DEPLOYMENT` | Tells the Convex CLI which deployment `npx convex dev` talks to | Set automatically the first time `npx convex dev` runs and you log in / select the project (`dytor-app/dolphin`, deployment `dev:enduring-mastiff-708`) — ask the project owner for access to that Convex team, or run `npx convex dev` fresh to create your own dev deployment (note: a fresh deployment starts with **empty tables** — no editorial/discovered agent cache until you re-run the sync) |
| `EXPO_PUBLIC_CONVEX_URL` | Client-side Convex connection | Printed by `npx convex dev` once configured; currently `https://enduring-mastiff-708.eu-west-1.convex.cloud` |
| `EXPO_PUBLIC_CONVEX_SITE_URL` | Convex HTTP actions endpoint (present in `.env.local` but not yet referenced by any code — likely reserved for future use) | Also printed by `npx convex dev` |
| `EXPO_PUBLIC_REOWN_PROJECT_ID` | Wallet connection (Reown/WalletConnect) | Create a free project at [cloud.reown.com](https://cloud.reown.com) (formerly WalletConnect Cloud) |
| `EXPO_PUBLIC_BSC_RPC_URL` | BSC mainnet RPC for `viem` reads | Public default (`https://bsc-dataseed.bnbchain.org`) works but is rate-limited/unreliable at scale; get a dedicated RPC URL from Ankr, QuickNode, Alchemy, etc. for anything beyond light dev use |
| `SCAN8004_API_KEY` | **Convex-side only** (never in `.env.local`, never client-bundled — set via `npx convex env set SCAN8004_API_KEY <value>`) — authenticates 8004scan discovery-sync requests for a much higher rate limit | Request a key from 8004scan directly; one was already generated and configured this session (ask the project owner if a fresh one is needed) |

**Never add an `EXPO_PUBLIC_`-prefixed version of `SCAN8004_API_KEY` or any other secret** — that ships it inside the public app bundle. This exact mistake happened once this session and was caught and reverted.

### Steps to run locally from a clean clone

1. `npm install`
2. `npx convex dev` — logs you into Convex, lets you select/create a deployment, writes `CONVEX_DEPLOYMENT`/`EXPO_PUBLIC_CONVEX_URL`/`EXPO_PUBLIC_CONVEX_SITE_URL` into `.env.local` automatically, and keeps running (leave it running in a separate terminal — it pushes Convex function changes live). If you're using your own fresh deployment rather than the existing one, also run `npx convex env set SCAN8004_API_KEY <value>` and `npx convex run discoveredAgents:syncDiscoveredAgents` once to populate the discovered-agents cache.
3. Add `EXPO_PUBLIC_REOWN_PROJECT_ID` and (optionally) `EXPO_PUBLIC_BSC_RPC_URL` to `.env.local` by hand.
4. `npx expo start` — scan the QR with Expo Go (Android) or the Camera app (iOS), or press `a`/`w` for Android/web. **Web wallet connection is intentionally disabled** (`wallet-provider.web.tsx` returns an "unavailable" stub) — test wallet flows on Android/iOS via Expo Go only, and see §4/§5 for why even that hasn't been confirmed fully working yet.
5. `npx tsc --noEmit` and `npx expo lint` before considering any change done — both were kept clean throughout this session and should stay that way.

### Deployment/build process

**None exists yet.** To get a judge-reachable build, the next agent needs to do one of:
- `npx eas build --profile development` (or a production profile) — requires an Expo/EAS account and `eas.json` to be created from scratch (`npx eas build:configure`).
- Or `expo prebuild` + a local Android Studio / Xcode build, if avoiding EAS.
- Or, as a lighter-weight fallback that still satisfies "publicly accessible," an Expo Go–shareable link via `npx expo publish`-equivalent (check current Expo SDK 54 tooling name for this, EAS Update) or a hosted web export (`npx expo export --platform web` + any static host) — note the web export currently has no wallet functionality by design, so this would only demo the read-only marketplace flow.

This is unstarted work with a hard deadline nine days out from this handover — treat it as urgent.
