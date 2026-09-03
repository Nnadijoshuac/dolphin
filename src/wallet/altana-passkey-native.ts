import type { PasskeyWebAuthnFns } from "@altananetwork/sdk";

/**
 * The WebAuthn bridge that lets a Dolphin Wallet exist on a native build.
 *
 * WHAT CHANGED. Until @altananetwork/sdk 0.9.0 this file could not have
 * existed. The SDK reached `navigator.credentials` directly, React Native's
 * global `navigator` is literally `{product: 'ReactNative'}`, and the only
 * other signer the SDK offered was a raw private key this app declines to take
 * custody of (ALTANA_SIGNER_STRATEGY in altana-policy.ts). 0.9.0 added a
 * `webAuthn: { createFn, getFn }` option to `createPasskey`,
 * `createPasskeyWallet`, `recoverFromPasskey` and `signerFromPasskey`, and
 * forwards those functions into porto everywhere WebAuthn is touched -
 * creation, recovery, and every signature. This module is Dolphin's
 * implementation of that option.
 *
 * Docs: https://docs.altana.network/use-cases/8-mobile-app and the `webAuthn`
 * parameter on /sdk/create-passkey-wallet + /sdk/recover-from-passkey.
 *
 * THE JOB. Two encodings have to meet:
 *
 *   ox/porto (what the SDK calls)   WebAuthn-style objects with ArrayBuffers.
 *   react-native-passkeys           WebAuthn JSON, every buffer base64url.
 *
 * So every function here is a translation, and the translation is the whole
 * point: get a field's encoding wrong and the OS either refuses the ceremony
 * or - worse - the wallet is created around a public key nobody holds. Hence
 * the cross-check in `publicKeyFromCreation` below.
 *
 * VERIFIED against the installed versions rather than assumed, by reading
 * their source this session: @altananetwork/sdk 0.9.0
 * (dist/internal/passkey.js, dist/createPasskeyWallet.js,
 * dist/recoverFromPasskey.js, dist/internal/relay.js), porto's
 * viem/Key.createWebAuthnP256, and ox's core/WebAuthnP256.js +
 * core/internal/webauthn.js.
 */

/* --- base64url ------------------------------------------------------------
 * Hand-rolled rather than pulled from `ox` or leaned on `atob`/`btoa`.
 *
 * `ox` is a transitive dependency of the SDK, not a declared one of this app,
 * and importing it here would make a load-bearing conversion depend on a
 * package nothing in package.json pins (AGENTS.md §3). `atob`/`btoa` do exist
 * on modern Hermes - Altana's mobile page lists them as an expected global -
 * but only for the ERC-8004 helpers, and staking passkey creation on a runtime
 * global's presence buys nothing over the twenty lines below.
 * ------------------------------------------------------------------------ */

const B64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64URL_ALPHABET[a >> 2];
    out += B64URL_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64URL_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64URL_ALPHABET[c & 0x3f];
  }
  return out;
}

function fromBase64Url(value: string): Uint8Array {
  // Tolerates the padded, non-url alphabet too: iOS and Android have both been
  // observed returning standard base64 for some fields, and a decoder that
  // only accepted one dialect would fail on a device rather than in review.
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((normalized.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let written = 0;
  for (const char of normalized) {
    const index =
      char === "+" ? 62 : char === "/" ? 63 : B64URL_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(
        `Passkey bridge: the passkey library returned a value that is not ` +
          `base64 (saw "${char}"). Dolphin will not guess at its encoding.`,
      );
    }
    acc = (acc << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** ox hands buffers in as `ArrayBufferView | ArrayBuffer`; normalise to bytes. */
function asBytes(source: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return new Uint8Array(source);
}

/** ox reads every response field through `new Uint8Array(...)`, so hand it one. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/* --- the public key, and why it is checked twice --------------------------
 *
 * ox's `parseCredentialPublicKey` (core/internal/webauthn.js) has two paths:
 *
 *   1. `response.getPublicKey()` -> `crypto.subtle.importKey('spki', ...)`.
 *   2. On a thrown error whose message is EXACTLY "Permission denied to
 *      access object" (a 1Password/Firefox quirk), a pure-JS fallback that
 *      scans `response.attestationObject` for the COSE key's 0x21 / 0x22
 *      coordinate markers.
 *
 * Path 1 cannot run here. This app's native runtime has `crypto.getRandomValues`
 * (index.js imports react-native-get-random-values before anything else) but no
 * `crypto.subtle`: expo-crypto ships only getRandomValues and digest,
 * react-native-get-random-values polyfills only getRandomValues, and
 * @walletconnect/react-native-compat installs no SubtleCrypto - all three
 * checked in node_modules this session, not assumed. Path 1 would therefore
 * throw a TypeError, which is not the sentinel message, so ox would rethrow and
 * creation would fail.
 *
 * So `getPublicKey()` below routes to path 2 deliberately - but only when
 * `crypto.subtle` is genuinely absent, so a runtime that later gains WebCrypto
 * (and the web target, which has it) silently goes back to the standard path.
 *
 * THE CHECK. Path 2 is a byte-scan for a marker sequence, and a byte-scan can
 * match the wrong offset. The key it produces is the sole authority over a
 * wallet that will hold real funds on BSC mainnet, and a wrong one fails
 * SILENTLY - the wallet is created, the address looks fine, and every later
 * signature is rejected by a key nobody has. That is unacceptable, so when the
 * library also gives us the DER SubjectPublicKeyInfo we independently extract
 * the same coordinates from it and refuse to continue if the two disagree.
 * ------------------------------------------------------------------------ */

const COORDINATE_LENGTH = 0x20;

/** Mirrors ox's fallback scan exactly, so we check what ox will actually read. */
function coordinatesFromAttestationObject(
  data: Uint8Array,
): { x: Uint8Array; y: Uint8Array } | null {
  const findStart = (key: number): number => {
    const marker = [key, 0x58, COORDINATE_LENGTH];
    for (let i = 0; i < data.length - marker.length; i++) {
      if (marker.every((byte, j) => data[i + j] === byte)) return i + marker.length;
    }
    return -1;
  };
  const xStart = findStart(0x21);
  const yStart = findStart(0x22);
  if (xStart < 0 || yStart < 0) return null;
  return {
    x: data.slice(xStart, xStart + COORDINATE_LENGTH),
    y: data.slice(yStart, yStart + COORDINATE_LENGTH),
  };
}

/**
 * A P-256 SubjectPublicKeyInfo is a fixed 91-byte DER structure whose final 65
 * bytes are the SEC1 uncompressed point (0x04 || x || y). Reading the tail is
 * enough and needs no ASN.1 parser.
 */
function coordinatesFromSpki(
  spki: Uint8Array,
): { x: Uint8Array; y: Uint8Array } | null {
  if (spki.length < 1 + COORDINATE_LENGTH * 2) return null;
  const point = spki.slice(spki.length - (1 + COORDINATE_LENGTH * 2));
  if (point[0] !== 0x04) return null;
  return {
    x: point.slice(1, 1 + COORDINATE_LENGTH),
    y: point.slice(1 + COORDINATE_LENGTH),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function assertPublicKeyAgrees(
  attestationObject: Uint8Array,
  spki: Uint8Array | null,
): void {
  const scanned = coordinatesFromAttestationObject(attestationObject);
  if (!scanned) {
    throw new Error(
      "Dolphin could not read the new passkey's public key out of its " +
        "attestation object. Rather than create a wallet around a key it " +
        "cannot verify, it stopped. No wallet was created.",
    );
  }
  if (!spki) return;
  const declared = coordinatesFromSpki(spki);
  if (!declared) return;
  if (!sameBytes(scanned.x, declared.x) || !sameBytes(scanned.y, declared.y)) {
    throw new Error(
      "Dolphin read two different public keys for the same new passkey, so it " +
        "refused to create a wallet that only one of them could control. No " +
        "wallet was created and nothing was signed.",
    );
  }
}

/** Present in a browser and on the web target; absent on this native runtime. */
function hasSubtleCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === "function";
}

/* --- loading the passkey library -----------------------------------------
 *
 * DO NOT TURN THIS BACK INTO A STATIC `import ... from "react-native-passkeys"`.
 * It was one, and it took the whole app down on Expo Go.
 *
 * react-native-passkeys calls `requireNativeModule("ReactNativePasskeys")` at
 * MODULE SCOPE (build/ReactNativePasskeysModule.js line 5), so merely importing
 * it throws `Cannot find native module 'ReactNativePasskeys'` wherever the
 * native side is not linked - Expo Go being the obvious case. A static import
 * makes that throw before any code here runs, which meant
 * `nativePasskeysSupported()` never got the chance to answer "no": the module
 * failed to evaluate, so altana-provider.native.tsx failed, so
 * app-providers.tsx failed, so _layout.tsx had no default export and expo-router
 * crashed on `Cannot read property 'ErrorBoundary' of undefined`. A missing
 * optional native module took out every route in the app.
 *
 * Requiring it lazily behind a try/catch turns that into what it should always
 * have been: one honest "this device cannot create a passkey" card on the
 * wallet screen, and an app that runs. Metro still bundles the module (the
 * specifier is a literal), so a real dev build picks it up normally.
 * ------------------------------------------------------------------------ */

type PasskeyLib = {
  isSupported: () => boolean;
  create: typeof import("react-native-passkeys").create;
  get: typeof import("react-native-passkeys").get;
};

/** `undefined` = not tried yet, `null` = tried and unavailable. */
let libCache: PasskeyLib | null | undefined;

function passkeyLib(): PasskeyLib | null {
  if (libCache !== undefined) return libCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    libCache = require("react-native-passkeys") as PasskeyLib;
  } catch {
    libCache = null;
  }
  return libCache;
}

const PASSKEY_MODULE_MISSING =
  "This build has no passkey module linked, so Dolphin cannot reach this " +
  "device's Face ID or fingerprint. A development build is required - Expo Go " +
  "cannot load it.";

/** For the two call sites that genuinely need the library rather than a probe. */
function requirePasskeyLib(): PasskeyLib {
  const lib = passkeyLib();
  if (!lib) throw new Error(PASSKEY_MODULE_MISSING);
  return lib;
}

/* --- the adapter ---------------------------------------------------------- */

type CredentialDescriptorJSON = {
  id: string;
  type: "public-key";
  transports?: string[];
};

function descriptorsToJson(
  descriptors: readonly { id: ArrayBufferView | ArrayBuffer; type: string; transports?: string[] }[]
    | undefined,
): CredentialDescriptorJSON[] | undefined {
  if (!descriptors) return undefined;
  // An EMPTY array is meaningful and must survive: recoverFromPasskey passes
  // `allowCredentials: []` to ask the OS for its discoverable-credential
  // picker. Collapsing that to `undefined` would change what the user sees.
  return descriptors.map((descriptor) => ({
    id: toBase64Url(asBytes(descriptor.id)),
    type: "public-key",
    ...(descriptor.transports ? { transports: descriptor.transports } : {}),
  }));
}

/**
 * `createFn` - the credential-creation half.
 *
 * Called by ox's `createCredential` with the options porto built
 * (`residentKey: "required"`, `userVerification: "required"`,
 * `extensions.credProps`, `rp: {id: rpId, name: rpId}`, and `user.id` carrying
 * the wallet address the SDK bakes in for recovery).
 */
const createFn: NonNullable<PasskeyWebAuthnFns["createFn"]> = async (options) => {
  const request = options?.publicKey;
  if (!request) {
    throw new Error("Passkey bridge: credential creation was asked for with no options.");
  }

  const created = await requirePasskeyLib().create({
    rp: request.rp,
    user: {
      id: toBase64Url(asBytes(request.user.id)),
      name: request.user.name,
      displayName: request.user.displayName,
    },
    challenge: toBase64Url(asBytes(request.challenge)),
    pubKeyCredParams: request.pubKeyCredParams,
    ...(request.timeout === undefined ? {} : { timeout: request.timeout }),
    ...(request.attestation === undefined ? {} : { attestation: request.attestation }),
    ...(request.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: request.authenticatorSelection }),
    ...(descriptorsToJson(request.excludeCredentials) === undefined
      ? {}
      : { excludeCredentials: descriptorsToJson(request.excludeCredentials) }),
    // Only credProps is forwarded. largeBlob and prf are this library's own
    // extensions; porto asks for neither and passing them through unread would
    // be requesting authenticator capabilities Dolphin has no use for.
    ...(request.extensions?.credProps === undefined
      ? {}
      : { extensions: { credProps: request.extensions.credProps } }),
  } as Parameters<PasskeyLib["create"]>[0]);

  // Null is the user cancelling the Face ID / fingerprint sheet. ox turns this
  // into its own CredentialCreationFailedError; do not dress it up as worse.
  if (!created) return null;

  const attestationObject = fromBase64Url(created.response.attestationObject);
  const spkiBase64 = created.response.getPublicKey?.() ?? null;
  const spki = spkiBase64 ? fromBase64Url(spkiBase64) : null;

  assertPublicKeyAgrees(attestationObject, spki);

  return {
    id: created.id,
    rawId: toArrayBuffer(fromBase64Url(created.rawId)),
    type: created.type ?? "public-key",
    authenticatorAttachment: created.authenticatorAttachment ?? null,
    response: {
      attestationObject: toArrayBuffer(attestationObject),
      clientDataJSON: toArrayBuffer(fromBase64Url(created.response.clientDataJSON)),
      getPublicKey(): ArrayBuffer {
        if (spki && hasSubtleCrypto()) return toArrayBuffer(spki);
        // Routes ox to its pure-JS attestationObject path. See the long note
        // above: this runtime has no crypto.subtle, and the coordinates that
        // path will find were just checked against the SPKI.
        throw new Error("Permission denied to access object");
      },
    },
    getClientExtensionResults: () => created.clientExtensionResults ?? {},
  } as unknown as Awaited<ReturnType<NonNullable<PasskeyWebAuthnFns["createFn"]>>>;
};

/**
 * `getFn` - the assertion half, used for recovery AND for every signature.
 *
 * Each `execute`, `grantSession`, `revokeSession` and ERC-8183 payment runs a
 * fresh ceremony through here; that is the security model, not a cost to
 * optimise away. `userHandle` must be returned or the SDK cannot resolve a
 * wallet address on recovery (dist/recoverFromPasskey.js reads it directly and
 * requires exactly 20 bytes).
 */
const getFn: NonNullable<PasskeyWebAuthnFns["getFn"]> = async (options) => {
  const request = options?.publicKey;
  if (!request) {
    throw new Error("Passkey bridge: a signature was asked for with no options.");
  }
  if (!request.rpId) {
    // ox defaults rpId to `window.location.hostname`, which does not exist
    // here. Every Dolphin call path sets it (the credential carries it and
    // porto threads it through), so reaching this means a path was added that
    // does not - fail loudly rather than let ox read undefined.
    throw new Error(
      "Passkey bridge: no relying-party id was supplied for this signature, " +
        "and a native app has no page origin to fall back to.",
    );
  }

  const assertion = await requirePasskeyLib().get({
    challenge: toBase64Url(asBytes(request.challenge)),
    rpId: request.rpId,
    ...(descriptorsToJson(request.allowCredentials) === undefined
      ? {}
      : { allowCredentials: descriptorsToJson(request.allowCredentials) }),
    ...(request.userVerification === undefined
      ? {}
      : { userVerification: request.userVerification }),
    ...(request.timeout === undefined ? {} : { timeout: request.timeout }),
  } as Parameters<PasskeyLib["get"]>[0]);

  if (!assertion) return null;

  return {
    id: assertion.id,
    rawId: toArrayBuffer(fromBase64Url(assertion.rawId)),
    type: assertion.type ?? "public-key",
    authenticatorAttachment: assertion.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: toArrayBuffer(fromBase64Url(assertion.response.clientDataJSON)),
      authenticatorData: toArrayBuffer(fromBase64Url(assertion.response.authenticatorData)),
      // DER/ASN.1, which is what ox's parseAsn1Signature expects.
      signature: toArrayBuffer(fromBase64Url(assertion.response.signature)),
      userHandle: assertion.response.userHandle
        ? toArrayBuffer(fromBase64Url(assertion.response.userHandle))
        : null,
    },
    getClientExtensionResults: () => assertion.clientExtensionResults ?? {},
  } as unknown as Awaited<ReturnType<NonNullable<PasskeyWebAuthnFns["getFn"]>>>;
};

/** Hand this to createPasskeyWallet, recoverFromPasskey and signerFromPasskey. */
export const nativeWebAuthn: PasskeyWebAuthnFns = { createFn, getFn };

/**
 * Whether this device can run a passkey ceremony at all.
 *
 * Two distinct "no"s, both of which must be answers rather than crashes:
 * the module is not linked into this build (Expo Go), or it is linked and the
 * device itself cannot oblige (iOS below 15, no Android credential provider).
 * The first is why `passkeyLib()` exists; the second is what `isSupported()`
 * reports. Either way Dolphin says so on the wallet screen instead of offering
 * a button that throws.
 */
export function nativePasskeysSupported(): boolean {
  const lib = passkeyLib();
  if (!lib) return false;
  try {
    return lib.isSupported();
  } catch {
    return false;
  }
}
