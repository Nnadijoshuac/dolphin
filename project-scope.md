# Project Scope: BSC Agent Marketplace (App-Store-Style Mobile App)

This is the single source of truth for the build. It supersedes the earlier build-prompt and research-findings docs — those were working documents; this is the consolidated result. AGENT.md governs *how* the coding agent behaves; this file governs *what* gets built and why.

Hackathon: BNB Chain "Build the Era" — deadline Sep 9, 2026. Judged on **Functionality** (zero-knowledge user completes land → find → understand → hire with no dead ends), **Data Quality** (real, live, accurate data — not just agent counts), and **Agent Diversity** (four categories, equal depth). Optional Altana bounty: agents that transact for themselves within user-set limits, verified via live on-chain transactions.

---

## 1. Project Summary

A mobile marketplace for discovering, comparing, and hiring AI agents registered on BNB Smart Chain (BSC) under ERC-8004. UX model: **Apple's App Store app** — Today-style Discover tab, Categories/Apps-style browse grid, a rich per-agent "product page," live search, bottom tab bar. Not a generic crypto dashboard.

Four required categories, equal visual and functional depth:
1. **Rebalancing** — resets/manages LP ranges automatically
2. **Grid trading** — price-ladder buy/sell orders across a fixed range
3. **Health factor** — tracks loan positions, acts before liquidation
4. **Yield** — moves capital to highest-earning opportunities

(A category taxonomy audit on 2026-08-28 found the app's original "Monitoring"
and "Grid trading" categories didn't match this list: "Monitoring" isn't one
of the four graded categories and has no real data source or population beyond
one agent, and what the app called "grid trading" was in substance Rebalancing
- LP-range management, not price-ladder trading. Monitoring stays a real,
working category in the type system and data (its one agent, Wallet Watch,
keeps its real hire record), but is no longer presented as one of the four
graded categories in Discover/Search/onboarding's category browsing.)

---

## 2. Build Strategy — What's Fully Real vs. Simplified

Two independent research passes agreed: attempting four fully autonomous, independently-executing agent runtimes in two weeks is too much failure surface. The stronger, better-judged strategy is **marketplace-first**: make discovery, trust, and data depth extraordinary and fully real everywhere, and make **one** action-taking category genuinely live end-to-end (session grant → real scoped on-chain execution → revoke) rather than spreading thin across four.

**Build fully real, no exceptions:**
- Marketplace UI (Discover, Categories, Search, Agent Details, My Agents, Wallet, onboarding)
- ERC-8004 identity data — real BSC mainnet agent IDs, owners, registry reads, reputation
- All four categories as marketplace entries backed by real live data (see §5 for per-category stats)
- Monitoring agents end-to-end (read-only, no authorization complexity — do this one first, it's the lowest-risk full path)

**Build fully real for exactly one action-taking category:**
- Recommended pick: **Health Factor** — cleanest demo story (before/after health factor, small bounded action like a repay), easiest permission scope to explain to a zero-knowledge user
- Full path: real session grant (call allowlist + spend cap + expiry) → real scoped on-chain testnet transaction → visible in My Agents sourced from actual transaction history → one-tap revoke

**Simplify/defer for the other two action-taking categories (grid trading, yield):**
- Real historical data, real strategy parameters, real current state (P&L, APY, TVL, protocol)
- Activation routes into the same authorization architecture (§6) but can be labeled "Session authorization available" / testnet demo rather than a fully independent live runtime — don't fake mainnet activity, just be honest about depth

This split protects all three judging criteria simultaneously: Functionality and Data Quality get built to full depth everywhere; Agent Diversity is satisfied because all four categories are real marketplace categories with real data; engineering risk concentrates on one well-tested path instead of four unproven ones.

---

## 3. Locked Tech Stack

**Framework**: Expo + Expo Router (file-based routing), TypeScript strict mode

**Styling**: NativeWind (Tailwind for RN), `react-native-reanimated` for transitions, `expo-blur` for translucent nav/tab bars, `expo-linear-gradient` for featured cards

**Chain / Web3**:
- `viem` for BSC reads — start with the lightweight `TextEncoder`/`TextDecoder` polyfill for read-only screens; add `react-native-get-random-values` and other crypto/buffer polyfills only once signing/wallet-connect flows are wired (don't front-load the heavy polyfill stack — see §7)
- **Reown AppKit for React Native** (`@reown/appkit-react-native`) for wallet connection — confirmed current, actively maintained, Expo SDK 53+ compatible with documented babel config for `valtio`. Known Expo Router Android quirk: `<AppKit />` may need wrapping in an absolutely-positioned `View` — put this on the integration checklist for day 1, not day 12
- BSC RPC via `.env` (`EXPO_PUBLIC_BSC_RPC_URL`)

**Agent discovery/data**: **8004scan Developer API** (`8004scan.io/developers`) as the primary discovery/listing source — do not build a registry event-scanning indexer from scratch. Use direct `viem` RPC reads against the ERC-8004 registry for verification of individual agents (ownership, URI, on-chain proof), not for bulk discovery.

**Authorization**: Altana SDK, kept **server-side/backend only** — not bundled into the Expo app. Mobile app talks to your own backend; your backend talks to Altana. This sidesteps the unresolved RN-compatibility question entirely (see §6) and is standard, low-risk architecture regardless of which custody mechanic Altana turns out to use.

**Payments**: x402 — seller-side (`@x402/express` family) stays backend-only. Buyer-side (`@x402/fetch`/`@x402/axios`) is plausible client-side but unconfirmed for RN specifically — default to routing payment-initiation through your backend unless Spike C (§6) confirms otherwise.

**Data / state**: TanStack Query (async data, background refetch — critical for Data Quality), Zustand (client state: selected category, search query, wallet/session state)

**Backend**: thin Node/Express (or Convex) layer that: caches 8004scan + RPC reads, aggregates per-category live stats from real protocols (Aave/Venus/PancakeSwap/Lista), hosts the Altana SDK and x402 seller integration, serves a clean JSON API to the mobile app

**Other**: `expo-secure-store`, `expo-haptics`, `expo-image`, `react-native-svg`

---

## 4. Design Direction — "App Store" Visual Language

- **Bottom tab bar — 4 items, decided** (Discover, Search, My Agents, Wallet/Profile). Categories is not a separate tab. Category browsing (all four categories, equal weight) lives inside **Discover** as always-visible category chips/pills that route into the existing `category/[slug]` full-listing page — the page and its equal-weight requirement are unchanged, only its entry point moved from a dedicated tab to a Discover-surfaced link. This keeps the nav shallow (App Store's own nav is 5 tabs max, but not every screen needs to be a tab) without dropping the "all four categories equal depth" non-negotiable in §11.
- **Discover** = "Today" tab: full-bleed hero cards, spring-sheet transitions into detail pages, plus the category chip row described above
- **Agent detail page** = App Store product page, repurposed:
  - Icon, name, publisher (onchain identity/operator), category badge
  - Sticky **"Hire"** CTA (App Store "Get" styling — pill, colored, becomes progress/connected state)
  - Screenshot carousel → **live performance charts** (equity curve, APY history, liquidation buffer)
  - "What's New" → **recent onchain activity**
  - Description → plain-language strategy explanation
  - "Information" block → onchain trust data: ERC-8004 identity address, registration date, reputation score, chain, verified skills — labeled by source (**on-chain verified** vs. **marketplace-derived**, see §5)
  - Reviews → **track record**: win rate, volume, uptime — verifiable, not star ratings
- **Search**: live-filtering, recent searches, trending when empty
- **My Agents**: hired/active list, live status, session expiry countdown, tap through to Manage (pause/adjust/revoke)
- **Wallet/Profile**: connect wallet, active sessions, spend caps granted, one-tap revoke

**Style**: neutral background (near-white/near-black by mode), one confident accent color, platform-default system font, 16–20pt padding, 16–20px rounded corners, shadow only on pressable cards.

---

## 5. Data Layer

**Normalized `Agent` type:**

```ts
type AgentCategory = "monitoring" | "rebalancing" | "grid-trading" | "health-factor" | "yield";

interface Agent {
  id: string;                    // ERC-8004 onchain identity / registry ID
  name: string;
  publisher: string;             // operator address or ENS/name
  category: AgentCategory;
  tagline: string;
  description: string;
  iconUrl: string;
  chain: "bsc";
  registeredAt: string;
  reputationScore?: number;
  verifiedSkills: string[];
  liveStats: { /* shape varies by category, see below */ };
  performanceSeries: { timestamp: string; value: number }[];
  recentActivity: { timestamp: string; action: string; txHash?: string }[];
  priceModel: { type: "flat" | "per_call" | "percentage_fee"; amount: string; token: string };
}
```

**Category-specific `liveStats`:**
- **monitoring**: alert frequency, assets watched, last alert timestamp, false-positive rate
- **rebalancing**: rebalance efficiency, active LP range, current P&L, number of LP positions, track-record timeframe
- **grid-trading**: win rate, active price range, current P&L, number of grid levels, track-record timeframe
- **health-factor**: positions monitored, average health factor maintained, liquidations prevented, response latency
- **yield**: current APY, TVL managed, protocols used (Aave/Venus/PancakeSwap/Lista), vault rebalance cadence (the vault's own internal rebalance frequency - not the same concept as the Rebalancing category above)

**Trust Score composition** (label each component by source so the UI can show "on-chain verified" vs. "marketplace-derived" — this is a direct, explicit Data Quality signal for judges):
- ERC-8004 reputation (on-chain)
- Validation signals (on-chain)
- Liveness / uptime (marketplace-derived)
- Transaction history (on-chain, verified against BSC directly)
- Performance history (marketplace-derived)

**Sourcing:**
1. 8004scan Developer API → identity/reputation/discovery listing
2. Direct `viem` RPC reads → verification of individual agents (ownership, URI)
3. Backend aggregation → category-specific live stats pulled from real protocols
4. TanStack Query hooks (`useAgent(id)`, `useAgentsByCategory`, `useSearchAgents`) — longer `staleTime` for identity data, frequent refetch (30–60s) for live stats

**Hard rule**: no hardcoded/fake numeric data presented as live. If a metric isn't wired yet, show a clearly labeled "syncing" state. Don't headline vanity numbers ("278,044 agents registered") — headline something like "Live Agent Activity" with source + timestamp per metric (e.g. "Health Factor 1.84 — Venus — updated 8 sec ago"). This is what makes Data Quality read as real rather than asserted.

---

## 6. Agent Authorization Model — Partially Resolved by Testing (2026-08-28)

**Custody mechanic — resolved for the private-key signer path**: `@altananetwork/sdk` 0.8.0's `createWallet` upgrades the signer's own EOA in place via EIP-7702 (`setCode`) rather than provisioning a separate funded wallet. Confirmed both by the installed package's own doc comments (`internal/passkey.d.ts` describes the EIP-7702 upgrade mechanism) and empirically: `scripts/spike-b-auth.mjs`'s preflight against a freshly generated disposable testnet key reported `Wallet equals signer EOA: true` - the Altana wallet address was identical to the signer's address, no separate funding step. So whichever signer type ends up connected, the "no funding step" branch of §7's hire flow is the one this SDK actually implements.

**Signer availability - a more fundamental blocker than custody**: `@altananetwork/sdk` 0.8.0 ships exactly three signer constructors - `signerFromPrivateKey`/`createPrivateKeySigner` (raw key, server-side/CLI), and `createPasskey`/`signerFromPasskey` (browser-only WebAuthn - `createPasskey` explicitly throws outside a browser). **There is no injected-wallet (EIP-1193/WalletConnect/MetaMask-style) signer in this SDK version**, despite an internal comment describing `signerFromInjected` as a planned adapter - it isn't implemented or exported. A user's Reown-AppKit-connected wallet (§3's locked wallet-connection method) cannot currently drive an Altana session at all - not a funding-step question, a missing-signer-type one. The app's own authorization code already fails this closed correctly (never falls back to asking for a private key).

**React Native passkey path - evaluated, not pursued**: the only non-custodial signer path this SDK version supports is browser WebAuthn. A React Native passkey library (`react-native-passkeys`, `react-native-passkey`) could in principle drive the platform Credential Manager APIs and be reshaped into Altana's `PasskeyCredential` format by hand, but none of the available libraries publicly document their public-key encoding (needed to confirm compatibility with Altana's flat P256 `x || y` format), and passkeys separately require a verified domain hosting `apple-app-site-association`/`assetlinks.json`, which this project doesn't have. Not pursued given the hackathon timeline. **Current status: the signer-driven hire flow stays in its honest device-preview/testnet-demo framing** until either Altana ships an injected-wallet signer or the passkey path gets a real spike.

Spike B's live testnet lifecycle (grant → scoped execute → revoke → confirm rejection) remains unrun pending funding of the disposable probe address - see §12.

**Spike sequence (run in this order, before UI work depends on any of them):**

- **Spike A** — `Expo → Reown AppKit → BSC → viem → ERC-8004 → read one real agent`. Validates the read-only path end to end. Low risk, do first.
- **Spike B** — standalone Node/Bun script (not inside the Expo app): Altana SDK against BSC testnet — create/register wallet identity → grant session (allowlist + spend cap + expiry) → execute one scoped call → revoke. **This settles the custody question directly** — observe whether the session acts on funds the tester already had, or only after a separate deposit. Also incidentally answers whether the SDK runs cleanly in a Node/Bun runtime at all (relevant to §3's backend-only decision, though the plan doesn't depend on the answer either way since Altana stays server-side regardless).
- **Spike C** — only after A and B pass: `Altana session → hireErc8183Agent → real BSC testnet job`, if pursuing the ERC-8183/agent-hiring-agent direction.

**Design the flow to work under either Spike B outcome** — this is why the plan doesn't wait on the answer to keep moving:

- **Read-only agents (monitoring)**: unaffected either way. No authorization needed, just the user's public wallet address. Build fully real regardless.
- **Action-taking agents**: Hire sheet includes a step that's conditionally shown based on Spike B's confirmed result —
  - No funding step needed → straight to permission-grant screen ("Allow this agent to swap BNB↔BUSD, up to $500, for 30 days") → one signature → done
  - Funding step needed → explicit, clearly-labeled "Fund this agent's session wallet" step before the permission grant, amount fully user-controlled and revocable, framed as a bounded allocation, not a blind deposit
- Either way: the agent never receives a private key or unscoped custody. Session is always scoped (allowlist + spend cap + expiry), registered on-chain in Keystore, revocable in one transaction from Manage.
- My Agents activity is sourced from **actual BSC transaction history for the agent's address, cross-referenced against the Keystore session record** — not assumed to be a complete log inside Keystore itself.
- Don't promise "one transaction to hire" in any UI copy until Spike B confirms the actual transaction count.

---

## 7. Hire Flow (Critical Path — Judged on Friction)

1. User taps **Hire** on agent detail page
2. Bottom sheet slides up (App Store "Get" → install flow feel):
   - Wallet not connected → Reown AppKit modal → connect
   - Read-only agents: show data access + any subscription payment, done — no session step
   - Action-taking agents: plain-language terms, user confirms/adjusts spend cap and duration, shows funding step only if Spike B confirmed it's needed
   - Confirm → sign the transaction(s) — count determined by Spike B, not assumed
   - Success → agent appears in **My Agents**, CTA becomes "Manage"
3. Action-taking agents then operate within granted scope without further per-action prompts; all activity visible in My Agents per §6's sourcing rule
4. All failure states (insufficient funds, rejected signature, network error) handled inline with clear, non-technical copy

---

## 8. Onboarding (Do Not Skip)

3–4 screen first-launch carousel, plain language, no jargon:
1. What an onchain AI agent is
2. What the four categories mean
3. How hiring works (wallet, session, spend cap — reassure on safety/control, emphasize non-custodial design)
4. CTA into Discover

This directly serves the "zero Agent Studio knowledge" judging requirement — don't skip it under time pressure.

---

## 9. Information Architecture

```
app/
  (tabs)/
    index.tsx              -> Discover (includes category chip row, see §4)
    search.tsx               -> Search
    my-agents.tsx            -> Hired/active agents
    profile.tsx               -> Wallet + profile
  agent/
    [id].tsx                  -> Agent detail
  category/
    [slug].tsx                 -> Full category listing (reached from Discover's chips, not a tab)
  hire/
    [id].tsx                    -> Hire flow modal/sheet
  manage/
    [id].tsx                     -> Manage active agent
  onboarding/
    index.tsx                     -> First-launch explainer
```

---

## 10. Build Order

1. Scaffold navigation shell (tabs + stack), confirm App Store-style tab bar on iOS and Android
2. **Run Spike A and Spike B** (standalone, outside the app) — settles the read path and the custody question before hire-flow work begins; can run in parallel with step 3–5
3. Build generic `AgentCard`/`AgentDetail` components against mock data matching the `Agent` type
4. Wire NativeWind design system: colors, spacing, typography, shared `Card`/`Pill`/`Button`
5. Build Discover, Categories, Search screens against mock data
6. Integrate `viem` + BSC RPC + 8004scan Developer API, replace mock identity/discovery data with real reads
7. Build backend aggregation endpoints for category-specific live stats, wire TanStack Query hooks, replace remaining mock data
8. Integrate Reown AppKit for wallet connection
9. Build the Hire flow end-to-end against testnet, using the authorization shape Spike B confirmed — start with monitoring (no auth complexity), then the one chosen action-taking category (Health Factor)
10. Build My Agents / Manage screens with real hired-agent state
11. Build onboarding carousel
12. Polish: haptics, transitions, empty states, error states, App Store-style shimmer loading skeletons
13. Run **Spike C** if time remains (ERC-8183 hiring flow)
14. Deploy a public build (EAS + TestFlight/Play internal track, or Expo Go-shareable link) — must be publicly accessible during judging

---

## 11. Non-Negotiables (Tie Back to Judging Rubric)

- All four categories equal visual weight and equal *data* depth — no category looks like a placeholder, even where activation is simplified per §2
- No dead ends anywhere in the primary flow (browse → detail → hire)
- Real, live, accurate data wherever technically possible; label anything not yet live rather than faking it — never a fabricated number presented as live
- Understandable and usable by someone who has never heard of BNB Agent Studio before opening the app
- Non-custodial design communicated clearly in UI copy, not just true under the hood — this is both a trust feature and directly what the Altana bounty judges on

---

## 12. Verification Status (What's Confirmed vs. Still Open)

**Confirmed real and current**, cross-checked against primary/near-primary sources:
- ERC-8004 registry deployed on BSC mainnet (specific contract addresses verified)
- Reown AppKit for React Native — current package, Expo-compatible, active maintenance
- x402 has real buyer/seller SDK split; seller-side confirmed server-only
- 8004scan is a live indexing product with a developer API
- Altana session-key model (allowlist + spend cap + expiry + on-chain Keystore + revocation) is real and integrated into BNB Agent Studio — not hackathon vaporware

**Still open, resolve via Spikes A/B/C before depending on them:**
- Custody mechanic (§6) is resolved for the private-key signer path (no funding step - EIP-7702 upgrades the signer's own EOA). The actual blocker is signer availability: `@altananetwork/sdk` 0.8.0 has no injected-wallet signer, only private-key and browser-only WebAuthn passkey. See §6.
- Spike B's live testnet lifecycle (grant → execute → revoke) has not run end-to-end: the preflight succeeded and produced the custody finding above, but the disposable probe address (`0x5593B7eaBF45e121C0e9870c528C7B80D0F2331D`, chain 97) is unfunded and the public faucet hasn't been reachable to fund it. Not a blocker - the custody question it exists to answer is already settled from the preflight alone.
- A Convex backend now exists (`convex/`) for category-stats aggregation (Venus health factor, PancakeSwap V3 positions, Aave TVL - real reads, verified contract addresses) - see README.md's "Backend (Convex)" section. Monitoring stats, Aave APY, and Lista DAO reads are explicitly not wired up yet, not faked.
- Altana SDK's confirmed runtime compatibility (mitigated by keeping it backend-only regardless of the answer)
- Exact hire-flow transaction count
- 8004scan's rate limits/latency at mobile-app scale (mitigated by backend caching regardless)