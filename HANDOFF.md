# Dolphin — Handoff

Snapshot as of 2026-08-28. Working tree is clean; everything described as "built" below is committed to `main`.

This is a status document, not a spec — **`project-scope.md` is still the source of truth for what to build and why, `AGENTS.md` for how to build it.** Read those first if anything here is ambiguous. This file exists to answer "where did we leave off."

Hackathon: BNB Chain "Build the Era," deadline Sep 9, 2026. Judged on Functionality, Data Quality, Agent Diversity.

---

## 1. What's built

### App shell / navigation (built directly by the project owner, in parallel with the backend work below)
- Expo Router tab shell: Discover, Search, My Agents, Wallet (`src/app/(tabs)/`)
- Onboarding carousel (`src/app/onboarding/`)
- Agent detail, category listing, hire sheet, manage screens (`src/app/agent/[id].tsx`, `category/[slug].tsx`, `hire/[id].tsx`, `manage/[id].tsx`)
- A lot of iterative visual polish: sticky/docking headers, a floating-island tab bar on iOS, category filter bar sizing, horizontal paging on category lists — see recent `git log` for the blow-by-blow, it's been under active, fast iteration.
- Wallet connection via Reown AppKit (`src/wallet/wallet-provider.native.tsx` / `.web.tsx`), fails closed with no private-key fallback.

### Agent identity & discovery data
- Normalized `Agent` type (`src/types/agent.ts`) — every metric is a `LiveMetric<T>` with an explicit status (`live`/`stale`/`syncing`/`unavailable`) and a source label, so the UI can never show a fabricated number as if it were live.
- `src/services/agents-api.ts` — fetches real 8004scan data per agent by token ID, falls back to editorial data (clearly labeled `editorial-fallback`) if that fails.
- `src/services/chain.ts` — direct `viem` reads against the real ERC-8004 registry on BSC mainnet, for independent verification (ownership, registration, `tokenURI`) — used for individual-agent verification only, never bulk discovery (see §4, "why not build our own indexer").
- `src/data/editorial-agents.ts` — **8 hand-vetted agents**, 2 per category, each a real on-chain ERC-8004 identity on BSC mainnet, manually checked against 8004scan and (where relevant) the agent's own published metadata before being added. Not placeholders.
- `src/data/discovered-agents.ts` + `convex/discoveredAgents.ts` + `convex/lib/classification.ts` — **automated discovery**, see §2, still actively being tuned.

### Convex backend (`convex/`)
- `categoryStats.ts` + `convex/protocols/{venus,pancakeswap,aave,unavailable}.ts` — real per-agent-wallet reads: Venus health factor, PancakeSwap V3 LP position count/range, Aave collateral USD value. Every metric with no real source yet is `unavailableMetricValue(...)`, never guessed.
- `monitoringHires.ts` + `src/hooks/use-hire-monitoring-agent.ts` — **real, working hire flow for Monitoring-category agents.** No session, no spend cap (monitoring is read-only by design). Free agents hire immediately; agents with a non-zero `priceModel` are rejected with an explicit error, because there is no x402 seller-side integration wired up anywhere in this repo (see §3). This is wired into the actual UI (`hire/[id].tsx`, `my-agents.tsx`, `manage/[id].tsx`), not just the backend.
- `discoveredAgents.ts` + `crons.ts` — scheduled (12h) sync from 8004scan into a cached table, merged into `useAgents()` automatically. See §2.

---

## 2. What's in progress: automated agent discovery

**Goal:** grow past the 8 hand-picked agents without hand-vetting every single one, while never presenting a wrong or spammy classification as if it were certain.

**How it works today:**
1. A Convex cron (`convex/crons.ts`, every 12h) calls `discoveredAgents.syncDiscoveredAgents`.
2. It pulls candidates two ways: 4 category-specific full-text searches against 8004scan's real `/agents?search=` endpoint, plus a bulk scan of the top-scored ~800 BSC agents (`sort_by=total_score`) — the search endpoint alone was found to miss agents that clearly matched by our own criteria.
3. Every candidate is run through `convex/lib/classification.ts`: a spam/junk filter (templated bot registrations, test agents, impersonation personas, gamified NFT collectibles — all *specific patterns actually observed*, not a generic spam model) and a keyword classifier that only assigns a category on an unambiguous match. `confidence: "confirmed"` = a strong, category-specific phrase matched. `confidence: "likely"` = a single weaker term matched with no competing category. Ambiguous or zero matches are dropped, never guessed.
4. Survivors are cached in the `discoveredAgents` Convex table. `useAgents()` (`src/hooks/use-agents.ts`) merges them into the app automatically — no screen files needed to change.

**Current real numbers (as of last successful sync):** ~500-800 agents scanned per run → roughly 5-10 pass the filter, and after deduping against the 8 already-hand-picked ones, **2 are genuinely new** ("Venus powered by HeyAnon" in Health Factor, "Topaz Agent" in Grid Trading). Total unique agents in the app right now: **10.**

**Known limitation, stated plainly:** the honest hit rate is roughly 1-2 real category-fitting agents per 500 scanned. Getting to a much bigger number (the owner asked about ~50) is not achievable right now without either scanning tens of thousands of agents (slow, and 8004scan's own API has been intermittently failing — 500s, 502s, 524 timeouts, and one request that hung indefinitely until a timeout was added) or loosening the classifier until wrong fits start counting, which was explicitly rejected as a path (see AGENTS.md §5, Data Integrity Rule — this is a hackathon judging requirement, not a style call). **Do not lower the classification bar to hit a target count.** If more agents are needed, the honest levers are: wait for 8004scan to be healthier and re-run a deeper scan, add more real observed term phrasings to the classifier (evidence-based, not guessed), or accept that Monitoring in particular may never have many entries — a scan of ~500+ agents found zero genuine passive-monitoring agents on this registry.

**Also caught mid-build, worth knowing about for future tuning:** gamified NFT collectibles ("BORT Yield Weaver #10922," tiered/powered/numbered-edition trading cards) use real DeFi jargon as flavor text and can pass a naive keyword filter. Always read a sample of what a broadened scan actually returns before trusting it — the confidence label is not a substitute for that.

---

## 3. What's explicitly NOT built yet

- **x402 payment integration — not started.** No `@x402/*` package is installed anywhere in this repo, no facilitator is configured. `hireMonitoringAgent` deliberately rejects any agent with a non-zero price rather than faking a payment step. If any paid agent needs to be hireable, someone has to actually stand up seller-side x402 infrastructure — this has not been scoped or started.
- **Health Factor action-taking flow (session grant → real scoped testnet transaction → revoke) — not built.** This is `project-scope.md` §10 step 9's second half, and it's the big remaining piece for the Altana bounty. It's blocked on a real gap, not a busywork item: `@altananetwork/sdk` 0.8.0 has no injected-wallet (WalletConnect/MetaMask-style) signer — only raw private-key and browser-only WebAuthn passkey. A user's Reown-connected wallet cannot currently drive an Altana session at all. See `project-scope.md` §6 for the full writeup, including the React Native passkey path that was evaluated and not pursued (no verified domain hosting for `apple-app-site-association`/`assetlinks.json`).
- **Grid Trading / Yield action-taking — not built, intentionally deferred** per `project-scope.md` §2's build strategy (one action-taking category done fully real beats four done shallowly). These stay marketplace-only with real data, no live execution.
- **Cancel / un-hire for monitoring agents — not built.** `hireMonitoringAgent` and `getHiredMonitoringAgentsForWallet` exist; there is no corresponding cancel mutation. The Manage screen has an honest "cancelling isn't available yet" note instead of a fake button.
- **No UI surfaces `classificationConfidence` yet.** The data is ready (`Agent.classificationConfidence: "confirmed" | "likely"`), but no screen visually distinguishes a heuristically-discovered "likely" match from a hand-vetted one. Worth doing before showing discovered agents to judges, so a lower-confidence agent doesn't read as equally certain as a verified one.
- **Spike C (ERC-8183 hiring flow)** — not started, lowest priority per the build order, only worth doing if time remains.
- **Public build / deployment (EAS + TestFlight/Play internal, or Expo Go link)** — not done. Required for judging per `project-scope.md` §10 step 14 ("must be publicly accessible during judging").

---

## 4. Known gotchas for whoever picks this up next

- **The running dev server's in-memory TanStack Query cache does not auto-invalidate on a data file edit.** Fast Refresh reloads the component tree but not the query cache singleton (`src/providers/query-provider.tsx`). After any change to `editorial-agents.ts` or the discovered-agents pipeline, do a full reload (shake menu → Reload, or restart `expo start`), not just wait for Fast Refresh.
- **8004scan's API is unreliable.** Expect intermittent 500/502/524s, including on requests that had just succeeded seconds earlier. Every fetch in `convex/discoveredAgents.ts` has a 15s timeout and fails soft (skips that page/query, never deletes existing cached data) — keep that pattern for any future 8004scan integration.
- **8004scan indexes ~287,500 agents on BSC mainnet alone, and the overwhelming majority are spam** — templated bot registrations, test agents, impersonation personas of real public figures/brands, gamified NFT collectibles. Never assume a bulk 8004scan pull is clean without running it through (or extending) `convex/lib/classification.ts`'s filter first.
- **`git status`/`git diff` before assuming your own edits are uncommitted** — this project has two people (the owner + an agent) committing to the same working tree in parallel; a broad `git add` from one side can sweep up the other's in-progress files into an unrelated commit. It happened once already this session (`97bdde7`) — harmless, but check history before assuming a file's current state.
- **`npx convex run discoveredAgents:syncDiscoveredAgents` triggers a manual sync** any time, rather than waiting for the 12h cron — useful for testing changes to the classifier.
- **`npx convex data <table>`** for a quick look at any table's contents; **`npx convex run --inline-query '...'`** for anything needing a filter/transform the CLI table view can't do cleanly.

---

## 5. Suggested next steps, roughly in priority order

1. Decide whether the Altana signer gap blocks Health Factor's action flow entirely, or whether there's a workaround worth spiking (newer SDK version? the RN passkey path revisited with a real domain?). This is the single biggest remaining risk to the Altana bounty.
2. Add a UI treatment for `classificationConfidence` before showing discovered agents to judges.
3. Decide the x402 question explicitly: in scope for the deadline, or all demo agents stay free-tier. Currently free-tier by default (nothing forces a payment step that doesn't exist).
4. Public build / EAS deployment — required for judging, not yet done.
5. If more agents are genuinely wanted: re-run the discovery sync once 8004scan is healthier, and consider adding more evidence-based term phrasings to the classifier rather than loosening the confidence bar.
