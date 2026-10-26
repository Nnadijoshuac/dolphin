/**
 * A REAL CLICK BEFORE AN AUTOMATIC QUESTION (2026-10-26). "Ask Dolphin about this agent" opened the chat and
 * sent its question on load - so a crawler that renders pages, walking the catalog, sent one per agent: 30
 * chats in ten minutes, ~127 of the day's 150 free AI requests. The button now records the click here, and
 * the chat sends on its own only when that click happened in this tab moments ago. Any other way in (a
 * crawler, a pasted link) gets the question ready in the box, for a person to send.
 */
const KEY = "dolphin:ask-intent";
const FRESH_MS = 120_000;

export function markAskIntent(agentId: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ agentId, at: Date.now() }));
  } catch {
    // No storage (private mode): the question is still waiting in the box.
  }
}

/** True once, for a fresh click on this agent; clears the mark either way. */
export function takeAskIntent(agentId: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return false;
    const mark = JSON.parse(raw) as { agentId?: string; at?: number };
    return mark.agentId === agentId && typeof mark.at === "number" && Date.now() - mark.at < FRESH_MS;
  } catch {
    return false;
  }
}
