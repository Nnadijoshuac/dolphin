/**
 * ONE SHORT LINE IN THE BROWSER CONSOLE, NEVER A DUMP (owner, 2026-10-01: "too
 * much data exposed in the browser console").
 *
 * Errors used to be logged whole. A failed paid hire printed the relay's full
 * request: the prepared intent, the wallet's passkey public key and the signed
 * WebAuthn assertion, twice. None of it is a secret that can move money, but it
 * is the user's own signed material in a place screenshots and extensions read,
 * and it buried the one sentence that mattered.
 *
 * So: a tag and the error's first readable sentence, capped, with long hex
 * runs (keys, signatures, calldata) cut. Full detail stays available in local
 * development, where the person reading the console is the developer.
 */

const MAX_CHARS = 200;

function firstLine(cause: unknown): string {
  if (cause instanceof Error || (typeof cause === "object" && cause !== null)) {
    const record = cause as { shortMessage?: unknown; message?: unknown; details?: unknown };
    const head = typeof record.shortMessage === "string" ? record.shortMessage : typeof record.message === "string" ? record.message : "";
    const details = typeof record.details === "string" ? record.details : "";
    const line = (head.split(/\n/)[0] ?? "").trim();
    return details && !line.includes(details) ? `${line} (${details.split(/\n/)[0]})` : line;
  }
  return typeof cause === "string" ? cause.split(/\n/)[0] ?? "" : "";
}

/** Log a failure as one line. In development the full error is logged too. */
export function reportToConsole(tag: string, cause?: unknown, level: "error" | "warn" = "error"): void {
  const line = firstLine(cause)
    .replace(/0x[0-9a-fA-F]{40,}/g, "0x…")
    .slice(0, MAX_CHARS);
  const write = level === "warn" ? console.warn : console.error;
  if (process.env.NODE_ENV !== "production" && cause !== undefined) {
    write(`[${tag}] ${line}`, cause);
    return;
  }
  write(line ? `[${tag}] ${line}` : `[${tag}]`);
}
