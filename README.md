# Dolphin

Dolphin is a marketplace for discovering ERC-8004 agents on BNB Smart Chain. It
ships as **two independent products sharing one backend**, so neither surface can
drift from the other:

| | | |
|---|---|---|
| **Mobile app** | repo root | Expo SDK 54 + Expo Router + NativeWind |
| **Website** | `web/` | Next.js 16 + Tailwind v4 |
| **Backend** | `convex/` | shared by both; `agents.listAgents` is the single source of truth for agent data |

Each project has its own `package.json` and lockfile and installs separately —
there are no npm workspaces and no shared `node_modules`, deliberately, so one
project's dependency tree cannot break the other's.

```bash
npm install && npx expo start          # mobile app, from the repo root
cd web && npm install && npm run dev    # website, at http://localhost:3000
```

The website needs `NEXT_PUBLIC_CONVEX_URL` in `web/.env.local` pointing at the
same Convex deployment as the app's `EXPO_PUBLIC_CONVEX_URL` — that shared URL is
what keeps the two in sync. See `web/.env.example`.

Both interfaces follow a browse → detail → activate journey while keeping registry
identity, publisher claims, live evidence, wallet authorization, and payment as
separate concepts.

## What is implemented

- Discover, Search, My Agents, and Wallet tabs (4 tabs - category browsing
  lives inside Discover as a chip row, not its own tab).
- Agent, category, setup review, preview management, and onboarding routes.
- Four equal discovery categories: Rebalancing, Grid Trading, Health Factor, and
  Yield. ("Monitoring" is still a valid category with one real agent, but is
  deliberately excluded from the four graded ones — see project-scope.md's
  taxonomy notes.)
- Anonymous 8004scan discovery with a small explicitly classified fallback set.
- Direct BSC ERC-8004 `ownerOf`, `tokenURI`, and agent-wallet reads through viem.
- TanStack Query caching, network/focus integration, and truthful unavailable or
  syncing metric states.
- Reown AppKit/Wagmi integration on native builds, gated by a project ID.
- A working browser-wallet connection on the website (wagmi `injected()`), and a
  hire flow that completes there — the website is currently the only surface
  where the full journey reaches a finished state.
- Device-only setup previews that are always labeled as not onchain.
- A Convex backend (`convex/`) that reads real per-agent-wallet on-chain state
  for category live stats - see "Backend (Convex)" below.

## Important authorization status

Read-only monitoring can use a public wallet address without signing authority.
Action-agent activation is intentionally unavailable in this build. The installed
`@altananetwork/sdk` 0.8.0 package exposes private-key and passkey constructors,
but no injected/WalletConnect signer constructor. Dolphin will never ask a user to
import a private key into the app as a workaround.

ERC-8004 identity, Altana authorization, and ERC-8183 payment escrow are distinct.
No payment, escrow, session grant, or autonomous execution is simulated. Saving a
device preview does not start an agent.

**Custody mechanic (resolved for the private-key path):** Altana's `createWallet`
upgrades the signer's own EOA in place via EIP-7702 rather than provisioning a
separate funded wallet - confirmed by `scripts/spike-b-auth.mjs`'s preflight
(`Wallet equals signer EOA: true`). The actual blocker is signer availability, not
custody - see `project-scope.md` §6 for the full writeup.

**React Native passkey path (evaluated, not pursued):** the only non-custodial
signer path this SDK version supports is browser-only WebAuthn
(`createPasskey` throws outside a browser). A React Native passkey library could
in principle drive the platform Credential Manager APIs and be reshaped into
Altana's `PasskeyCredential` format, but none of the available RN passkey
libraries publicly document their public-key encoding (needed to confirm
compatibility with Altana's flat P256 `x || y` format), and passkeys separately
require a verified domain hosting `apple-app-site-association`/`assetlinks.json`,
which this project doesn't have. Not pursued further given the hackathon
timeline; the device-preview fallback stands for the signer-driven flow.

### Spike B testnet probe

`scripts/spike-b-auth.mjs` is a real chain-97 lifecycle probe, not a simulation. It
derives the Altana wallet, grants a one-hour session limited to one harmless
precompile and a one-wei daily spend cap, executes once, revokes, and confirms the
revoked session is rejected. Use only a disposable BSC testnet key:

```powershell
$env:ALTANA_TEST_PRIVATE_KEY = "<disposable-testnet-private-key>"
npm run spike:altana
Remove-Item Env:\ALTANA_TEST_PRIVATE_KEY
```

## Backend (Convex)

`convex/` aggregates real per-agent-wallet on-chain reads so category live stats
don't have to stay "syncing" forever. Wired against contract addresses verified
against each protocol's own GitHub deployment files (see inline comments in
`convex/protocols/` for sources):

- **Health Factor** (`convex/protocols/venus.ts`) - real Venus Core Pool health
  factor, derived per-market from `Comptroller.getAssetsIn` + `getAccountSnapshot`
  + collateral factor + oracle price, since Venus doesn't expose a single ratio
  directly. Unverified against a live funded position - spot-check against
  app.venus.io before trusting it for a demo.
- **Grid Trading** (`convex/protocols/pancakeswap.ts`) - real PancakeSwap V3 LP
  position count and tick range. Win rate / P&L / track-record period stay
  honestly unavailable - they need historical fee-accrual data this backend
  doesn't compute.
- **Yield** (`convex/protocols/aave.ts`) - real Aave V3 (BNB Chain market)
  supplied-collateral USD value. APY stays unavailable (needs a ray-to-APY
  conversion not yet implemented); Lista DAO reads are not wired up (needs its
  full ~15-token collateral list).
- **Monitoring** (`convex/protocols/unavailable.ts`) - honestly unavailable. This
  category describes an agent's own alerting behavior, not shared protocol
  state, so there is no generic on-chain feed for it.

Every value that isn't a genuine on-chain read stays `unavailable` with a specific
reason - never a fabricated number - matching the client's own `LiveMetric<T>`
data-integrity convention.

**Setup required (not yet done in this repo):** `npx convex dev` needs an
interactive browser login to create/link a deployment, which an automated
environment can't perform. Until that runs once:

- `convex/_generated/{server,dataModel}.ts` are hand-written to match what
  codegen produces (so the backend typechecks now); running `npx convex dev`
  will safely regenerate them.
- `EXPO_PUBLIC_CONVEX_URL` is unset, so `ConvexClientProvider` renders no
  provider and `useAgentCategoryStats` has nothing to talk to.

To finish setup: `npx convex dev` (log in when prompted), then set
`EXPO_PUBLIC_CONVEX_URL` in `.env` to the printed deployment URL.

The first run can stop after printing an unfunded derived address. Fund that
address from the BSC testnet faucet and run it again. The probe has not been
reported as passed in this repository without observed testnet receipts.

## Setup

Requirements: Node.js 20+, npm, and an Expo SDK 54-compatible native toolchain.

```bash
npm ci
copy .env.example .env
npx expo start
```

Configure only public client values in `.env`:

```dotenv
EXPO_PUBLIC_REOWN_PROJECT_ID=
EXPO_PUBLIC_BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
```

`EXPO_PUBLIC_*` values are bundled into the app. Never put private keys, seed
phrases, facilitator secrets, or server credentials in them.

Wallet deep-link return through `dolphin://` requires a native development or
release build. The static web build intentionally displays a native-build-required
wallet state.

## Routes

4 tabs, not 5 - category browsing lives inside Discover as a chip row rather
than its own tab (project-scope.md §4/§9); `category/[slug].tsx` is still a
full route, just reached from those chips instead of a tab bar item.

```text
src/app/(tabs)/index.tsx          Discover (includes category chip row)
src/app/(tabs)/search.tsx         Local live filtering
src/app/(tabs)/my-agents.tsx      Device previews
src/app/(tabs)/wallet.tsx         Wallet and capability status
src/app/agent/[id].tsx            Agent detail
src/app/category/[slug].tsx       Full category listing (from Discover's chips)
src/app/hire/[id].tsx             Truthful setup review
src/app/manage/[id].tsx           Device-preview management
src/app/onboarding/index.tsx      First-launch explainer
```

## Data policy

- Missing data is `null`, never a fabricated zero.
- Performance charts require at least two dated, sourced observations.
- Publisher-reported skills are not labeled verified.
- A zero-feedback record is not presented as a zero-star reputation.
- 8004scan endpoint health is not treated as an ERC-8004 capability guarantee.
- API keys belong in a backend proxy; this client uses anonymous indexed reads.

## Verification

```bash
npx tsc --noEmit
npm run lint
npx expo install --check
npx expo-doctor
npx expo export --platform web
```

Expo web output is intentionally kept outside source control during verification.
The committed `assets/Ui_design` directory contains design references, not runtime
screens or fabricated product data.
