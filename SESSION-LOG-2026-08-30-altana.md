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

---

## Task 1 — wallet-creation strategy: passkey

Documented in code at `ALTANA_SIGNER_STRATEGY`, in
`web/src/wallet/altana-policy.ts` and its hand-mirrored twin
`src/wallet/altana-policy.ts`, in the same discoverable/reversible style as
`DEFAULT_READ_ONLY_PRICE_MODEL`.

The reasoning carried forward from the brief held up under the evidence:
Altana never persists key material and cannot hand a generated private key
back, so a private-key wallet makes *this app* solely responsible for custody
with no recovery path. §0.3's probe adds one reason the brief did not mention —
a passkey signer's own `address` is the **zero address**, so for that path the
SDK genuinely never has an EOA identity to leak.

Private-key signers stay right for something operational and are what
`scripts/spike-b-auth.mjs` uses. They are not offered to a person.

---

## Task 2 — website provider, verified live

Chromium, against `next build` + `next start`, with a **real WebAuthn
ceremony**. The authenticator is Chrome's virtual authenticator (CDP WebAuthn
domain) rather than a physical sensor, so no human has to press a fingerprint
reader — but `navigator.credentials.create()` really runs, the SDK's real
`createPasskeyWallet` path really executes, and the P256 keys are really
generated. Nothing about the SDK is stubbed.

```
virtual authenticator installed                3fa28d3d-69f2-40d4-8d97-cd15284a0471

=== 1. LAND ON /wallet ===
url                                            http://localhost:3000/wallet
navigator.credentials present                  true

=== 2. CREATE A REAL PASSKEY WALLET ===
wallet address (from the page)                 0xfE16aBCc199bB3F9935aa7B6b6466341833130C3
credential.kind                                webauthn
credential id length                           43
P256 public key length (hex)                   130
rpId                                           (default: origin host)
stores ANY private key?                        false
credentials on the authenticator               1

=== 6. SURVIVES A RELOAD ===
same address after reload                      true

=== ERRORS ===
console errors                                 0
page errors                                    0
```

`stores ANY private key? false` is a real assertion, not a restatement of
intent: the check enumerates every key of the persisted credential object
looking for anything matching `/private/i`.

### The balance read, resolved and cross-checked

```
wallet address: 0xe14033b70c51BC99b115cA0C228e7F4b480e76EA

--- assets card, after the read resolved ---
   B
   BNB
   BNB Smart Chain · native
   0
   Read live from chain 56

--- funding path ---
   visible: true
   Fund this wallet
   Send BNB to this address on BNB Smart Chain (chain 56) from an exchange or
   another wallet. Until it is funded the wallet exists but can do nothing — it
   holds no balance and cannot pay for a transaction.
   0xe14033b70c51BC99b115cA0C228e7F4b480e76EA

--- cross-check the same address with an independent RPC ---
   eth_getBalance(0xe14033b70c51BC99b115cA0C228e7F4b480e76EA) = 0x0
```

The zero is a **real read**, confirmed twice: once through the SDK (which used
`bsc-rpc.publicnode.com`, observed in the network log) and once directly
against `bsc-dataseed.bnbchain.org` from inside the page.

### A real finding: recovery needs one prior transaction

`recoverFromPasskey` timed out on a freshly created wallet. Chasing it produced
the SDK's own error, worth quoting in full because it is user-quality and it
names the exact cause:

```
Picked passkey resolves to wallet 0xd5a593b83b66cc4cfe1adf0c7082e0a1cb272bba,
but that wallet has no keys registered in KeyStore yet. Either: (a) you picked
the wrong passkey (the OS keychain has multiple with similar names — use unique
names per test), or (b) this wallet was created but never executed a
transaction, so its admin key isn't on-chain yet.
```

It is (b), and it follows from the SDK's own documented design: `createWallet`'s
doc comment says the wallet "is NOT yet registered in KeyStore on any chain —
that happens on the first execute() call per chain."

**What this means in practice, and it matters for a demo:** a wallet created and
never used cannot be recovered. Note the good half — the passkey lookup itself
worked perfectly: the discoverable-credential picker returned the right
credential and the `userHandle` resolved to **the same address that was
created**. Only the on-chain KeyStore read fails, because nothing is there yet.

Both wallet screens now say this up front rather than letting a user meet it as
a raw error.

### One incidental observation

Chrome logs a warning during creation:

```
publicKey.pubKeyCredParams is missing at least one of the default algorithm
identifiers: ES256 and RS256. This can result in registration failures on
incompatible authenticators.
```

The ceremony succeeded regardless. It is the SDK's request shape, not
Dolphin's, and nothing here can change it — recorded so a future session does
not spend time rediscovering it.

---

## Task 4 — wallet screens, both products

### Website

Verified in the runs above: create CTA, a distinct recover path, the
separate-wallet notice, real address, a live BNB asset row, funding path,
granted-permissions view, and revoke. 0 console errors, 0 page errors.

### Mobile — the Expo **web export**, served statically

This is the surface a judge actually opens: the public build at
`nnadijoshuac.github.io/dolphin` is this export.

```
=== 2. Does the Dolphin Wallet card render? ===
   Dolphin Wallet                 true
   Create with a passkey          true
   recover it                     true
   This is a separate wallet      true
   Your own wallet                true

=== 3. Create a real passkey wallet on the Expo web build ===
   wallet address: 0xfb0b95a5C1c4Af1Aa7883AFAB543502028ad22ef
   credential kind: webauthn | P256 pubkey hex len: 130
   credentials on authenticator: 1
   balance label: Read live from chain 56
   shows 'Fund this wallet': true
   shows authorized section: true
   shows 'No agent can spend': true

=== ERRORS: console=0 page=0 ===
```

---

## Task 5 — which agents get a session, and the live proof of the split

The judgement lives in `CATEGORY_SESSION_POLICY`. A category earns a session
only when **both** hold: acting (not reporting) is the job, **and** Dolphin can
name a concrete, already-verified contract to allow.

| Category | Session? | Allowlist | Reasoning |
|---|---|---|---|
| health-factor | yes | Venus Core Pool Comptroller | acting before a liquidation is the entire value; without authority to repay it can only warn |
| rebalancing | yes | PancakeSwap V3 Position Manager | rebalancing a position means moving it |
| yield | yes | Aave V3 Pool | moving capital to the best-earning venue is the job |
| grid-trading | **no** | — | would need it in principle, but Dolphin has no wired data source for this category and no verified venue address; authority into a blind spot is worse than none |
| monitoring | **no** | — | information delivery by definition |

**No new contract address was written this session.** Every allowlisted address
is one this repo had already verified independently against the protocol's own
deployments file and cross-checked on BscScan, for its live-stats reads. That
was deliberate: an allowlist is the one place a wrong address turns into real
authority over real money.

### The backend refusals, verified live against the deployment

```
=== CONTROL: empty allowlist must be REJECTED ===
✖ Failed to run function "agentSessions:recordSessionGrant":
Uncaught Error: recordSessionGrant: refusing a session with an empty call
allowlist - Altana treats omitted/empty `calls` as all-targets-allowed.
    at handler (../convex/agentSessions.ts:71:8)

=== a real bounded grant must SUCCEED ===
"k175fv8yph7c2cbjexcrrk3v458de6c9"

=== read it back ===
  allowlist:    [{ 0xfD36E2c2a6789Db23113685031d7F16329158384,
                   "Venus Core Pool Comptroller" }]
  spendCapWei:  10000000000000000        (0.01 BNB)
  spendPeriod:  day
  status:       expired      <- derived from the clock, not stored

=== after markSessionRevoked ===
  revokedAt: 2026-08-30T22:18:19.836Z
  status:    revoked
```

Two behaviours confirmed by that output rather than asserted: the derived
`expired` status really is computed on read (the expiry used was in the past),
and a revoked row keeps `revoked` rather than being overwritten by the expiry
derivation. The probe row was deleted afterwards; `agentSessions` is empty.

### The per-category split, live in both products

Website, production build, Chromium:

```
health-factor   token 45381    AS POLICY SAYS   offers a session: true
rebalancing     token 265375   AS POLICY SAYS   offers a session: true
yield           token 12046    AS POLICY SAYS   offers a session: true
grid-trading    token 292939   AS POLICY SAYS   offers a session: false
                                                says none needed: true
=== ERRORS: 0 ===
```

grid-trading was re-checked **with a Dolphin Wallet present** and still refuses,
so the refusal is the policy talking, not a missing precondition.

The health-factor grant step, read out of the live DOM:

```
   Give this agent a spending permission
   A health-factor agent's entire value is acting before a liquidation, not
   reporting that one is coming. Without authority to repay it can only warn.
   It can only call
   Venus Core Pool Comptroller
   0xfD36E2c2a6789Db23113685031d7F16329158384
   Anything else
   Rejected on-chain
   Most it can spend
   0.01 BNB / day    0.05 BNB / day    0.1 BNB / day
   Permission expires after
   7 days    30 days    90 days
   You are authorizing at most 0.01 BNB per day for 30 days, against the
   contract listed above and nothing else. You can revoke it at any time from
   your wallet, and it stops working on its own when it expires.
   Grant 0.01 BNB / day
   Granting is an on-chain transaction on BNB Smart Chain and costs gas from
   your Dolphin Wallet.
```

Mobile web export, with a real Dolphin Wallet
(`0x2E8EA2738724d6028b09c13268BD1597d7CdA734`):

```
health-factor   45381    AS POLICY SAYS   0xfD36E2c2a6789Db23113685031d7F16329158384
rebalancing     265375   AS POLICY SAYS   0x46A15B0b27311cedF172AB29E4f4766fbE7F4364
yield           12046    AS POLICY SAYS   0x6807dc923806fE8Fd134338EABCA509979a7e0cB
grid-trading    292939   AS POLICY SAYS   refuses, with its reason

all three grant steps showed: "Rejected on-chain" true | gas warning true
                              cap choices 0.01 / 0.05 / 0.1 BNB per day
=== ERRORS: console=0 page=0 ===
```

Each category offers exactly its own verified contract — a good sign the policy
is genuinely wired through rather than one constant rendered three times.

### What was NOT verified, stated plainly

**The on-chain enforcement itself.** The network decision was mainnet (§0.5),
so a grant costs real BNB, and the owner chose not to fund an address. This
session did **not** run grant → in-bounds call → out-of-bounds call rejected →
revoke, and does not claim to have. The revert-at-validation-time behaviour is
Altana's documented guarantee and is what the code is built against; it is not
something this repo has watched happen.

`scripts/spike-b-auth.mjs` produces exactly that proof against chain 97 the
moment a disposable address is funded. Both relays are reachable from this
network (§0.3), so this is purely a funding question, not an environment one.

---

## Task 6 — parity

Both products end the session with the same real capability set: wallet
creation, recovery, live balance display, scoped session granting, and
revocation from both the wallet screen and the hire record. The UIs differ, as
they always have in this project; the substance does not.

| | Website | Mobile (web export) | Mobile (native) |
|---|---|---|---|
| Create / recover wallet | yes | yes | no — stated reason |
| Live balance | yes | yes | no |
| Grant a scoped session | yes | yes | no |
| Revoke from wallet screen | yes | yes | n/a |
| Revoke from hire record | yes | yes | n/a |

**The one real gap, logged rather than papered over:** native Expo cannot host
a Dolphin Wallet at all, for the reasons in §0.4. It renders an honest
unavailable state naming the cause and pointing at the browser, where the same
passkey opens the same wallet. A platform limit, not an unfinished feature.

### A bundling problem found by measuring, not by reading

Adding the SDK to the mobile app risked shipping a browser-oriented dependency
tree (porto, ox) to a phone that can never use it. Two separate causes, each
found with a real `expo export`:

1. **The platform-router pattern already used by `wallet-provider.ts` bundles
   both modules on both platforms.** `import * as Native` + `import * as Web`
   then branching on `Platform.OS` is a *runtime* branch over *static* imports,
   so Metro ships both. Measured: the Android bundle carried
   `createPasskeyWallet` (4 hits) and the Altana relay URL. Replaced with
   Metro's own platform resolution plus a `.d.ts`, which needs no `tsconfig`
   change — worth noting, because HANDOVER records an earlier attempt at
   platform resolution being reverted for needing `moduleSuffixes`, which broke
   expo-video's types.
2. **That alone was not enough.** `altana-policy.ts` imported the SDK's `BNB`
   constant, and the package root is a barrel, so one chain id dragged the
   whole SDK in anyway. The policy is now plain data (`ALTANA_CHAIN_ID`) and
   each provider resolves `BNB` itself, asserting the two agree.

Measured on the real bundles after both fixes:

```
android   createPasskeyWallet 0   relay.altana.network 0   (SDK excluded)
web       createPasskeyWallet 5   relay.altana.network 1   (SDK present)
```

This is also a finding about the **existing** `wallet-provider.ts`: the whole
Reown/wagmi native stack ships inside the web bundle for the same reason, which
HANDOVER already noted as a 6.4 MB bundle. The fix demonstrated here would
apply there too.

---

## Gate status, both products

| | Mobile (root) | Website (`web/`) |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| lint | 0 errors, 2 pre-existing warnings | 0 errors |
| build | `expo export` OK, web **and** android | `next build` OK |
| Convex | pushes; `agentSessions` + 2 indexes added | same backend |

The website's lint was **not** clean at the start of this session — a
pre-existing `prefer-const` error in `wallet-provider.tsx`, in a file this
session had not touched. Fixed in its own commit so the gate could be honestly
reported as clean.

`/wallet` still prerenders as static content under `next build`, which is the
check that matters for the SSR class of bug this project has hit before.
