// ─────────────────────────────────────────────────────────
// FUTURE WORK — NOT LIVE IN THIS BUILD
// This implements the delegated-portfolio-management permission layer:
// spend caps, protocol allowlist, session duration. The permission
// plumbing is complete, but no execution path exists yet — a granted
// session's signing key is never delivered to an agent and never used
// by this app (see altana-storage.ts for why it's intentionally not
// persisted). Do not wire this to UI until key-custody and an
// agent-side execution runtime are designed.
// ─────────────────────────────────────────────────────────

import type { Address } from "viem";

import type { AgentCategory } from "@/types/agent";

/**
 * Dolphin's Altana wallet policy: which chain, which signer type, and which
 * agents are honestly entitled to a spend-capable session.
 *
 * MIRRORED BY HAND in src/wallet/altana-policy.ts (the Expo app). The two
 * products deliberately share no node_modules and no code (see HANDOVER.md's
 * "one repo, two products"), so this file has a twin that must be edited in
 * the same change — the same manual-sync rule AGENTS.md §9 already applies to
 * LiveMetric and the category stat validators. If you change a decision here,
 * change it there and say so in the commit.
 */

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-30): an Altana wallet is a SECOND wallet, not an upgrade.
 * ---------------------------------------------------------------------------
 * @altananetwork/sdk 0.8.0 ships exactly two usable signer families:
 * private-key and browser-WebAuthn passkey. `signerFromInjected` appears only
 * in the package's own doc comments — it is never implemented and never
 * exported (verified by grepping dist/ this session, not assumed from the
 * changelog). So there is no way to grant an Altana session against a wallet
 * the user already connected through MetaMask or WalletConnect.
 *
 * That is not a limitation to route around; it is a fact the UI has to state.
 * A Dolphin wallet is separately provisioned, holds its own funds, and shares
 * no balance with the user's browser-extension wallet. Any copy that lets
 * those two blur is a real, money-shaped misunderstanding for someone to have,
 * so the wallet screen says so in as many words rather than in a footnote.
 *
 * The existing wagmi/Reown connect flow is untouched and still does what it
 * always did: it identifies the user for hire records. The two coexist.
 */

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-30): passkey, not a private key, for a person's wallet.
 * ---------------------------------------------------------------------------
 * Altana never persists key material and cannot hand a generated private key
 * back after the fact. For a private-key wallet, that makes *this app* solely
 * responsible for generating, storing and never losing the key, with no
 * recovery path if it is lost — a custody obligation a marketplace has no
 * business taking on, and one that would be dishonest to describe as
 * "non-custodial" in the UI.
 *
 * A passkey puts the key in the device's platform secure storage (Secure
 * Enclave / TPM), gates every signature behind a biometric, and inherits the
 * platform's own sync and recovery story. `recoverFromPasskey` then rebuilds
 * the wallet from the passkey alone — two eth_calls and one biometric prompt,
 * no seed phrase for a user to lose.
 *
 * Private-key signers stay the right tool for something operational (a
 * server-side agent wallet, if this project ever grows one) and are what
 * scripts/spike-b-auth.mjs uses. They are not offered to a person here.
 *
 * TO REVERSE THIS: this constant is the single switch. Note that reversing it
 * means answering the storage question above first — the SDK will not answer
 * it for you.
 */
export const ALTANA_SIGNER_STRATEGY = "passkey" as const;

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-31): session grants are OFF in shipped builds.
 * ---------------------------------------------------------------------------
 * Everything below this flag - CATEGORY_SESSION_POLICY, the allowlists, the
 * spend caps, buildSessionPermissions - is correct, reviewed, and complete as a
 * PERMISSION layer. What does not exist is anything that could USE a granted
 * session:
 *
 *   - the session's signing key is held in memory for the life of one tab and
 *     deliberately never persisted (altana-storage.ts explains why);
 *   - it is never transmitted to the agent - only the PUBLIC key reaches
 *     Convex, which is all revocation needs;
 *   - no code path in either product executes with one. The only `execute`
 *     calls in this repo are registerWallet's empty admin intent and
 *     scripts/spike-b-auth.mjs, a standalone testnet probe.
 *
 * So granting one spends real BNB in gas to create an on-chain permission that
 * no party is able to exercise, and the UI around it implied a capability the
 * product does not have. Until a key-custody model and an agent-side execution
 * runtime exist, offering it is a promise Dolphin cannot keep.
 *
 * THIS FLAG IS THE SINGLE SWITCH. Flip it to `true` and the session UI returns
 * on both products; nothing else needs changing. The logic is preserved
 * intentionally - it is real design work for the delegated-management model,
 * not dead code to be deleted.
 *
 * MIRRORED BY HAND in src/wallet/altana-policy.ts. Both must agree, or one
 * product will offer a session the other hides.
 */
// Annotated `boolean` rather than left to infer the literal `false`, so
// TypeScript does not narrow every guarded branch to unreachable code and
// start reporting the preserved UI as dead. The value is the switch; the type
// keeps the gated code type-checked and reviewable.
export const FEATURE_SESSION_EXECUTION: boolean = false;

/**
 * Label shown in the OS passkey prompt ("Save a passkey for Dolphin?").
 * Also the WebAuthn user-visible name, so it is a product name, not an id.
 */
export const ALTANA_WALLET_LABEL = "Dolphin";

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-30): BSC mainnet (56), chosen explicitly by the owner.
 * ---------------------------------------------------------------------------
 * The alternative was BSC testnet (97), where Altana runs a full standalone
 * stack (keystore + account + relay) and a faucet makes an on-chain
 * enforcement proof free. Both were put to the project owner with their
 * trade-offs; mainnet was chosen so the wallet sits on the same chain as
 * everything else Dolphin reads — discovery, ERC-8004 identity and every
 * category's live stats are all BSC mainnet, and a wallet on a different chain
 * would need explaining away in a demo.
 *
 * The cost is real and is recorded rather than hidden: a session grant on
 * mainnet costs real BNB, so the live grant → in-bounds → out-of-bounds →
 * revoke lifecycle was NOT run this session. On-chain enforcement is built to
 * the documented API and asserted by Altana's docs; it is not observed here.
 * scripts/spike-b-auth.mjs produces that proof against chain 97 the moment an
 * address is funded, and BNB_TESTNET is a one-line change below.
 */
/**
 * Deliberately plain data, NOT the SDK's `BNB` NetworkConfig object.
 *
 * ORIGINALLY this was about bundle size: the native Expo target could not use
 * the Altana SDK at all, and importing `BNB` here — a runtime import from a
 * barrel root — dragged the whole SDK, porto and ox included, into the Android
 * bundle to reach one chain id. That was measured, not assumed: with `BNB`
 * imported here, `expo export --platform android` shipped createPasskeyWallet
 * and the Altana relay URL to a platform that could never call them.
 *
 * THAT REASON EXPIRED at @altananetwork/sdk 0.9.0, which added the `webAuthn`
 * option that lets a native build hold a real passkey wallet. The SDK is now a
 * genuine native dependency, so keeping it out of that bundle is no longer a
 * goal and finding it there is no longer a regression.
 *
 * The rule survives on a better reason. This file is the one place that says
 * what Dolphin is willing to authorize, it is hand-mirrored across two products
 * that share no node_modules, and one of those products may sit on a different
 * SDK version than the other at any moment. A plain integer means the same
 * thing in both regardless; an imported config object silently would not.
 *
 * The providers that use the SDK import its `BNB` config themselves and assert
 * it agrees with the id below, so the two cannot silently diverge.
 */
export const ALTANA_CHAIN_ID = 56;

/** Human-facing network name. Rendered wherever a balance or address is shown. */
export const ALTANA_NETWORK_LABEL = "BNB Smart Chain";

/**
 * Where a user sends funds to make this wallet usable. The wallet address is
 * counterfactual until funded — verified this session: createWallet returns an
 * address with no transaction and balances reads it as 0.
 */
export const ALTANA_FUNDING_HINT =
  `Send BNB to this address on ${ALTANA_NETWORK_LABEL} (chain ${ALTANA_CHAIN_ID}) from an exchange ` +
  `or another wallet. Until it is funded the wallet exists but can do nothing — it holds no ` +
  `balance and cannot pay for a transaction.`;

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-31): recoverability is READ per wallet, never assumed —
 * and registration is offered, never forced.
 * ---------------------------------------------------------------------------
 * Session 6 found that a Dolphin Wallet cannot be recovered on a new device
 * until it has executed at least one on-chain transaction, because Altana only
 * writes a wallet's admin key into its on-chain KeyStore on that first action.
 * It logged the finding in a handover file and shipped a fixed sentence on the
 * wallet screen. That sentence is the same for every wallet, which means it is
 * wrong for half of them: it under-warns a fresh wallet whose funds really are
 * at risk, and over-warns a used wallet that is genuinely safe.
 *
 * THE CHECK. `recoverFromPasskey` reads `getKeys(wallet)` from KeyStore, and
 * the SDK states the rule outright: "Empty array = not yet registered". So
 * recoverability is not a thing to hedge about — it is one `eth_call`, exact,
 * and different per wallet. Both wallet screens now read it live and say what
 * is actually true of the wallet in front of the user.
 *
 * WHY NOT JUST REGISTER AUTOMATICALLY AT CREATION. Registration costs a real
 * fee, paid by the wallet as msg.value, plus relay gas. Measured live on BSC
 * mainnet at ~0.00073 BNB — and it MOVED between two reads minutes apart
 * (728732271782491 then 727666842218717 wei), so it is oracle-priced and must
 * be read at the moment of asking rather than cached or written down here.
 *
 * That cost lands on a wallet that, by the design Session 6 chose and both
 * screens advertise, is free to create and holds nothing until its owner
 * decides to fund it. A brand-new wallet therefore CANNOT pay to register even
 * if Dolphin wanted it to. Registering silently on first funding would also
 * mean spending someone's money without asking, which is the one thing every
 * spend-shaped action in this project has refused to do (session grants,
 * ERC-8183 payments).
 *
 * SO: tell the truth always, and offer the fix as a choice. A funded but
 * unregistered wallet gets an explicit, priced action with the live fee shown
 * before anything is signed. An unfunded one is told what it needs first.
 *
 * WORTH KNOWING, because it makes the action less necessary than it looks:
 * the SDK registers the admin key automatically on the wallet's first
 * admin-signed intent of ANY kind — `internal/relay.js`'s `submitCalls` calls
 * it "the universal choke point for every userOp leaving the SDK" and prepends
 * the registration there. So granting a session or paying an agent already
 * fixes this as a side effect. The explicit action exists for the person who
 * wants to secure the wallet BEFORE doing either.
 *
 * TO REVERSE: delete the registration action and the two constants below; the
 * live read is independent of it and should stay regardless, because a screen
 * that cannot say whether your funds are reachable is worse than one that can.
 */

/**
 * The KeyStore's `getKeys(user)` — the single call recoverability turns on.
 *
 * Declared here rather than imported because the SDK does not export its
 * `readActiveKeys` helper (it lives in `internal/`), and this module must stay
 * free of SDK imports so the native Expo bundle never carries it — the same
 * constraint documented beside ALTANA_CHAIN_ID. The KeyStore ADDRESS is not
 * written here: each provider takes it from the SDK's own NetworkConfig, so
 * there is still no hand-typed contract address anywhere in this flow.
 */
export const KEYSTORE_GET_KEYS_ABI = [
  {
    name: "getKeys",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
] as const;

/** `KeyStoreController.getRegistrationFeeInWei()` — oracle-priced, read live. */
export const KEYSTORE_REGISTRATION_FEE_ABI = [
  {
    name: "getRegistrationFeeInWei",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * What a user is told about their own wallet's recoverability. Deliberately
 * three states and not two: "we have not checked" must never render as "no".
 */
export type RecoverabilityState = "unknown" | "registered" | "unregistered";

export function recoverabilityCopy(state: RecoverabilityState): {
  title: string;
  body: string;
} {
  switch (state) {
    case "registered":
      return {
        title: "Recoverable on another device",
        body:
          "This wallet's key is registered in Altana's on-chain KeyStore, so your " +
          "passkey can rebuild it on a new device or after clearing this browser. " +
          "Read live from the chain just now, not assumed.",
      };
    case "unregistered":
      return {
        title: "Not recoverable yet — read this before you clear this browser",
        body:
          "This wallet has never transacted, so its key is not yet in Altana's " +
          "on-chain KeyStore and there is nothing for a passkey to recover from. " +
          "If you clear this browser or move to another device now, you will lose " +
          "access to it. Its first on-chain action fixes this automatically.",
      };
    default:
      return {
        title: "Recoverability not checked",
        body:
          "Dolphin has not been able to read this wallet's KeyStore entry, so it " +
          "will not tell you either way. Refresh to try again.",
      };
  }
}

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-30): which agents may be granted a spend-capable session.
 * ---------------------------------------------------------------------------
 * Not every agent should get one. Granting spend authority to an agent that
 * only delivers information implies a capability it does not have — the same
 * class of dishonesty as printing a fabricated APY, and ruled out by the same
 * rule (AGENTS.md §5). So the default is NO session, and a category has to
 * earn one.
 *
 * A category earns one when BOTH hold:
 *
 *   1. Acting is the point. A health-factor agent that cannot repay, or a
 *      rebalancer that cannot move a position, is not doing the job its
 *      category names — it is describing the job.
 *   2. Dolphin can name a *concrete, already-verified* contract to allow. Every
 *      address in the allowlists below is one this repo had already verified
 *      independently against the protocol's own deployments file and
 *      cross-checked on BscScan, for its live-stats reads (AGENTS.md §9). This
 *      session writes NO new contract address — deliberately, because an
 *      allowlist is the one place a wrong address turns into real authority
 *      over real money.
 *
 * Consequence worth stating plainly, because it looks like a bug and is not:
 * these allowlists are narrower than a full strategy would need. A rebalance
 * that also has to touch a router or an ERC-20 approval will be REJECTED at
 * validation time. That is the guardrail doing its job. Widening it means
 * verifying each additional address to the same standard first — not relaxing
 * the gate because an agent asked.
 */

/**
 * One allowed target, carrying the provenance of its address so the UI can
 * show a user what they are actually authorizing rather than a bare hex string.
 */
export type AllowedContract = Readonly<{
  address: Address;
  /** What the user is told this contract is. */
  label: string;
  /** Where the address came from, quoted from the module that verified it. */
  provenance: string;
}>;

export type CategorySessionPolicy = Readonly<
  | {
      kind: "read-only";
      /** Why this category is honestly served by a record and not a session. */
      reason: string;
    }
  | {
      kind: "scoped-session";
      /** Why acting, rather than reporting, is this category's job. */
      reason: string;
      /** Never empty. An empty allowlist would mean an unrestricted session. */
      allowlist: readonly AllowedContract[];
    }
>;

const VENUS_COMPTROLLER: AllowedContract = {
  address: "0xfD36E2c2a6789Db23113685031d7F16329158384",
  label: "Venus Core Pool Comptroller",
  provenance:
    "VenusProtocol/venus-protocol deployments/bscmainnet.json (\"Unitroller\"), " +
    "cross-checked as BscScan's labeled \"Venus: Core Pool Comptroller\".",
};

const PANCAKE_V3_POSITION_MANAGER: AllowedContract = {
  address: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  label: "PancakeSwap V3 Position Manager",
  provenance:
    "pancakeswap/pancake-v3-contracts deployments/bscMainnet.json, cross-checked " +
    "as BscScan's labeled \"PancakeSwap: Nonfungible Position Manager V3\".",
};

const AAVE_V3_POOL: AllowedContract = {
  address: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
  label: "Aave V3 BNB Pool",
  provenance:
    "bgd-labs/aave-address-book src/AaveV3BNB.sol — the repo Aave's own docs " +
    "point integrators to for per-chain addresses.",
};

export const CATEGORY_SESSION_POLICY: Readonly<
  Record<AgentCategory, CategorySessionPolicy>
> = {
  "health-factor": {
    kind: "scoped-session",
    reason:
      "A health-factor agent's entire value is acting before a liquidation, not " +
      "reporting that one is coming. Without authority to repay it can only warn.",
    allowlist: [VENUS_COMPTROLLER],
  },

  rebalancing: {
    kind: "scoped-session",
    reason:
      "Rebalancing an LP position means moving it. An agent that cannot call the " +
      "position manager is describing a rebalance rather than performing one.",
    allowlist: [PANCAKE_V3_POSITION_MANAGER],
  },

  yield: {
    kind: "scoped-session",
    reason:
      "Moving capital to the best-earning venue is the job. Reporting where the " +
      "yield is, without being able to move to it, is a different product.",
    allowlist: [AAVE_V3_POOL],
  },

  "grid-trading": {
    kind: "read-only",
    reason:
      "Grid trading would need spend authority in principle — but Dolphin has no " +
      "wired data source for this category at all (convex/protocols/unavailable.ts) " +
      "and has verified no DEX router address for it. Granting spend authority into " +
      "a blind spot, where Dolphin can neither name a verified contract nor observe " +
      "a single live metric afterwards, is worse than granting none. Read-only until " +
      "a real data source and a verified venue address exist.",
  },

  monitoring: {
    kind: "read-only",
    reason:
      "Monitoring is information delivery by definition. A spend-capable session " +
      "would imply a capability the agent does not have and does not want.",
  },

  trading: {
    kind: "read-only",
    reason:
      "Trading passes the first test and fails the second, which is exactly the " +
      "case this policy was written to catch. Acting IS the point — a trader that " +
      "cannot place the trade is publishing an opinion. But Dolphin has verified " +
      "no DEX router address for it and has no wired data source for the category " +
      "(convex/protocols/unavailable.ts), so it could neither name the contract a " +
      "user would be authorizing nor observe a single trade afterwards. Of every " +
      "category here this is the one where an unrestricted session would do the " +
      "most damage fastest, so it stays read-only until a verified venue address " +
      "and a real record source exist.",
  },
};

export function sessionPolicyFor(category: AgentCategory): CategorySessionPolicy {
  return CATEGORY_SESSION_POLICY[category];
}

/* ---------------------------------------------------------------------------
 * Spend caps and expiry.
 * ---------------------------------------------------------------------------
 * The cap is denominated in native BNB (wei) with a rolling period, matching
 * Altana's SpendPermission shape. Defaults are deliberately small: this is
 * mainnet, the wallet starts empty, and a cap the user did not think about
 * should be one they would not mind losing. The hire flow shows the chosen cap
 * in BNB before anything is signed and lets the user change it.
 */
// BigInt(...) rather than an `n` literal: web/tsconfig.json targets ES2017
// (Next's scaffold default) and TS rejects BigInt literals below ES2020.
// Retargeting the build to satisfy a constant would be a much larger change
// than the constant is worth.
const WEI_PER_BNB = BigInt("1000000000000000000");

export const SPEND_CAP_CHOICES_WEI = [
  { label: "0.01 BNB / day", wei: BigInt("10000000000000000") },
  { label: "0.05 BNB / day", wei: BigInt("50000000000000000") },
  { label: "0.1 BNB / day", wei: BigInt("100000000000000000") },
] as const;

export const DEFAULT_SPEND_CAP_WEI = SPEND_CAP_CHOICES_WEI[0].wei;

/** Rolling window Altana enforces the cap over. */
export const SPEND_CAP_PERIOD = "day" as const;

export const SESSION_DURATION_CHOICES_DAYS = [7, 30, 90] as const;
export const DEFAULT_SESSION_DURATION_DAYS = 30;

export function expiryFromNow(durationDays: number): number {
  return Math.floor(Date.now() / 1_000) + durationDays * 24 * 60 * 60;
}

/**
 * Builds the permissions object handed to grantSession.
 *
 * `calls` is ALWAYS populated. Altana's docs are explicit that omitting it
 * means "any contract, within the spend cap" — an unrestricted allowlist. This
 * function makes that unreachable by construction: it takes a policy that can
 * only be `scoped-session` (whose `allowlist` is non-empty by type) and throws
 * rather than emit a permissions object without `calls`.
 */
export function buildSessionPermissions(
  policy: CategorySessionPolicy,
  spendCapWei: bigint,
) {
  if (policy.kind !== "scoped-session") {
    throw new Error(
      "buildSessionPermissions: refusing to build permissions for a read-only " +
        "category. See CATEGORY_SESSION_POLICY for why this category has no session.",
    );
  }

  if (policy.allowlist.length === 0) {
    throw new Error(
      "buildSessionPermissions: empty allowlist would grant an unrestricted " +
        "session (Altana treats an omitted `calls` as all-targets-allowed).",
    );
  }

  return {
    calls: policy.allowlist.map((contract) => ({ to: contract.address })),
    spend: [{ limit: spendCapWei, period: SPEND_CAP_PERIOD }],
  } as const;
}

/** 0.01 BNB → "0.01". Display only; never used for a cap comparison. */
export function formatBnb(wei: bigint, maxDecimals = 6): string {
  const whole = wei / WEI_PER_BNB;
  const fraction = wei % WEI_PER_BNB;
  if (fraction === BigInt(0)) return whole.toString();
  const padded = fraction.toString().padStart(18, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return padded.length === 0 ? whole.toString() : `${whole}.${padded}`;
}
