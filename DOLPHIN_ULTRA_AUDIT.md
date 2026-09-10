# Dolphin Ultra Audit

Date: 2026-09-10

Scope: this audit is based on repository evidence only. I reviewed the Expo app, Next.js web app, Convex backend, wallet/payment code, AI orchestration, package manifests, config files, `.env.example` files, and project docs. I did not read `.env.local` files because they may contain secrets. No local smart-contract source, Hardhat/Foundry project, Python requirements, or Solidity files were found by the repository file scan (`rg --files -g "*.sol" -g "hardhat.config.*" -g "foundry.toml" -g "requirements*.txt"` returned only app/docs/env/package files).

## PART 1 - Sponsor Integration Audit

### Summary Table

| Sponsor/Track | Status | Key Files |
|---|---:|---|
| BNB Agent Studio | No | `Agent/project-scope.md`, `AGENTS.md`, `package.json`, `web/package.json` |
| Altana SDK / MCP server | Partial | `package.json`, `web/package.json`, `src/wallet/altana-provider.native.tsx`, `src/wallet/altana-provider.web.tsx`, `src/wallet/altana-policy.ts`, `src/wallet/altana-passkey-native.ts`, `convex/lib/mcpClient.ts`, `convex/lib/decisionTools.ts`, `convex/agentSessions.ts`, `convex/agentPayments.ts` |
| x402 API Payments | No | `convex/lib/erc8183.ts`, `src/wallet/erc8183-policy.ts`, `convex/sources/scan8004.ts`, `convex/lib/publicAgent.ts`, `package.json`, `web/package.json` |
| 8004scan / ERC-8004 | Yes | `convex/sources/scan8004.ts`, `convex/model/agent.ts`, `src/services/chain.ts`, `src/services/reputation-registry.ts`, `convex/agentReviews.ts` |
| TermiX | No | `convex/lib/screen.ts`, `convex/lib/erc8183.ts`, package manifests |
| PancakeSwap | Partial | `convex/protocols/pancakeswap.ts`, `src/wallet/altana-policy.ts`, `src/wallet/erc8183-policy.ts`, `convex/categoryStats.ts` |
| Reown / WalletConnect AppKit | Yes | `package.json`, `src/wallet/wallet-provider.native.tsx`, `queries.js`, `app.json`, `web/src/wallet/wallet-provider.tsx` |
| Native mobile passkeys | Partial | `package.json`, `src/wallet/altana-passkey-native.ts`, `src/wallet/altana-provider.native.tsx`, `src/wallet/altana-rp-id.ts`, `app.json` |
| Other BNB Chain tooling | Yes | `convex/lib/bscClient.ts`, `src/constants/agents.ts`, `.env.example`, `web/.env.example`, `scripts/spike-b-auth.mjs`, `src/services/reputation-registry.ts`, `convex/protocols/*` |

### 1. BNB Agent Studio - Status: No

Evidence: the repo references BNB Agent Studio as hackathon context and product framing, but I found no BNB Agent Studio CLI dependency, no generated agent config, and no Cursor-scaffolded agent code in the package manifests or source tree (`Agent/project-scope.md` names the BNB Chain Build the Era hackathon and BNB Agent Studio user requirement; `AGENTS.md` mentions x402/b402 per BNB Agent Studio spec; `package.json` and `web/package.json` contain no BNB Agent Studio dependency or CLI script).

How it is used: BNB Agent Studio is used as a judging/design reference, not as an implemented scaffold or runtime integration (`Agent/project-scope.md` sections on hackathon scope and "zero Agent Studio knowledge" onboarding; `src/app/onboarding/onboarding-client.tsx` comments mention someone who has never heard of BNB Agent Studio).

Referenced with no working code behind it: BNB Agent Studio appears in docs/planning, but the actual runtime is custom Expo/Next/Convex plus Altana/Reown/viem (`package.json`, `web/package.json`, `src/providers/app-providers.tsx`, `convex/schema.ts`).

### 2. Altana SDK / MCP server - Status: Partial

Evidence for Altana SDK: the Expo app depends on `@altananetwork/sdk` `0.9.0`, and the website depends on `@altananetwork/sdk` `0.8.0` (`package.json`, `web/package.json`). The Expo native and Expo web Altana providers import `BNB`, `createClient`, `erc8183Addresses`, `hireErc8183Agent`, and passkey/session helpers from the SDK (`src/wallet/altana-provider.native.tsx`, `src/wallet/altana-provider.web.tsx`). The app constructs a Dolphin Wallet, reads balances, registers/recoverability via Altana KeyStore, grants/revokes sessions, and pays ERC-8183 jobs with `hireErc8183Agent` (`src/wallet/altana-provider.native.tsx:createWallet`, `recoverWallet`, `grantSession`, `revokeSession`, `registerWallet`, `payForAgent`; same functions in `src/wallet/altana-provider.web.tsx`).

Evidence for session-key permission logic: `src/wallet/altana-policy.ts` defines `FEATURE_SESSION_EXECUTION: boolean = false`, `ALTANA_CHAIN_ID = 56`, `CATEGORY_SESSION_POLICY`, spend caps, durations, `sessionPolicyFor`, and `buildSessionPermissions`. The policy allowlists Venus Comptroller for `health-factor`, PancakeSwap V3 position manager for `rebalancing`, and Aave V3 Pool for `yield`; `grid-trading`, `monitoring`, `trading`, and unknown categories fail closed as read-only (`src/wallet/altana-policy.ts:CATEGORY_SESSION_POLICY`, `buildSessionPermissions`). Convex records session grants and revocations by public metadata only, not signing keys (`convex/agentSessions.ts:recordSessionGrant`, `markSessionRevoked`, `getSessionsForAltanaWallet`).

Important caveat: the permission layer is explicitly gated off and no agent-side execution runtime receives session signing keys (`src/wallet/altana-policy.ts` top comment and `FEATURE_SESSION_EXECUTION: boolean = false`; `web/src/services/authorization.ts:assessAuthorizationCapability` marks `altana_action_session` unavailable because the website's Altana SDK path cannot use WalletConnect signers). This makes the Altana session implementation real but not a live autonomous-spending feature.

Evidence for ERC-8183 seller path: paid hires are implemented over A2A-negotiated ERC-8183 escrow, not x402 (`convex/lib/erc8183.ts` decision header; `convex/agentPayments.ts:requestQuote`, `recordJobPayment`, `notifyJobFunded`; `src/wallet/erc8183-policy.ts`; `src/wallet/altana-provider.native.tsx:payForAgent`; `src/wallet/altana-provider.web.tsx:payForAgent`). `normalizeQuote` verifies quoted provider against the agent's registered ERC-8004 wallet, quoted chain against BSC chain 56, and payment token/escrow addresses as valid EVM addresses (`convex/lib/erc8183.ts:normalizeQuote`). `recordJobPayment` reads `getJob` from the ERC-8183 kernel and checks client, provider, budget, and non-OPEN status before inserting `agentJobs` (`convex/agentPayments.ts:recordJobPayment`, `insertJobRecord`).

Evidence for MCP server/client integration: Dolphin implements an MCP Streamable HTTP client that performs `initialize`, carries `mcp-session-id`, sends `notifications/initialized`, lists tools, and calls `tools/call` through `safeFetch` (`convex/lib/mcpClient.ts:openMcpSession`, `listMcpTools`, `callMcpTool`). The model tool menu is built from live MCP candidates, caps agents/tools, filters mutating tool names, and binds model-visible names back to catalog endpoints so the model cannot invent endpoints or payees (`convex/lib/decisionTools.ts:buildToolMenu`, `MAX_AGENTS_PER_DECISION`, `MAX_TOOLS_TOTAL`, `isMutating`).

Session serialize/deserialize: AppKit storage serializes WalletConnect/Reown state in AsyncStorage (`src/wallet/wallet-provider.native.tsx:deserialize`, `appKitStorage`), and Altana passkey handles are persisted in SecureStore/localStorage (`src/wallet/altana-provider.native.tsx:CREDENTIAL_KEY`, `writeStored`; `src/wallet/altana-provider.web.tsx:CREDENTIAL_KEY`, `writeStored`). I did not find an Altana session serialize/deserialize API call for live session keys; the code intentionally keeps `liveSessions` in memory and stores only public session metadata in Convex (`src/wallet/altana-provider.native.tsx:liveSessions`, `convex/agentSessions.ts`).

Altana composable skills actually called: none of the 10 named Altana skill package/API surfaces are imported by name. The project implements custom protocol reads or allowlists that correspond to some domains: Venus Lending is partially represented by Venus Comptroller reads and session allowlist (`convex/protocols/venus.ts`, `src/wallet/altana-policy.ts:VENUS_COMPTROLLER`); PancakeSwap Liquidity is partially represented by PancakeSwap V3 LP position reads and session allowlist (`convex/protocols/pancakeswap.ts`, `src/wallet/altana-policy.ts:PANCAKE_V3_POSITION_MANAGER`); Aave V3 Lending is partially represented by Aave V3 Pool reads and session allowlist (`convex/protocols/aave.ts`, `src/wallet/altana-policy.ts:AAVE_V3_POOL`). Copy Trade, Four.meme Trading, Lista Liquid Staking, PancakeSwap Trading, Token Radar, Wallet Tracker, and x402 API Payments are not implemented as Altana composable-skill calls; Lista is explicitly described as not wired in the knowledge/protocol notes (`convex/knowledge.json`, `convex/protocols/unavailable.ts`).

How it is used: Altana is used for Dolphin Wallet passkeys, wallet balance/recoverability, gated scoped-session design, and ERC-8183 escrow payments; MCP is used both to verify marketplace agents and to let Dolphin's built-in brain consult third-party agents (`src/wallet/altana-provider.native.tsx`, `src/wallet/altana-provider.web.tsx`, `convex/lib/mcpClient.ts`, `convex/dolphin.ts:ask`).

### 3. x402 API Payments - Status: No

Evidence: the code explicitly says paid hires settle over ERC-8183 rather than x402 because measured catalog endpoints did not answer HTTP 402 (`convex/lib/erc8183.ts` decision header; `src/wallet/erc8183-policy.ts` decision header). There is no `@x402/*` package in the Expo or web package manifests (`package.json`, `web/package.json`). The only x402 data field is the indexer-derived boolean `x402Supported`, normalized from 8004scan and exposed on public agent rows (`convex/sources/scan8004.ts:normalizeListItem`, `convex/verification.ts:applyVerification`, `convex/lib/publicAgent.ts:toPublicAgent`).

Agent-to-agent payment flows: there is a working custom payment flow, but it is ERC-8183/A2A, not x402 (`convex/agentPayments.ts:requestQuote`, `recordJobPayment`, `notifyJobFunded`; `src/wallet/altana-provider.native.tsx:payForAgent`). The code comments mention that the Altana SDK ships x402 helpers, but the current repo has no seller-side x402 implementation (`convex/lib/erc8183.ts`, `src/wallet/erc8183-policy.ts`).

How it is used: x402 is used as an indexed flag and design reference, not as the actual payment protocol in the product (`convex/sources/scan8004.ts:x402Supported`, `convex/lib/publicAgent.ts:x402Supported`).

### 4. 8004scan / ERC-8004 - Status: Yes

Evidence for 8004scan Developer Hub/API usage: `convex/sources/scan8004.ts` is the boundary for 8004scan field names, calls `https://api.8004scan.io/api/v1/agents` by default, appends `chain_id=56&is_testnet=false`, supports `SCAN8004_API_KEY`, normalizes list/detail records, endpoints, services, `x402_supported`, feedback counts, and protocol flags (`convex/sources/scan8004.ts:AGENTS_URL`, `headers`, `fetchAgentPage`, `fetchAgentDetail`, `normalizeListItem`, `normalizeDetail`). Discovery uses 8004scan filters such as `has_a2a`, `has_mcp`, `created_after`, and `is_active=any`, with fallback behavior when filters fail (`convex/discovery.ts:run`).

Evidence for ERC-8004 identity: the canonical `agentKey` is `"<chainId>:<lowercase registry address>:<tokenId>"`, BSC chain is 56, and the primary identity registry is `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (`convex/model/agent.ts:BSC_CHAIN_ID`, `ERC8004_IDENTITY_REGISTRY`, `buildAgentKey`, `parseAgentKey`, `coerceAgentKey`). The frontend has viem reads for `ownerOf`, `tokenURI`, and `getAgentWallet` on that identity registry (`src/services/chain.ts:ERC8004_IDENTITY_REGISTRY_ABI`, `verifyAgentRegistration`).

Evidence for reputation/feedback: the ERC-8004 Reputation Registry proxy is `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, paired with the same identity registry (`src/services/reputation-registry.ts:REPUTATION_REGISTRY_ADDRESS`, `REPUTATION_REGISTRY_ABI`; `convex/lib/reputationRegistry.ts:REPUTATION_REGISTRY_ADDRESS`, `REPUTATION_REGISTRY_IDENTITY`). Reviews are saved in Convex only after the reviewer has an authenticated, sufficiently aged hire (`convex/agentReviews.ts:getReviewEligibility`, `submitReview`), and on-chain publication is verified by reading the transaction receipt/calldata back from BSC before marking the review as published (`convex/agentReviews.ts:attestReviewOnChain`; `src/hooks/use-agent-reviews.ts:usePublishReviewOnChain`).

How it is used: 8004scan supplies discovery and metadata; ERC-8004 supplies identity, agent wallet verification, and reputation registry publishing (`convex/sources/scan8004.ts`, `convex/verification.ts:verifyOne`, `convex/agentReviews.ts`).

### 5. TermiX - Status: No

Evidence: there is no TermiX package dependency or SDK import in the package manifests (`package.json`, `web/package.json`). TermiX appears only in defensive screening/endpoint comments: the discovery screen rejects or flags templated TermiX registrations, and ERC-8183 endpoint selection treats `{agentId}` templates such as `termix.live` as uncallable rather than substituting them (`convex/lib/screen.ts`, `convex/lib/erc8183.ts:selectNegotiationEndpoint`).

How it is used: TermiX is not integrated; Dolphin's "agents hire agents" path is custom A2A plus ERC-8183 plus Altana wallet code (`convex/agentPayments.ts`, `src/wallet/altana-provider.native.tsx:payForAgent`).

### 6. PancakeSwap - Status: Partial

Evidence: Dolphin reads PancakeSwap V3 LP position state for category stats using the V3 Nonfungible Position Manager address `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` (`convex/protocols/pancakeswap.ts`). Rebalancing session policy allowlists the same PancakeSwap V3 Position Manager contract, but session execution is disabled by `FEATURE_SESSION_EXECUTION=false` (`src/wallet/altana-policy.ts:PANCAKE_V3_POSITION_MANAGER`, `FEATURE_SESSION_EXECUTION`). User-facing payment copy says quoted payment tokens may be swapped on PancakeSwap V3, but that is a funding hint, not an in-app swap (`src/wallet/erc8183-policy.ts:fundingHint`).

No evidence of PancakeSwap SDK/router trading: there is no PancakeSwap SDK dependency in `package.json` or `web/package.json`, and no direct swap/router execution path in the Dolphin-owned code. The PancakeSwap integration is read-side LP telemetry and a disabled future action allowlist (`convex/protocols/pancakeswap.ts`, `src/wallet/altana-policy.ts`).

How it is used: PancakeSwap is used for live LP-position evidence and future-scoped authorization design, not for live trading or liquidity modification by Dolphin (`convex/categoryStats.ts:refreshAgentCategoryStats`, `convex/protocols/pancakeswap.ts`).

### 7. Reown / WalletConnect AppKit - Status: Yes

Evidence: the Expo app depends on `@reown/appkit-react-native`, `@reown/appkit-wagmi-react-native`, and `@walletconnect/react-native-compat` (`package.json`). The native wallet provider imports `@walletconnect/react-native-compat` first, constructs `WagmiAdapter`, calls `createAppKit`, sets BSC/BSC testnet networks, and renders `<AppKit />` inside `AppKitProvider` (`src/wallet/wallet-provider.native.tsx`). Wallet detection is configured through iOS schemes and Android manifest package queries (`app.json:ios.infoPlist.LSApplicationQueriesSchemes`, `queries.js`). `EXPO_PUBLIC_REOWN_PROJECT_ID` is required for native AppKit setup (`src/wallet/wallet-provider.native.tsx:projectId`, `MISSING_PROJECT_ID_MESSAGE`; `.env.example`).

Google/social login: AppKit social login is not implemented; `features.socials` is explicitly `false` in the native AppKit configuration (`src/wallet/wallet-provider.native.tsx:createAppKit`). The website does not use Reown AppKit; it uses wagmi `injected()` and `walletConnect()` connectors directly, with `NEXT_PUBLIC_REOWN_PROJECT_ID` only for WalletConnect QR (`web/src/wallet/wallet-provider.tsx`, `web/package.json`, `web/.env.example`).

How it is used: Reown AppKit provides mobile wallet connection/signing; the website uses WalletConnect through wagmi directly rather than AppKit (`src/wallet/wallet-provider.native.tsx`, `web/src/wallet/wallet-provider.tsx`).

### 8. Native Mobile Passkeys - Status: Partial

Evidence: the Expo app depends on `react-native-passkeys` and `@altananetwork/sdk` `0.9.0` (`package.json`). `src/wallet/altana-passkey-native.ts` implements Altana's `PasskeyWebAuthnFns` bridge using `react-native-passkeys`, translating WebAuthn ArrayBuffers to base64url JSON and back, verifying P-256 public-key coordinates, and exposing `nativeWebAuthn` plus `nativePasskeysSupported`. The native Altana provider passes `rpId: ALTANA_RP_ID` and `webAuthn: nativeWebAuthn` into `createPasskeyWallet`, `recoverFromPasskey`, and `signerFromPasskey` paths (`src/wallet/altana-provider.native.tsx:createWallet`, `recoverWallet`, `adminSigner`).

External prerequisites: the native passkey flow requires verified domain association files and matching app entitlements; `src/wallet/altana-rp-id.ts` documents the required `.well-known/apple-app-site-association` and `assetlinks.json`, and `app.json` includes `ios.associatedDomains: ["webcredentials:nnadijoshuac.github.io"]`. The code says Expo Go cannot load the native passkey module and that a development build is required (`src/wallet/altana-passkey-native.ts:PASSKEY_MODULE_MISSING`, `nativePasskeysSupported`).

How it is used: native Face ID/fingerprint passkeys are implemented as an Altana WebAuthn bridge, but the repo itself cannot prove the required hosted association files or a live device ceremony completed (`src/wallet/altana-passkey-native.ts`, `src/wallet/altana-rp-id.ts`, `app.json`).

### 9. Other BNB Chain-Specific Tooling - Status: Yes

Evidence: BSC mainnet is the primary runtime chain across the app: `BSC_CHAIN_ID = 56` in frontend constants and backend clients (`src/constants/agents.ts`, `convex/lib/bscClient.ts`), default RPC is `https://bsc-dataseed.bnbchain.org` unless overridden (`src/constants/agents.ts:BSC_RPC_URL`, `convex/lib/bscClient.ts`; `.env.example`, `web/.env.example`), and 8004scan queries set `chain_id=56&is_testnet=false` (`convex/sources/scan8004.ts:fetchAgentPage`). BSC testnet chain 97 exists only in the Altana spike script (`scripts/spike-b-auth.mjs:CHAIN_ID = 97`, `BNB_TESTNET`).

Smart contracts and addresses observed:

| Contract / address | Network | Evidence | Use |
|---|---|---|---|
| ERC-8004 AgentIdentity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | BSC mainnet 56 | `convex/model/agent.ts:ERC8004_IDENTITY_REGISTRY`, `src/constants/agents.ts:ERC8004_REGISTRY_ADDRESSES.identity`, `src/services/chain.ts` | Agent identity, token owner, tokenURI, agent wallet reads |
| ERC-8004 Reputation Registry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | BSC mainnet 56 | `src/services/reputation-registry.ts:REPUTATION_REGISTRY_ADDRESS`, `convex/lib/reputationRegistry.ts` | Publish and attest review feedback |
| Venus Core Pool Comptroller `0xfD36E2c2a6789Db23113685031d7F16329158384` | BSC mainnet 56 | `convex/protocols/venus.ts`, `src/wallet/altana-policy.ts:VENUS_COMPTROLLER` | Health-factor stats and future session allowlist |
| PancakeSwap V3 Position Manager `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | BSC mainnet 56 | `convex/protocols/pancakeswap.ts`, `src/wallet/altana-policy.ts:PANCAKE_V3_POSITION_MANAGER` | LP-position stats and future session allowlist |
| Aave V3 BNB Pool `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | BSC mainnet 56 | `convex/protocols/aave.ts`, `src/wallet/altana-policy.ts:AAVE_V3_POOL` | Aave account/TVL stats and future session allowlist |
| Aave PoolAddressesProvider `0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D` | BSC mainnet 56 | `convex/protocols/aave.ts` | Aave oracle/provider reads |
| ERC-8183 commerce/payment token | BSC mainnet 56, SDK-derived | `src/wallet/altana-provider.native.tsx:erc8183Addresses`, `src/wallet/altana-provider.web.tsx:erc8183Addresses` | Escrow job payment verification and funding; addresses are resolved from Altana SDK, not hardcoded |
| Altana KeyStore / KeyStoreController | BSC mainnet 56, SDK-derived | `src/wallet/altana-provider.native.tsx:ALTANA_NETWORK.keyStore`, `keyStoreController`; same web provider | Wallet recoverability and registration fee reads |
| Identity precompile `0x0000000000000000000000000000000000000004` | BSC testnet 97 | `scripts/spike-b-auth.mjs:IDENTITY_PRECOMPILE` | Harmless Altana session lifecycle spike |

Other referenced-without-working-code items:

- x402 is referenced in docs/comments and as an 8004scan boolean, but there is no active x402 payment rail (`convex/lib/erc8183.ts`, `src/wallet/erc8183-policy.ts`, `package.json`, `web/package.json`).
- Altana session execution is designed and partly implemented, but explicitly not live (`src/wallet/altana-policy.ts:FEATURE_SESSION_EXECUTION`, `web/src/services/authorization.ts`).
- TermiX is handled as a source of templated/unusable endpoints, not integrated (`convex/lib/screen.ts`, `convex/lib/erc8183.ts:selectNegotiationEndpoint`).
- Grid-trading/trading live performance data is explicitly unavailable rather than fabricated (`convex/protocols/unavailable.ts`, `convex/lib/statsCategory.ts`).
- Lista DAO appears in knowledge/data-source text but no Lista protocol reader is wired (`convex/knowledge.json`, `convex/protocols/unavailable.ts`, `convex/protocols/aave.ts` comments).

Overall tech stack: Expo SDK 57 React Native with Expo Router and NativeWind (`package.json`, `app.json`, `AGENTS.md`), Next.js 16 web app (`web/package.json`, `web/README.md`), Convex backend (`convex/schema.ts`, `convex/_generated/api.d.ts`), viem/wagmi for EVM reads/writes (`package.json`, `web/package.json`, `src/services/chain.ts`, `web/src/wallet/wallet-provider.tsx`), Reown AppKit on native only (`src/wallet/wallet-provider.native.tsx`), Altana SDK for Dolphin Wallet/passkeys/ERC-8183 payments (`src/wallet/altana-provider.native.tsx`, `src/wallet/altana-provider.web.tsx`), OpenRouter for the Dolphin brain (`convex/lib/openrouter.ts`), and custom A2A/MCP clients (`convex/lib/erc8183.ts`, `convex/lib/mcpClient.ts`).

## PART 2 - Senior Developer Perspective

### Actual System Architecture

Dolphin is a two-frontend, one-backend system: the Expo app mounts wallet, query, Convex, wallet-session, and Altana wallet providers in one root provider tree (`src/providers/app-providers.tsx`), while the website is a separate Next.js app with its own package manifest and hand-maintained Convex API surface (`web/package.json`, `web/README.md`, `web/src/convex/api.ts`). Convex is the backend and durable store for the marketplace catalog, verification state, hires, reviews, Altana session metadata, paid jobs, and Dolphin brain conversations/tool calls (`convex/schema.ts`).

The code intentionally separates the user's identity wallet from the Dolphin/Altana wallet: Reown/wagmi identity wallets identify the user and sign SIWE/session messages, while Altana passkey wallets hold funds and sign ERC-8183 payments or future session grants (`src/providers/app-providers.tsx`, `src/wallet/wallet-provider.native.tsx`, `web/src/wallet/wallet-provider.tsx`, `src/wallet/altana-provider.native.tsx`). That split is not incidental: the web wallet provider explicitly says the website has no AppKit and the Altana SDK cannot use injected wallet signers in the web path (`web/src/wallet/wallet-provider.tsx`, `web/src/services/authorization.ts`).

The backend follows a source-to-catalog pipeline: 8004scan source data is normalized in one module, discovery queues only callable A2A/MCP candidates, verification probes each candidate, and live records are upserted into `agents` only when user-visible data changes (`convex/sources/scan8004.ts`, `convex/discovery.ts:run`, `convex/verification.ts:scheduleBatch`, `verifyOne`, `applyVerification`). This architecture is a real improvement over static/demo catalogs because listing depends on live endpoint behavior, not just registry presence (`convex/lib/probe.ts`, `convex/lib/mcpClient.ts`, `convex/lib/erc8183.ts:resolveA2AEndpoint`).

### Discovery, Listing, and Hiring End to End

Discovery starts with 8004scan, filtering or falling back over BSC mainnet records with `has_a2a`/`has_mcp`, `created_after`, and protocol checks (`convex/discovery.ts:run`; `convex/sources/scan8004.ts:fetchAgentPage`, `hasCallableProtocol`). It does not persist rejections; it writes compact counters into `discoveryCursor` and queues candidates in `agentVerification` (`convex/discovery.ts:writeCursor`, `enqueueCandidates`). That matches the repo's storage discipline and avoids storing hundreds of thousands of rejection rows (`convex/discovery.ts` header).

Verification fetches each candidate's detail from 8004scan, probes A2A and MCP endpoints, classifies the agent, computes rank, and writes a live `agents` row only after a successful probe (`convex/verification.ts:verifyOne`, `applyVerification`; `convex/lib/probe.ts:probeAgent`). A2A probing reuses the same request/endpoint/quote normalization helpers later used by paid hire code, which reduces the risk that verification says "live" while checkout calls a different URL (`convex/lib/probe.ts`, `convex/lib/erc8183.ts:buildA2ARequest`, `resolveA2AEndpoint`, `normalizeQuote`).

Listing is paginated and index-backed. The frontend uses Convex `usePaginatedQuery` for browsing/searching, not a local full-catalog fetch (`src/hooks/use-agents.ts:useAgentList`; `convex/agents.ts:list`, `search`). Public records are normalized through `toPublicAgent`, which exposes protocol, services, skills, rank, pricing, feedback, reputation, and `x402Supported` while keeping data provenance in live metrics (`convex/lib/publicAgent.ts:toPublicAgent`).

Free/read-only hiring records an authenticated wallet's active hire row after requiring a session token and a resolved price model; it rejects unresolved price and gates any claimed payment job against verified `agentJobs` rows (`convex/agentHires.ts:hireReadOnlyAgent`; `src/hooks/use-hire-read-only-agent.ts`). Paid hiring is a separate ERC-8183 path: quote over A2A, verify quote payee against ERC-8004 agent wallet, read token metadata on-chain, fund via Altana passkey wallet, witness the job on-chain from Convex, then notify the seller (`convex/agentPayments.ts:requestQuote`, `recordJobPayment`, `notifyJobFunded`; `src/wallet/altana-provider.native.tsx:payForAgent`).

### MCP-Copy Feature

The MCP-copy feature is intentionally simple: on mobile, `McpUseButton` takes `agent.services[0]?.endpoint` and copies that endpoint to the clipboard through `expo-clipboard`; on web, `McpUseAction` copies the same endpoint through `navigator.clipboard` with a textarea fallback (`src/components/mcp-connect.tsx:McpUseButton`, `web/src/components/mcp-use-action.tsx:McpUseAction`). It does not generate a Claude Desktop/Cursor JSON config block; it copies the verified endpoint and shows the endpoint inline (`src/components/mcp-connect.tsx`, `web/src/components/mcp-use-action.tsx`).

The trust basis for that endpoint is stronger than raw registry copy: verification stores the endpoint that the probe completed an MCP `initialize` and `tools/list` against, and the MCP client uses `safeFetch`, MCP protocol version `2025-06-18`, and `mcp-session-id` threading (`convex/lib/mcpClient.ts:openMcpSession`, `listMcpTools`; `convex/verification.ts:applyVerification`). The product claim should therefore be "Dolphin verified this server answers and lists tools," not "Dolphin audited tool behavior" (`src/components/mcp-connect.tsx` warning text; `convex/lib/mcpClient.ts:callMcpTool` comments).

### Dolphin Brain / Conversational Agent

The built-in Dolphin brain lives in Convex, not in the frontend. `convex/dolphin.ts` defines the system prompt, consult prompt, conversation creation, message persistence, tool-call records, candidate selection, and the `ask` action (`convex/dolphin.ts:SYSTEM_PROMPT`, `CONSULT_PROMPT`, `createConversation`, `appendTurn`, `recordToolCall`, `ask`). The frontend hooks call Convex actions/queries and subscribe to conversation/tool-call state rather than streaming tokens directly (`src/hooks/use-dolphin-conversation.ts`, `web/src/hooks/use-dolphin-conversation.ts`).

The model layer is OpenRouter. The primary model is `nvidia/nemotron-3-super-120b-a12b:free`, with `dots-studio/dots-3-note-preview:free` as fallback, and the API key is read from `OPENROUTER_API_KEY` on the Convex deployment (`convex/lib/openrouter.ts:DOLPHIN_PRIMARY_MODEL`, `DOLPHIN_FALLBACK_MODELS`, `readApiKey`, `chatCompletion`). The code contains guardrails for rate limits, transient retries, malformed tool-call markup, text-tool-call recovery, and stripping leaked tool-call syntax from prose (`convex/lib/openrouter.ts:chatCompletion`, `recoverTextToolCalls`, `stripToolCallMarkup`, `OpenRouterError`).

Tool orchestration is retrieval plus constrained MCP invocation. Dolphin selects candidate MCP agents from the live catalog, builds a capped read-only tool menu, records tool calls before invocation, calls MCP tools, and synthesizes the final answer with evidence (`convex/dolphin.ts:candidatesFor`, `ask`, `executeToolCalls`; `convex/lib/decisionTools.ts:buildToolMenu`; `convex/lib/mcpClient.ts:callMcpTool`). The model is not allowed to supply arbitrary endpoint/payment data; bindings map safe model function names back to catalog agent endpoints (`convex/lib/decisionTools.ts:ToolBinding`, `buildToolMenu`).

One notable shortcut is the direct Venus telemetry path: for wallet/health-factor questions, Dolphin reads Venus stats itself rather than always routing through marketplace agents (`convex/dolphin.ts:ask`, `convex/protocols/venus.ts:readHealthFactorStats`). That is good for reliability and demo value, but it means some "agent brain" answers are hybrid app telemetry plus MCP agent consultation, not pure agent-to-agent orchestration.

Another fragility is fallback prose. The resilient fallback path contains hardcoded agent recommendations/ranks/claims when the model/tool path fails (`convex/dolphin.ts:buildResilientMarketplaceResponse`). That is useful for graceful degradation but can drift from the live catalog and should be treated as marketing fallback, not verified runtime evidence.

### Payments and Session-Key Permissions

Payments are architected as "relay plus witness." Convex relays A2A quote/notification calls because browsers hit CORS on sellers, but Convex never signs or moves funds (`convex/agentPayments.ts` module header, `requestQuote`, `notifyJobFunded`). The user's Altana passkey wallet funds the ERC-8183 job with `hireErc8183Agent`, then Convex reads `getJob` from the escrow kernel and validates the job before recording it (`src/wallet/altana-provider.native.tsx:payForAgent`; `convex/agentPayments.ts:recordJobPayment`).

The payee check is the most important security property in the payment path. Seller quotes are rejected unless their provider equals the agent's registered ERC-8004 wallet and the quoted chain is BSC mainnet (`convex/lib/erc8183.ts:normalizeQuote`). The Altana provider then cross-checks the quoted escrow and token against SDK-derived ERC-8183 deployment addresses before signing (`src/wallet/altana-provider.native.tsx:payForAgent`; `src/wallet/altana-provider.web.tsx:payForAgent`).

Session-key permissions are designed but not live. Policies define calls/spend/expiry, session grants/revokes are implemented, and Convex records session public keys/allowlists (`src/wallet/altana-policy.ts`, `src/wallet/altana-provider.native.tsx:grantSession`, `convex/agentSessions.ts:recordSessionGrant`). But `FEATURE_SESSION_EXECUTION=false`, the session signing key is not persisted or delivered to agents, and no production path calls `client.execute` through a session (`src/wallet/altana-policy.ts`, `src/wallet/altana-provider.native.tsx:liveSessions`, `scripts/spike-b-auth.mjs`). This is a deliberate fail-closed state, not a completed autonomous-agent spending flow.

### What Is Solid

The source-of-truth boundaries are clean: 8004scan field handling is isolated (`convex/sources/scan8004.ts`), ERC-8004 identity parsing is centralized (`convex/model/agent.ts`), unsafe URL handling is centralized for untrusted endpoints (`convex/lib/safeFetch.ts`), and live protocol reads are one file per protocol (`convex/protocols/venus.ts`, `convex/protocols/pancakeswap.ts`, `convex/protocols/aave.ts`). The code repeatedly refuses to fake values and uses unavailable live metrics where data is not wired (`convex/protocols/unavailable.ts`, `convex/lib/liveMetric.ts`, `src/types/agent.ts`).

The payment witness model is stronger than most hackathon payment demos: client-provided job IDs are not trusted until Convex reads the escrow kernel, and quotes are checked against ERC-8004 agent wallets (`convex/agentPayments.ts:recordJobPayment`, `convex/lib/erc8183.ts:normalizeQuote`). Review publication uses the same witness pattern by reading BSC transaction receipts and decoding calldata before setting `onChainTxHash` (`convex/agentReviews.ts:attestReviewOnChain`).

The brain has real tool orchestration rather than a chat-only wrapper: it opens MCP sessions, reads schemas, filters mutating tools, records tool calls, and synthesizes evidence (`convex/lib/decisionTools.ts`, `convex/lib/mcpClient.ts`, `convex/dolphin.ts`). The code also acknowledges free-model reliability problems and implements recovery/stripping for malformed tool calls (`convex/lib/openrouter.ts`).

### What Is Fragile or Incomplete

The x402 sponsor claim should not be made as an implementation claim. Current payment code is ERC-8183, and x402 is only a flag/commented future rail (`convex/lib/erc8183.ts`, `src/wallet/erc8183-policy.ts`, `package.json`, `web/package.json`).

The paid hire path is implemented but operationally demanding: it requires a funded Altana Dolphin Wallet, a seller that returns a valid quote, the quoted token balance, and a live ERC-8183 job witness (`src/wallet/altana-provider.native.tsx:payForAgent`, `convex/agentPayments.ts:requestQuote`, `recordJobPayment`). Scripts/docs indicate testnet lifecycle support exists, but a universal end-to-end mainnet paid hire is not proven by a local test suite (`scripts/spike-b-auth.mjs`, `scripts/verify-web-payment.mjs`, `src/wallet/erc8183-policy.ts`).

`convex/agentPayments.ts:sendA2A` uses bare `fetch` to publisher-controlled endpoints on the payment relay path, while `resolveA2AEndpoint` and MCP/probe paths use `safeFetch` (`convex/agentPayments.ts:sendA2A`; `convex/lib/erc8183.ts:resolveA2AEndpoint`; `convex/lib/mcpClient.ts:mcpCall`; `convex/lib/probe.ts`). That is a concrete SSRF/redirect-hardening gap relative to the repo's own safety rule for stranger-chosen URLs.

Session execution is deliberately off, so "agents transact on-chain with delegated user permissions" is a roadmap/design claim, not a current product claim (`src/wallet/altana-policy.ts:FEATURE_SESSION_EXECUTION`, `web/src/services/authorization.ts`). The current code can create/pay from Dolphin Wallet and record grants, but it does not deliver a usable session to an autonomous agent runtime (`src/wallet/altana-provider.native.tsx:grantSession`, `liveSessions`; `convex/agentSessions.ts`).

The model backend relies on OpenRouter free models, and the code itself documents production unsuitability/rate-limit risk (`convex/lib/openrouter.ts` header, `OpenRouterError`). Fallback text contains hardcoded product recommendations, which is a drift risk if catalog ranks or live agent status change (`convex/dolphin.ts:buildResilientMarketplaceResponse`).

There is duplication between Expo and web providers/policies, some of it deliberate but high-maintenance: Altana policy is hand-mirrored, web Convex API annotations are hand-maintained, and SDK versions differ between root `0.9.0` and web `0.8.0` (`src/wallet/altana-policy.ts`, `web/src/wallet/altana-policy.ts`, `web/README.md`, `package.json`, `web/package.json`).

## PART 3 - Investor Perspective

### What Problem This Solves and For Whom

Dolphin solves discovery, trust, and activation for on-chain AI agents on BNB Chain: users can browse verified live agents, inspect protocol/category evidence, copy MCP endpoints into external AI clients, hire free/read-only agents, pay payable agents through ERC-8183 escrow, and ask Dolphin's own conversational agent to consult marketplace agents (`convex/agents.ts`, `src/hooks/use-agents.ts`, `src/components/mcp-connect.tsx`, `convex/agentHires.ts`, `convex/agentPayments.ts`, `convex/dolphin.ts`).

The primary users are DeFi users and agent builders in the BNB ecosystem. DeFi users need a way to find agents that actually answer and do not fabricate metrics; builders need a marketplace that indexes ERC-8004 identity, validates endpoints, and gives agents a distribution/payment surface (`convex/discovery.ts`, `convex/verification.ts`, `convex/protocols/venus.ts`, `convex/protocols/pancakeswap.ts`, `convex/protocols/aave.ts`, `convex/agentPayments.ts`).

### Why This Wedge Is Compelling Now

The code demonstrates an important thesis: agent marketplaces need more than a registry. The registry can contain hundreds of thousands of low-quality or uncallable entries, so Dolphin builds a live verification and filtering layer on top of 8004scan/ERC-8004 (`convex/sources/scan8004.ts` measured counts/comments; `convex/discovery.ts`; `convex/verification.ts`). That is a plausible wedge because the value is not "another list"; it is "a list of agents that Dolphin actually called and normalized."

The built-in Dolphin brain is strategically interesting because it turns the marketplace into an orchestration surface: instead of asking users to know which agent to hire, Dolphin can retrieve candidate agents, open MCP sessions, call their tools, and synthesize evidence (`convex/dolphin.ts:ask`, `convex/lib/decisionTools.ts:buildToolMenu`, `convex/lib/mcpClient.ts:callMcpTool`). That points toward an "agent router" product, not just a directory.

The payment design is also a meaningful wedge: ERC-8183 escrow jobs and ERC-8004 wallet checks create an auditable path from quote to funded work (`convex/lib/erc8183.ts:normalizeQuote`, `convex/agentPayments.ts:recordJobPayment`, `src/wallet/altana-provider.native.tsx:payForAgent`). If more agents adopt seller-compatible rails, Dolphin could become a credible checkout/orchestration layer.

### What Is Working/Demoable Today vs. Aspirational

Working/demoable today: live BSC/8004scan discovery; endpoint verification; paginated catalog/search; MCP endpoint copy; MCP tool consultation by Dolphin's brain; BSC protocol reads for Venus, PancakeSwap V3 LP positions, and Aave TVL/account data; SIWE-like wallet sessions; ERC-8004 review publishing/attestation; Altana passkey wallet creation/recovery code; ERC-8183 quote/payment/witness code paths (`convex/discovery.ts`, `convex/verification.ts`, `src/components/mcp-connect.tsx`, `convex/dolphin.ts`, `convex/protocols/*`, `convex/walletAuth.ts`, `convex/agentReviews.ts`, `src/wallet/altana-provider.native.tsx`, `convex/agentPayments.ts`).

Aspirational or gated: x402 API payments, TermiX integration, AppKit Google social login, live delegated session execution by third-party agents, PancakeSwap trading/liquidity execution, Lista DAO reads, Copy Trade/Four.meme/Token Radar/Wallet Tracker composable skills, and full autonomous agent-to-agent spending using user-scoped sessions (`convex/lib/erc8183.ts`, `src/wallet/altana-policy.ts:FEATURE_SESSION_EXECUTION`, `src/wallet/wallet-provider.native.tsx:features.socials`, `convex/protocols/unavailable.ts`, `convex/knowledge.json`).

### Differentiation vs. Other Agent Marketplaces, Including TermiX

The clearest differentiation is evidence quality. Dolphin does not just mirror registrations; it probes A2A/MCP endpoints, stores a live/degraded/unavailable status, delists after repeated failures, and avoids storing rejection spam (`convex/verification.ts:verifyOne`, `applyVerification`, `FAILURES_BEFORE_DELIST`; `convex/discovery.ts`). That is a defensible operational layer if maintained.

Against TermiX specifically, the repo does not integrate TermiX; instead it treats TermiX templated registrations as uncallable inputs and builds its own A2A/ERC-8183/MCP flow (`convex/lib/screen.ts`, `convex/lib/erc8183.ts:selectNegotiationEndpoint`, `convex/agentPayments.ts`). This is differentiated in architecture, but it also means Dolphin does not get any TermiX network effects or sponsor-specific functionality.

The Dolphin brain is the biggest long-term differentiator. A marketplace with a conversational orchestrator can become a meta-agent that finds, evaluates, and calls specialist agents on behalf of users (`convex/dolphin.ts`, `convex/lib/decisionTools.ts`, `convex/lib/mcpClient.ts`). If executed with paid tool calls and agent reputation loops, this is stronger than a static marketplace UI.

The defensibility is currently technical/product execution, not protocol ownership. Dolphin relies on external registries, external marketplace agents, OpenRouter models, Convex, Reown, and Altana (`convex/sources/scan8004.ts`, `convex/lib/openrouter.ts`, `src/wallet/wallet-provider.native.tsx`, `src/wallet/altana-provider.native.tsx`). The moat would need to come from verified data, routing quality, payment/reputation history, and user workflows rather than exclusive infrastructure.

### What I Would Want to See Before Writing a Check

First, prove the paid loop in a reproducible demo: quote, fund ERC-8183 escrow, seller accepts, deliverable observed, hire row linked, and review optionally published on ERC-8004 (`convex/agentPayments.ts`, `src/wallet/altana-provider.native.tsx:payForAgent`, `convex/agentHires.ts:hireReadOnlyAgent`, `convex/agentReviews.ts:attestReviewOnChain`). The code has the pieces, but an investor would want a deterministic smoke test or recorded on-chain transaction set.

Second, harden the relay surface by routing all publisher-controlled payment-path fetches through `safeFetch`, matching the probe/MCP path (`convex/agentPayments.ts:sendA2A`, `convex/lib/safeFetch.ts`, `convex/lib/mcpClient.ts:mcpCall`). This is a security diligence item because agent endpoints are attacker-controlled.

Third, replace hardcoded Dolphin brain fallback recommendations with catalog-derived fallbacks and add prompt-answer caching if the `promptHash` index is intended to reduce OpenRouter free-tier pressure (`convex/dolphin.ts:buildResilientMarketplaceResponse`, `convex/schema.ts:dolphinMessages`, `convex/lib/openrouter.ts` rate-limit comments). The current fallback is useful for demo continuity but risky as product truth.

Fourth, decide whether the Altana delegated-session story is a demo goal or a roadmap item. If it is a demo goal, wire one narrow end-to-end session execution path with a real agent runtime and revocation proof; if it is roadmap, keep the UI copy strict and do not imply live autonomous delegated spending (`src/wallet/altana-policy.ts:FEATURE_SESSION_EXECUTION`, `scripts/spike-b-auth.mjs`, `convex/agentSessions.ts`).

Fifth, improve sponsor alignment where it matters for the hackathon: either implement a real x402 rail when a seller exists, or frame ERC-8183 honestly and avoid claiming x402; either integrate TermiX explicitly, or position Dolphin as the independent verification/orchestration layer (`convex/lib/erc8183.ts`, `package.json`, `convex/lib/screen.ts`).

Bottom line: Dolphin is more substantial than a typical hackathon marketplace because it has a real discovery pipeline, live endpoint probes, on-chain identity/reputation checks, MCP orchestration, and an ERC-8183 payment witness model. The gaps are also clear in code: x402 is not implemented, session execution is off, TermiX is not integrated, some category metrics are unavailable, and the AI brain uses free-model infrastructure with fallback shortcuts. As a judge, I would credit the real BNB/8004scan/Altana/Reown/MCP work; as an investor, I would ask for payment/session proof, security hardening, and product focus before treating it as production-ready.
