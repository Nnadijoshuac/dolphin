/**
 * Wallet authentication: proving that the caller controls the address it claims.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-06)
 * ---------------------------------------------------------------------------
 * Before this module, `grep -rn "ctx.auth" convex/` returned nothing. There was
 * no authentication anywhere in the backend, and every write took the address it
 * was about as a plain string argument:
 *
 *   hireReadOnlyAgent({ walletAddress: "0x...", ... })
 *
 * Anyone holding the deployment URL could therefore write a hire record for any
 * address on earth. That is not only an abuse surface; it means hire counts are
 * not evidence of anything, so they can never be a ranking signal, a metric, or
 * a claim made to anyone. Reviews would inherit the same defect the moment they
 * existed - an unauthenticated review system is a spam system.
 *
 * A wallet address is not an identity. It is an identity claim, and it becomes
 * an identity only when someone signs something with the key behind it.
 *
 * ---------------------------------------------------------------------------
 * WHY A BEARER TOKEN RATHER THAN ctx.auth
 * ---------------------------------------------------------------------------
 * Convex's `ctx.auth` reads a JWT validated against an OIDC provider configured
 * in auth.config.ts. There is no OIDC provider for "this person holds an
 * secp256k1 key", and standing one up means running and securing a second
 * service whose only job is to mint JWTs - more infrastructure, more to keep
 * alive, and one more thing that can be down while someone is trying to pay an
 * agent.
 *
 * So the session is a bearer token this backend issues itself, after it has
 * verified a signature. It is passed as an argument, which looks superficially
 * like the untrusted `walletAddress` argument it replaces, and is not the same
 * thing at all:
 *
 *   - the address argument was a CLAIM anyone could type;
 *   - the token is a 256-bit random credential that only this backend can mint,
 *     and it only mints one after checking a signature over a message that this
 *     backend chose.
 *
 * Guessing a token is the same problem as guessing a private key. Typing an
 * address is not a problem at all.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED
 * ---------------------------------------------------------------------------
 * The token is never stored. Only its SHA-256 is, so a dump of the sessions
 * table yields no usable credential - the same reason a password table stores
 * hashes. Verification hashes the presented token and looks up the hash.
 *
 * sha256 comes from viem rather than WebCrypto because it is pure JS and viem
 * already runs in every Convex runtime this project uses; `crypto.subtle` is
 * async and its availability across Convex's query/mutation isolates is not
 * something this file should be betting correctness on.
 */

import { getAddress, isAddress, sha256, stringToHex } from "viem";

import type { QueryCtx } from "../_generated/server";
import { BSC_CHAIN_ID } from "./bscClient";

/**
 * How long a signed-in session lasts.
 *
 * 30 days, matching the ordinary expectation for a mobile app that should not
 * ask for a signature every launch. A session is revocable (walletAuth.signOut)
 * and expiry is checked on every use rather than by a sweep, so an expired row
 * is inert the moment it expires even though it is still on disk.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a login nonce is good for.
 *
 * Five minutes is long enough to walk to a hardware wallet and short enough
 * that a signature captured off a screen is worthless by the time anyone could
 * use it. Nonces are single-use regardless - verifySignature deletes the row
 * before it issues a session - so this bounds only the unused ones.
 */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** The human-readable line the user is actually agreeing to, in the signing sheet. */
export const SIWE_STATEMENT =
  "Sign in to Dolphin. This proves you control this wallet. It authorises no payment, no token transfer, and no spending permission.";

/**
 * The app's SIWE `domain` and `uri`.
 *
 * A native app has no origin, so these describe the product rather than a page.
 * They are part of the signed message, which means they are also what a wallet
 * shows the user - so they say something a person can recognise rather than a
 * localhost URL that would look like a phishing attempt.
 */
export const SIWE_DOMAIN = "dolphin.app";
export const SIWE_URI = "https://dolphinamp.vercel.app";

/**
 * Builds the exact EIP-4361 message that will be signed.
 *
 * THE SERVER BUILDS THIS, NOT THE CLIENT, and the stored copy is what
 * verification runs against. If the client supplied the message, it could sign
 * anything it liked and present the result as a login - the signature would
 * verify perfectly and prove nothing about what the user agreed to. Choosing
 * the message is the whole security property.
 */
export function buildSiweMessage(input: {
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    SIWE_STATEMENT,
    "",
    `URI: ${SIWE_URI}`,
    "Version: 1",
    `Chain ID: ${BSC_CHAIN_ID}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

/** Hex of `bytes` random bytes. Actions only - see the note in walletAuth.ts. */
export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What goes in the table. The token itself never does. */
export function hashSessionToken(token: string): string {
  return sha256(stringToHex(token));
}

export function normalizeAddress(candidate: string, context: string): string {
  if (!isAddress(candidate)) {
    throw new Error(`${context}: "${candidate}" is not a valid EVM address.`);
  }
  return getAddress(candidate);
}

/** True when an ISO timestamp is in the past, or unreadable (which is treated as expired). */
export function hasExpired(isoTimestamp: string, now: number = Date.now()): boolean {
  const at = Date.parse(isoTimestamp);
  return Number.isNaN(at) || at <= now;
}

export type WalletSessionRow = {
  address: string;
  expiresAt: string;
};

/**
 * The address behind a session token, or a thrown error naming why not.
 *
 * Every authenticated write funnels through this. It deliberately throws rather
 * than returning null: a caller that forgets to check a null would write
 * unauthenticated data, and this is exactly the class of mistake the module
 * exists to make impossible.
 */
export function addressFromSession(
  session: WalletSessionRow | null,
  context: string,
): string {
  if (!session) {
    throw new Error(
      `${context}: not signed in. Connect a wallet and sign the Dolphin sign-in message first.`,
    );
  }
  if (hasExpired(session.expiresAt)) {
    throw new Error(
      `${context}: this sign-in has expired. Sign in again to continue.`,
    );
  }
  return session.address;
}

/**
 * THE ONE DOOR every authenticated write goes through.
 *
 * Takes the bearer token, returns the checksummed address it was issued to, and
 * throws otherwise. Callers never see a null and therefore cannot forget to
 * check one - which is the whole point, because the failure mode of a forgotten
 * null check here is writing unauthenticated data, the exact defect this module
 * was added to remove.
 *
 * Typed against QueryCtx rather than MutationCtx so queries can use it too;
 * Convex's DatabaseWriter extends DatabaseReader, so a mutation ctx satisfies
 * it structurally.
 */
export async function requireWalletAddress(
  ctx: QueryCtx,
  sessionToken: string,
  context: string,
): Promise<string> {
  const row = await ctx.db
    .query("walletSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", hashSessionToken(sessionToken)))
    .unique();

  return addressFromSession(row, context);
}
