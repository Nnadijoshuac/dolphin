# Dolphin

Dolphin is an Expo SDK 54 mobile marketplace for discovering ERC-8004 agents on
BNB Smart Chain. Its interface follows an App-Store-style browse → detail → setup
journey while keeping registry identity, publisher claims, live evidence, wallet
authorization, and payment as separate concepts.

## What is implemented

- Discover, Categories, Search, My Agents, and Wallet tabs.
- Agent, category, setup review, preview management, and onboarding routes.
- Four equal discovery categories: Monitoring, Grid Trading, Health Factor, and
  Yield.
- Anonymous 8004scan discovery with a small explicitly classified fallback set.
- Direct BSC ERC-8004 `ownerOf`, `tokenURI`, and agent-wallet reads through viem.
- TanStack Query caching, network/focus integration, and truthful unavailable or
  syncing metric states.
- Reown AppKit/Wagmi integration on native builds, gated by a project ID.
- Device-only setup previews that are always labeled as not onchain.

## Important authorization status

Read-only monitoring can use a public wallet address without signing authority.
Action-agent activation is intentionally unavailable in this build: testing with
`@altananetwork/sdk` 0.8 found no injected/WalletConnect signer path, and Dolphin
will never ask a user to import a private key.

ERC-8004 identity, Altana authorization, and ERC-8183 payment escrow are distinct.
No payment, escrow, session grant, or autonomous execution is simulated. Saving a
device preview does not start an agent.

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

```text
src/app/(tabs)/index.tsx          Discover
src/app/(tabs)/categories.tsx     Category browse
src/app/(tabs)/search.tsx         Local live filtering
src/app/(tabs)/my-agents.tsx      Device previews
src/app/(tabs)/profile.tsx        Wallet and capability status
src/app/agent/[id].tsx            Agent detail
src/app/category/[slug].tsx       Full category listing
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
