/**
 * Sealing secrets at rest: AES-256-GCM under DOLPHIN_ENV_KEY, a 32-byte
 * deployment secret kept in the Convex dashboard, never in this repo.
 * (2026-09-28) Shared by builders' API keys (envVars.ts) and agents' trade
 * session keys (autotrade.ts). ACTIONS ONLY: Web Crypto's subtle API is async
 * and is used here only from actions.
 */

import { ConvexError } from "convex/values";

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Typed on a plain ArrayBuffer: Web Crypto's BufferSource rejects a SharedArrayBuffer-backed view. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = process.env.DOLPHIN_ENV_KEY;
  const bytes = raw ? fromBase64(raw) : null;
  if (!bytes || bytes.length !== 32) {
    throw new ConvexError("Secrets cannot be stored yet: this deployment has no encryption key configured.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts with a fresh random 96-bit IV. */
export async function seal(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(plain));
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

export async function open(box: { ciphertext: string; iv: string }): Promise<string> {
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(box.iv) },
    await encryptionKey(),
    fromBase64(box.ciphertext),
  );
  return new TextDecoder().decode(opened);
}
