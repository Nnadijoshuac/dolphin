# Session log — 2026-08-31 (session 8): cross-device wallet recovery

Every command in this log was run live against BSC mainnet and the real
`@altananetwork/sdk@0.8.0` source. Nothing is quoted from a doc without a
matching observation beside it.

---

## TASK 0 — INVESTIGATION

### 0.1 The gap, reconfirmed on-chain — no browser needed

Session 6 found recovery fails for an unused wallet and quoted the SDK's error.
That error names the cause: *"this wallet was created but never executed a
transaction, so its admin key isn't on-chain yet."*

That claim is directly checkable, and this session checked it rather than
re-running the browser flow to watch the same error again. The SDK's own
recovery path (`recoverFromPasskey.d.ts` step 3) reads `getKeys(wallet)` from
KeyStore, and `internal/keystore.d.ts` states the rule outright:

```
/** Reads the active key ids for a user. Empty array = not yet registered. */
export declare function readActiveKeys(...): Promise<readonly Hex[]>;
```

So `getKeys(wallet).length > 0` **is** recoverability. One `eth_call`. Read
live against BSC mainnet for all three wallets Session 6 actually created:

```
KeyStore   0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a  (8756 bytes of code)

session6 WEBSITE wallet   0xfE16aBCc199bB3F9935aa7B6b6466341833130C3
   keys registered: 0  ->  NOT RECOVERABLE      balance 0 BNB
session6 MOBILE  wallet   0xfb0b95a5C1c4Af1Aa7883AFAB543502028ad22ef
   keys registered: 0  ->  NOT RECOVERABLE      balance 0 BNB
session6 recovery-failed   0xd5a593b83b66cc4cfe1adf0c7082e0a1cb272bba
   keys registered: 0  ->  NOT RECOVERABLE      balance 0 BNB
```

**The gap is real, still open, and every Dolphin Wallet this project has ever
created is on the wrong side of it.**

### 0.2 The other side of the proof does not exist yet — and that is the finding

Task 0.3 asks for a wallet that *has* transacted, to confirm recovery succeeds
for it. **There is no such wallet in this project.** Session 6 chose not to
fund a grant; Session 7 chose not to fund a payment. So no Dolphin Wallet has
ever executed anything, and **the "recoverable" state has never once existed
here.**

Worth stating plainly rather than working around: the positive case cannot be
demonstrated without spending real money, for the same reason it could not be
in either previous session.

Nor is there a third-party wallet to borrow as evidence. Scanning BSC mainnet
for KeyStore or Controller activity found **no logs at all in the last ~120,000
blocks (~4 days)** on either contract. Both are deployed and answer reads; the
mainnet KeyStore is simply not busy.

### 0.3 Is there a cheap registration path? Yes — and it is already automatic

`internal/relay.js`'s `submitCalls` is, in its own words, *"the universal choke
point for every userOp leaving the SDK"*:

```js
const isAdmin = opts.submittingKey.role === "admin";
let effectiveCalls = calls;
if (isAdmin) {
    const prepend = await buildFirstActionPrepend({ ... });
    if (prepend.length > 0) effectiveCalls = [...prepend, ...calls];
}
```

Three consequences, all load-bearing:

1. **Any admin-signed action registers the key** — `execute`, `grantSession`,
   `revokeSession`, and therefore Session 7's ERC-8183 payment too. Nobody has
   to remember to do it.
2. **A session-signed action does not**, and cannot: only an admin may register
   the admin key. The comment notes a session cannot exist without a prior
   admin action anyway.
3. **`calls` is not required to be non-empty.** With `calls: []` the intent
   becomes exactly `[registerCall]`. So a *deliberate, minimal, do-nothing*
   registration is expressible with the SDK as it ships — no new contract call,
   no unsupported path.

### 0.4 What registration actually costs — read live, and it moves

Registration is not free. `KeyStoreController.getRegistrationFeeInWei()`, read
twice a few minutes apart on BSC mainnet:

```
read 1   728732271782491 wei   = 0.000728732271782491 BNB
read 2   727666842218717 wei   = 0.000727666842218717 BNB
```

**The fee is dynamic.** It moved between two reads minutes apart, which means
it is almost certainly pegged to a fiat amount through an oracle. That settles
how the UI must treat it: read live at the moment of asking, never cached and
never written into the source — the same ground rule Session 7 applied to agent
prices, arrived at independently here.

On top of the fee the wallet pays relay gas for the intent, in the native token
by default (`ExecuteOptions.feeToken` defaults to the zero address).

### 0.5 The real tension, stated rather than papered over

Task 0.4 of the brief asked whether registration can happen "without requiring
the user to first fund the wallet". **It cannot.** The fee is `msg.value` on a
call made *by the wallet*, and the relay charges gas to the wallet. So:

> **A Dolphin Wallet cannot be made recoverable until it holds funds.**

That collides head-on with the model Session 6 built and put on both wallet
screens — that a wallet exists and costs nothing until you choose to fund it.
Both halves are true and they cannot both be comfortable:

- an unfunded wallet is free, and is **not recoverable**;
- a recoverable wallet costs ~0.0007 BNB plus gas, and must be funded first.

There is no lighter-weight, purpose-built "register my key now" entry point in
the SDK. `registerSessionKey` registers a *session* key on an already-
registered wallet, not the admin key. `syncKeyToL2` / `ensureKeyCached` copy an
already-registered key to Base's L2 cache. Neither substitutes. The only route
to admin registration is an admin-signed intent that pays the fee — which is
precisely what `buildFirstActionPrepend` already injects.

### 0.6 What this means for the design

The gap cannot be closed silently for free, so the honest options are:

1. **Always tell the truth per wallet**, read live from `getKeys()`. Cheap
   (one `eth_call`), exact, and different for different wallets — which is what
   the brief demands instead of a blanket disclaimer.
2. **Offer registration as a consented, priced action** for a funded wallet
   that has not yet registered, with the live fee shown before committing.
3. Say nothing and let people discover it on a new device. Not an option.

1 and 2 together are what this session builds.

---

## TASK 1 — THE DECISION

**Both, and the order matters: tell the truth always, offer the fix as a
choice.** Recorded in `altana-policy.ts` under
`DECISION (2026-08-31): recoverability is READ per wallet, never assumed`,
hand-mirrored into the mobile twin in the same commit.

**Why not just register at creation.** A brand-new wallet holds nothing, and
registration is paid by the wallet. It *cannot* pay. Registering silently the
moment it is funded would spend someone's money without asking, which is the
one thing every spend-shaped action in this project refuses to do.

**Why a blanket warning was rejected.** Session 6 shipped one fixed sentence
about recovery on both wallet screens. The same sentence for every wallet is
wrong for half of them: it under-warns a fresh wallet whose funds really are at
risk, and over-warns a used wallet that is genuinely safe. The brief calls that
hedging rather than honesty, and it is right — especially when the true answer
is one `eth_call` away.

**Three states, not two.** `unknown` | `registered` | `unregistered`. A read
that fails renders as "not checked" and never collapses into either a
reassurance or a warning. That distinction is the whole point: this feature
exists because the screen was previously making a claim it had not checked.

## TASK 2 — WHAT WAS BUILT

**The read.** `getKeys(wallet)` against `NetworkConfig.keyStore`. The KeyStore
address and the RPC both come from the SDK's own config object, so no contract
address is hand-typed anywhere. The ABI fragment lives in `altana-policy.ts`
because the SDK does not export its `readActiveKeys` helper — and the policy
module must stay SDK-free so the native bundle never carries the SDK, the
constraint Session 6 measured.

**The action.** `client.execute({ wallet, signer, calls: [] })` — an
admin-signed intent with no calls of its own. `submitCalls` prepends the
KeyStore registration to any admin intent whose wallet is unregistered, so the
whole intent becomes exactly that one call. Deliberately not a contrived
self-call or dust transfer: those would move value or burn extra gas to achieve
the same registration.

**Consent and price**, to the standard Sessions 6 and 7 set:

- the live fee is rendered in the button label before it is pressable;
- the button is `disabled` outright when the wallet cannot cover fee + gas, and
  says how much it actually holds;
- a *null* balance disables it too, with its own sentence — "could not read" is
  never treated as "enough";
- the screen states that granting a session or paying an agent registers the
  wallet anyway, so nobody is nudged into paying for something their next
  action would have done for free.

**Staleness.** `grantSession`, `payForAgent`, `createWallet`, `recoverWallet`
and `registerWallet` all re-read recoverability afterwards. A screen whose
entire purpose is stating a checked fact must not go on showing a stale "not
yet" after the action that changed it.

### Verification — the read is proven BOTH ways, on real data

The negative side, on BSC mainnet (§0.1): all three wallets Session 6 created
return 0 keys → `unregistered`.

The positive side could not come from a Dolphin wallet, because none has ever
transacted. So it was proven against **real third-party Altana wallets** on
chain 97, found by walking KeyStore logs:

```
testnet KeyStore 0x6b8361C29d05D498b1a12B54A37310f94171E94A
  0xBB62A403F8b582b49bcB05E1a7a678Da4Ebde48f  getKeys -> 1 key   REGISTERED
  0xb69385da73e15AAB012ffa0407B3B63AF67AF3C1  getKeys -> 3 keys  REGISTERED
  0x5C7C544e86119378a64B12bA9d92CE335018EA9D  getKeys -> 7 keys  REGISTERED
  0x0000000000000000000000000000000000000000  getKeys -> 0 keys  unregistered
```

**So the `registered` branch is not dead code** — the exact call the providers
make returns non-empty for real registered wallets and empty for one that is
not. What remains unproven is narrower and is stated as such below.

## TASK 3 — THE EXTERNAL IDENTITY WALLET

Nothing was built here. Two things were checked, and one of them is a
correction to a standing entry in HANDOVER.md.

**1. OKX Wallet and friends are discovered automatically — but the app never
picks them.** `web/src/wallet/wallet-provider.tsx` configures
`injected({ shimDisconnect: true })` plus `walletConnect`. wagmi 2.19.5 turns
EIP-6963 multi-injected discovery **on by default**:

```js
// node_modules/@wagmi/core/dist/esm/createConfig.js:12
const { multiInjectedProviderDiscovery = true, ... }
```

so an installed OKX Wallet is surfaced as its own connector with an id like
`com.okex.wallet`. But `connect()` only ever selects
`connectors.find((c) => c.id === "injected")` or the WalletConnect one, so a
6963-discovered connector is never chosen.

**What that means in practice**, stated precisely rather than as a pass/fail:
with OKX Wallet installed *alone*, it sets `window.ethereum`, the bare
`injected` connector picks it up, and identity connection works exactly as for
any other wallet — which is what Task 3 asked to confirm. With OKX **and**
MetaMask both installed, they contend for `window.ethereum` and the user cannot
choose between them, because the one UI affordance that would let them (the
per-wallet 6963 connectors) is discovered and then ignored. That is a real,
small gap; it is logged, not fixed, because Task 3 says build nothing unless
something is found broken, and identity connection itself is not broken.

**2. The WalletConnect relay blocker from Session 4 is GONE.** That addendum
recorded this network refusing to resolve `relay.walletconnect.org`, and it was
the reason `injected()` was chosen. Re-checked live:

```
relay.walletconnect.org  ->  HTTP 400
relay.altana.network     ->  HTTP 405
```

400 is the correct answer from a WebSocket relay to a plain GET — it resolves
and it is reachable. So the QR path (which is how an OKX *mobile* wallet would
connect) is no longer environment-blocked. It is configured with a real project
id and was not exercised, because that needs a phone.

**Not verified, and it cannot be from here:** no wallet extension is installed
on this machine — the same limit Session 4 recorded for MetaMask. So the OKX
extension's own approval UI is untested. What is established is that the wiring
selects a connector correctly and that nothing about Sessions 6–8 changed this
path.

## GATES

| | Mobile (root) | Website (`web/`) |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| lint | 0 errors, 2 pre-existing warnings | 1 pre-existing error (below) |
| build | `expo export` OK, web **and** android | `next build` OK, `/wallet` still static |

Two lint warnings this session introduced (a missing `refreshRecoverability`
dependency in two `useCallback`s) were fixed in the same change rather than
left. The website's one error is in `web/src/app/search/page.tsx`
(`react-hooks/set-state-in-effect`), introduced in commit `e591a04` before
session 7 began, in a screen file AGENTS.md §11 reserves.

### The native bundle still carries no SDK

```
android   createPasskeyWallet 0   relay.altana.network 0
web       createPasskeyWallet 8   relay.altana.network 2
```

The Android bundle *does* contain `getRegistrationFeeInWei`, `registerWallet`
and `recoverabilityCopy` — one occurrence each. That is correct and intended:
those live in `altana-policy.ts` and `altana-types.ts`, which are deliberately
SDK-free and shared by both targets. The policy travels; the SDK does not.

## WHAT IS NOT PROVEN

**No Dolphin Wallet has ever been registered, so `registerWallet` has never
run to completion.** The owner was asked, with the cost stated
(~0.002 BNB all-in), and chose "build now, fund later" — the same call as
sessions 6 and 7.

Precisely what that leaves:

```
the getKeys read, unregistered side   OBSERVED (3 mainnet wallets)
the getKeys read, registered side     OBSERVED (3 real testnet wallets)
the fee read                          OBSERVED, and observed to move
the "cannot afford" refusal           BUILT - every Dolphin wallet is in
                                      this state, so it is what renders today
registerWallet() succeeding           NOT RUN
recovery working after registering    NOT RUN
```

The gap is now *visible to the user it affects*, which it was not before, and
the fix is one funded click away. But nobody here has watched a Dolphin Wallet
go from unrecoverable to recoverable.

**The UI was not driven in a browser.** Playwright is still not a dependency of
this repo (AGENTS.md §3 governs adding one), so the rendered panels were not
exercised. What was verified is the logic behind them: the on-chain read both
ways, and the fee.
