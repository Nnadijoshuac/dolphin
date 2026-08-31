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
  hire flow that completes there.
- An Altana passkey smart account ("Dolphin Wallet") on both products' browser
  targets: create, recover, live balance, scoped session grants with a visible
  spend cap and call allowlist, and one-tap revocation from either the wallet
  screen or the hire record. See "Wallets and authorization" below.
- Device-only setup previews that are always labeled as not onchain.
- A Convex backend (`convex/`) that reads real per-agent-wallet on-chain state
  for category live stats - see "Backend (Convex)" below.

## How the system fits together

Two products, one backend. Neither frontend shapes agent data itself — both
render what `agents.listAgents` returns, which is what stops them drifting.

```
┌────────────────────────┐        ┌────────────────────────┐
│      Mobile app        │        │       Website          │
│  Expo SDK 54 + Router  │        │      Next.js 16        │
│      (repo root)       │        │        (web/)          │
│                        │        │                        │
│  own package.json      │        │  own package.json      │
│  own lockfile          │        │  own lockfile          │
└───────────┬────────────┘        └───────────┬────────────┘
            │                                 │
            │   no shared node_modules,       │
            │   no npm workspaces             │
            └────────────────┬────────────────┘
                             │
                             ▼
                 ┌───────────────────────┐
                 │   Convex  (convex/)   │
                 │                       │
                 │  agents.listAgents    │ ◄── the single source of truth
                 │  agentHires           │     for agent identity, category
                 │  agentSessions        │     and price policy
                 │  categoryStats        │
                 └───────────┬───────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
  ┌───────────────────────┐      ┌───────────────────────┐
  │  Discovery pipeline   │      │  Protocol reads       │
  │  (discoveryPipeline)  │      │  (convex/protocols/)  │
  │                       │      │                       │
  │  sweep      every 1h  │      │  Venus     Comptroller│
  │  evaluate   every 30m │      │  Pancake   V3 PosMgr  │
  │  icons      every 12h │      │  Aave      V3 Pool    │
  │  directory  every 6h  │      │                       │
  └───────────┬───────────┘      └───────────┬───────────┘
              │                              │
              ▼                              ▼
  ┌───────────────────────┐      ┌───────────────────────┐
  │  8004scan API         │      │  BNB Smart Chain (56) │
  │  + each agent's own   │      │  ERC-8004 identity    │
  │    registration file  │      │  registry, via viem   │
  │  + a liveness probe   │      │                       │
  │    of its endpoint    │      │                       │
  └───────────────────────┘      └───────────────────────┘
```

An agent reaches the catalog only by surviving every stage: a cheap pre-filter,
a weighted classifier, a cross-check against the agent's own registration file,
and a liveness probe of its advertised endpoint. Auto-publishing requires
`confirmed` **and** `verified-live`; anything short of that is held `pending`
with a stated reason. See `convex/discoveryPipeline.ts`.

## Wallets and authorization

Dolphin uses **two separate accounts**, and the distinction is load-bearing
rather than cosmetic.

| | Connected wallet | Dolphin Wallet |
|---|---|---|
| What | MetaMask / WalletConnect | Altana passkey smart account |
| Built with | wagmi `injected()` | `@altananetwork/sdk` 0.8.0 |
| Used for | identifying you on a hire record | holding a scoped session |
| Can an agent spend from it? | **never** | only within a granted session |
| Where | both products | browser targets only |

They cannot be the same account. `@altananetwork/sdk` 0.8.0 ships exactly two
usable signer families — private key and browser WebAuthn passkey.
`signerFromInjected` appears only in the package's own doc comments and is never
implemented or exported (verified by grepping `dist/`). So an Altana session
cannot be granted against a wallet connected through MetaMask, and a Dolphin
Wallet is a genuinely separate account with its own balance. Both wallet screens
say so in as many words.

Dolphin uses the **passkey** signer, not a private key: Altana never persists
key material and cannot return a generated private key, so a private-key wallet
would make this app solely responsible for custody with no recovery path. See
`ALTANA_SIGNER_STRATEGY` in `web/src/wallet/altana-policy.ts` (and its
hand-mirrored twin at `src/wallet/altana-policy.ts`).

### The session lifecycle

```
 1. CREATE                     2. FUND                    3. GRANT
 ┌──────────────────┐          ┌──────────────────┐       ┌──────────────────┐
 │ createPasskey    │          │ send BNB to the  │       │ grantSession     │
 │ Wallet()         │          │ wallet address   │       │  calls:  [addr]  │
 │                  │          │                  │       │  spend:  cap/day │
 │ Face ID /        │  ──────► │ counterfactual   │ ────► │  expiry: N days  │
 │ Touch ID /       │          │ and empty until  │       │                  │
 │ Windows Hello    │          │ this happens     │       │ one passkey tap  │
 └──────────────────┘          └──────────────────┘       └────────┬─────────┘
   no seed phrase                no gas until funded                │
   no key ever leaves                                               │
   the secure element                                               ▼
                                                        ┌──────────────────────┐
                                                        │ recorded in Convex   │
                                                        │ agentSessions        │
                                                        │ (public detail only, │
                                                        │  never a key)        │
                                                        └──────────┬───────────┘
                                                                   │
                    ┌──────────────────────────────────────────────┘
                    ▼
 4. THE AGENT ACTS, INSIDE THE BOUNDARY
 ┌───────────────────────────────────────────────────────────────────────┐
 │  execute(session, calls)                                              │
 │                                                                       │
 │    call to an ALLOWLISTED contract, within the cap   ──►  proceeds    │
 │    call to any other contract                        ──►  REVERTS     │
 │    spend over the cap                                ──►  REVERTS     │
 │    any call after expiry                             ──►  REVERTS     │
 │                                                                       │
 │  Enforced by the Altana account contract at validation time, on       │
 │  chain — not by Dolphin, and not by the agent choosing to behave.     │
 └───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
 5. REVOKE, AT ANY TIME
 ┌───────────────────────────────────────────────────────────────────────┐
 │  revokeSession(publicKey)  — reachable from BOTH the wallet screen    │
 │  and the hire record's own row. Effective immediately; the row is     │
 │  kept and marked revoked rather than deleted, so "I revoked that"     │
 │  stays checkable afterwards.                                          │
 └───────────────────────────────────────────────────────────────────────┘
```

**Not every agent gets a session.** Granting spend authority to an agent that
only delivers information would imply a capability it does not have. The policy
is per category, in `altana-policy.ts`:

| Category | Session? | Allowlisted contract | Why |
|---|---|---|---|
| Health factor | yes | Venus Core Pool Comptroller | acting before a liquidation is the job |
| Rebalancing | yes | PancakeSwap V3 Position Manager | rebalancing a position means moving it |
| Yield | yes | Aave V3 Pool | moving capital to the best venue is the job |
| Grid trading | **no** | — | no wired data source and no verified venue address, so a session would be authority into a blind spot |
| Monitoring | **no** | — | information delivery by definition |

Every allowlisted address is one this repo had **already** verified
independently against the protocol's own deployments file for its live-stats
reads. This feature introduced no new contract address, deliberately — an
allowlist is the one place a wrong address becomes real authority over real
money. A consequence worth knowing: these allowlists are narrower than a full
strategy would need, and a call outside them is rejected on-chain. That is the
guardrail working, not a bug.

`calls` is never omitted. Altana treats an omitted or empty `calls` as "any
contract", so `buildSessionPermissions` throws rather than emit permissions
without it, and the Convex mutation refuses to record an empty allowlist.

### What is verified, and what is not

`createPasskeyWallet`, `recoverFromPasskey`, `balances`, and the whole
session-granting UI were verified live in a real browser against a real
WebAuthn ceremony on both products.

**The on-chain enforcement itself was not observed in this build.** Dolphin's
Altana wallets are on BSC **mainnet** (chain 56), matching every other read in
the product, which means a session grant costs real BNB. The
grant → in-bounds call → out-of-bounds call rejected → revoke lifecycle has
therefore not been run end to end here; it is built to the documented API and
the revert-at-validation-time behaviour is Altana's documented guarantee, not
something this repo has watched happen. `scripts/spike-b-auth.mjs` produces
that proof against chain 97 the moment a disposable address is funded.

## Important authorization status

Read-only monitoring can use a public wallet address without signing authority.

Dolphin will never ask a user to import a private key into the app.

ERC-8004 identity, Altana authorization, and ERC-8183 payment escrow are
distinct. No payment or escrow is simulated. Saving a device preview does not
start an agent.

**Session granting is available on browser targets** (the website, and the
mobile app's web export) and unavailable on a native Expo build. That split is
not a missing feature — it is a platform fact, verified rather than assumed:
React Native's global `navigator` is literally `{product: 'ReactNative'}` (see
`node_modules/react-native/Libraries/Core/setUpNavigator.js`), so there is no
`navigator.credentials` for WebAuthn to use. The native wallet screen says so
and points at the browser, where the same passkey opens the same wallet.

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
which this project doesn't have.

That conclusion still stands for a **native** build. What changed is that it
turned out not to matter for the surface people actually reach: the mobile
app's public build is its **web export**, which runs in a browser where
WebAuthn is available, so the Dolphin Wallet works there in full. The native
target renders an honest unavailable state pointing at the browser. See
"Wallets and authorization" above.

**Bundling note, measured rather than assumed.** The Altana SDK is kept out of
the native bundle entirely. Two things were needed, and each was verified with
a real `expo export`: the platform-router pattern used by
`src/wallet/wallet-provider.ts` makes Metro ship *both* platform modules to
*both* targets, so the Altana wallet uses Metro's own platform resolution plus
a `.d.ts` instead (no `tsconfig` change needed); and `altana-policy.ts` must
import nothing from the SDK, because the package root is a barrel and importing
one chain id from it dragged the whole tree in. After both, the Android bundle
contains zero references to `createPasskeyWallet` or the Altana relay, and the
web bundle contains them.

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

The first run stops after printing an unfunded derived address. Fund that
address from the BSC testnet faucet and run it again. **This probe has never
been reported as passed in this repository**, because the derived address has
never been funded - so the grant → execute → revoke → post-revoke-rejection
lifecycle it exists to demonstrate remains unobserved here. Running it is the
single cheapest way to turn Altana's documented enforcement guarantee into
something this repo has actually watched happen.

`scripts/spike-altana-env.mjs` is the other probe, and it is free: no key, no
funding, no transaction. It reports what the SDK does and does not support in
the current environment (passkey availability, counterfactual wallet creation,
balance reads, relay reachability).

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

Alongside the live-stats reads, `convex/` owns the two records a hire produces:

- **`agentHires`** - the read-only subscription record. No signature, no spend
  cap, no transaction; it costs exactly zero, which is why
  `DEFAULT_READ_ONLY_PRICE_MODEL` can honestly price it at zero without
  claiming anything about what the publisher charges.
- **`agentSessions`** - Altana session grants (`convex/agentSessions.ts`).
  Public reference detail only: the session's public key, its bounds, and the
  agent it was granted to. No signer and no key material passes through, so
  nothing in that table can act on a wallet - only describe a grant and
  identify what to revoke. It exists so the wallet screen and the hire record
  cannot tell two different stories about the same authority.

  `recordSessionGrant` records a grant that **already happened** on-chain; it
  cannot create one, because Convex cannot sign. It refuses an empty allowlist,
  since that is how Altana spells "any contract".

**Setup:** `npx convex dev` needs an interactive browser login the first time,
to create or link a deployment. It writes `CONVEX_DEPLOYMENT` and
`EXPO_PUBLIC_CONVEX_URL` into `.env.local` itself, and `convex/_generated/` is
real codegen output once it has run - do not hand-write stand-ins for it. Leave
`npx convex dev` running in a second terminal while developing; it pushes
function changes live.

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
