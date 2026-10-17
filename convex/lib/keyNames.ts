/**
 * WHAT A KEY IS CALLED (owner, 2026-10-17: "they just put in their key and then give it a name... like
 * Jev, Open AI, Open Router, Grok... They don't need to see how we call it").
 *
 * A key's name is whatever the person typed - "Jev", "Bush", "My OpenRouter" - kept as typed and
 * matched ignoring capitals, so "bush" in a builder chat finds the key saved as "Bush". The old
 * environment-variable style (OPENAI_API_KEY) still passes, so every existing key keeps working.
 * One rule, used by the Keys form, the blocks and the brain port, so they cannot disagree.
 */
const KEY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,39}$/u;

export const KEY_NAME_HINT = "Give it a short name, like Jev, OpenRouter or Grok: letters, numbers, spaces and dashes, up to 40 characters.";

/** Trims and folds runs of spaces; null if the result is not a usable name. */
export function cleanKeyName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().replace(/\s+/g, " ");
  return KEY_NAME.test(name) ? name : null;
}

export function isKeyName(input: unknown): input is string {
  return cleanKeyName(input) === input;
}

export function sameKeyName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}
