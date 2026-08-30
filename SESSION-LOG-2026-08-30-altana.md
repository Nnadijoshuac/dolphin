# Session 6 log — Altana integration, wallet revamp, both platforms

Every command's real output is pasted below. Where something was not run, it
says so rather than describing what would have happened.

---

## Task 0 — investigation

### 0.1 The SDK version actually in play

`@altananetwork/sdk@0.8.0` was already a **devDependency** at the repo root
(added in an earlier session for `scripts/spike-b-auth.mjs`). It is also the
newest published version — checked, not assumed:

```
$ npm view @altananetwork/sdk version
0.8.0

$ npm view @altananetwork/sdk versions
[ '0.4.0', '0.5.0', '0.5.1', '0.6.0', '0.7.0', '0.7.1', '0.8.0' ]

$ npm view @altananetwork/sdk time.modified
2026-08-18T10:55:14.062Z
```

So the SDK gap `project-scope.md` §6 recorded on 2026-08-28 is still the
current state of the package, not a stale note about an old version.

### 0.2 The architectural fact in the brief — confirmed, still true

The brief asks whether an Altana session can be granted against a wallet the
user already connected through an injected provider (MetaMask etc.). It cannot.
`signerFromInjected` appears **only in doc comments** — it is never implemented
and never exported:

```
$ grep -rn "signerFromInjected" node_modules/@altananetwork/sdk/dist/
dist/createWallet.d.ts:7:     * signerFromPrivateKey / signerFromInjected / signerFromPasskey, or omit
dist/internal/signer.d.ts:11: *   - signerFromInjected     — MetaMask / Rabby / any EIP-1193 provider.
dist/internal/signer.js:11:  *   - signerFromInjected     — MetaMask / Rabby / any EIP-1193 provider.
```

`dist/index.d.ts` exports exactly three signer constructors:
`signerFromPrivateKey`, `createPrivateKeySigner`, and the passkey trio
(`createPasskey`, `createHeadlessPasskey`, `signerFromPasskey`).

**Consequence, and it drives the whole session:** what gets built here is a
*second, parallel wallet* — Dolphin's own Altana wallet — alongside the
existing wagmi/Reown connect flow. It is not an upgrade of the user's MetaMask
account and shares no balance with it. The UI has to say so in as many words.

### 0.3 Live environment probe — `scripts/spike-altana-env.mjs`

Read-only and free: no transaction, no funding, no private key required.
Real output:

```
=== Altana SDK environment probe (Session 6, Task 0) ===
Runtime                                node v24.13.0 on win32
navigator defined?                     true
navigator.credentials defined?         false

--- 1. createPasskey outside a browser ---
threw                                  Error
message                                createPasskey({ name }) needs a browser — it prompts the user for a
                                       biometric (Face ID / Touch ID / Windows Hello) via WebAuthn, which
                                       isn't available in Node or other server runtimes.
                                       If you're writing a test or running server-side, use
                                       createHeadlessPasskey() — same wallet shape, but the P256 key is
                                       held in memory with no biometric prompt.

--- 2. createHeadlessPasskey ---
signer.type                            passkey
credential.kind                        headless
publicKey length (hex chars)           130
signer.address                         0x0000000000000000000000000000000000000000
rehydrates via signerFromPasskey       true

--- 3. createWallet (counterfactual, unfunded) ---
BNB mainnet (56) wallet address        0x82947E547DE323D8898723d30b753268D7Ea92cA
BNB mainnet (56) equals signer EOA     true
BNB mainnet (56) native balance (wei)  0
BNB testnet (97) wallet address        0x4b3C643C9aB5633683ab31F644Fc01Ad124243fe
BNB testnet (97) equals signer EOA     true
BNB testnet (97) native balance (wei)  0

--- 4. createWallet with a headless passkey signer ---
passkey wallet address                 0x15B331BfD55940DFf34Fce40dFc1F17AAeFCedF8
passkey wallet balance (wei)           0

--- 5. Relay reachability from this network ---
https://relay.altana.network           HTTP 200
https://testnet-relay.altana.network   HTTP 200
```

Four things worth pulling out of that:

1. **`createPasskey` is browser-gated, and fails with a clear, honest error** —
   not a silent misbehaviour. That error message is good enough to surface to a
   user more or less verbatim.
2. **`createWallet` is genuinely counterfactual** — an address comes back with
   no transaction and no funding, on both chains, and `balances` reads it as
   `0`. So "create a wallet" is a free, instant, offline-ish operation and the
   funding step is separate and explicit. This matches `project-scope.md` §6's
   earlier finding (wallet address == signer EOA, EIP-7702 in-place upgrade).
3. **Both Altana relays answer HTTP 200 from this network.** That is a
   meaningful contrast with `relay.walletconnect.org`, which this network's DNS
   still refuses (§4 of the 2026-08-29 addendum). Altana's transport is not
   blocked here; WalletConnect's is.
4. A passkey signer's own `address` is the **zero address** — as documented. The
   wallet address comes from the throwaway-EOA that `createWallet` upgrades, not
   from the signer. Anything that keys state off `signer.address` for a passkey
   wallet would silently collide on `0x000…0`; key off `wallet.address`.

### 0.4 The mobile question, answered from React Native's own source

The brief asks not to assume either way. React Native does not merely lack a
WebAuthn implementation — its `navigator` is a two-property object literal.
From `node_modules/react-native/Libraries/Core/setUpNavigator.js`, verbatim:

```js
const navigator = global.navigator;
if (navigator === undefined) {
  global.navigator = {product: 'ReactNative'};
} else {
  polyfillObjectProperty(navigator, 'product', () => 'ReactNative');
}
```

There is no `credentials` property to fail on. `createPasskey` will throw its
browser-required error on any React Native runtime, deterministically.

Confirmed against the live docs too, not just the installed package —
`https://docs.altana.network/sdk/create-passkey-wallet` states plainly:
**"Browser only. Uses navigator.credentials."** No React Native or mobile
support is mentioned anywhere on that page.

#### Could a React Native passkey library bridge the gap?

`react-native-passkeys@0.4.2` and `expo-passkey@0.3.15` both exist and are
current. But this was already evaluated and rejected in an earlier session
(`project-scope.md` §6) for a reason that has not changed and is not about the
library: **platform passkeys require a verified domain serving
`apple-app-site-association` / `assetlinks.json`**, and this project has no such
domain for its native builds. A second, separate problem stands behind it —
Altana needs the flat P256 `x || y` public-key encoding, and neither library
documents the encoding it returns, so compatibility would have to be
reverse-engineered rather than read.

So the native gap is **not** a missing npm package. It is a missing verified
domain plus an undocumented encoding, and no amount of SDK work here closes it.

#### The finding that actually matters, and it is a good one

**The Expo app's publicly reachable build is its web export** —
`https://nnadijoshuac.github.io/dolphin/`, served by
`.github/workflows/deploy-web.yml`. That runs in a real browser, on a real
HTTPS origin, where `navigator.credentials` **is** available and
`nnadijoshuac.github.io` is a perfectly good WebAuthn relying-party ID.

So the honest split for the mobile product is not "passkeys work / passkeys
don't". It is:

| Expo target | `navigator.credentials` | Altana passkey wallet |
|---|---|---|
| web export (the public build, what a judge opens) | yes | **works** |
| native (Expo Go / dev client) | no — see the source above | unavailable, with a stated reason |

That is the same shape as every other platform divergence this project has
documented, and it means the mobile product gets a real, working Altana wallet
on the surface that is actually reachable, rather than a stub everywhere.

### 0.5 Network decision — BSC mainnet (56)

**Decided by the project owner, asked explicitly because it has real-money
consequences.** Both options were put with their trade-offs; mainnet was
chosen for consistency with everything else Dolphin reads.

- The marketplace (discovery, category stats, ERC-8004 identity) reads BSC
  mainnet, and the wallet now matches it. One chain across the whole product,
  nothing to explain away in a demo.
- The cost, stated plainly: **a session grant on mainnet costs real BNB**, so
  the live on-chain enforcement proof (grant → in-bounds call → out-of-bounds
  call rejected → revoke) **was not run this session.** The owner chose to skip
  the funded proof rather than fund an address.
- Everything that needs no funds *was* verified live and is recorded below:
  wallet creation, recovery, balance reads, session UI, revocation wiring.
- What that means for claims: this session does **not** claim on-chain session
  enforcement is proven. It is built to the documented API and the boundary is
  visible in the UI, but the revert-at-validation-time behaviour is asserted by
  Altana's docs, not observed here. `scripts/spike-b-auth.mjs` still exists and
  will produce that proof the moment an address is funded.

Both relays being reachable (§0.3) means this is purely a funding question, not
an environment one — which is worth knowing, because it is a much smaller gap
than the WalletConnect relay block that has dogged the native wallet path.
