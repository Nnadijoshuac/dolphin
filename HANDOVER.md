# Dolphin — Handover

Written 2026-08-29, verified against the actual repo state at commit `6001ae2` (not from memory — every claim below was checked against the current source, a live `npx convex data` query against the dev deployment, live 8004scan API calls, and one real end-to-end run of the app via `expo start`). This supersedes `HANDOFF.md` as the primary handoff document — `HANDOFF.md` is still present and its historical narrative is accurate, but this file is the one to trust for current state. `project-scope.md` remains the spec ("what to build and why"); `AGENTS.md` remains the build-behavior contract ("how to build it") — both are still current and worth reading.

Hackathon: BNB Chain "Build the Era," **deadline 2026-09-09**. Judged on Functionality, Data Quality, Agent Diversity (four categories, equal depth). Optional Altana bounty.

---

## 1. Current State

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
