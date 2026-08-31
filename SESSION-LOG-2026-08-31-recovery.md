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
