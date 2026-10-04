/**
 * WHICH POST BROUGHT THEM - the browser half of convex/campaignRefs.ts.
 *
 * A link we post carries `?ref=<tag>`. The tag is kept in this browser for 30 days (the latest one wins),
 * and four moments are reported under it: the visit, a wallet sign-in, a build started and an agent
 * registered on chain, plus a paid hire. Each moment counts once per browser per tag, so a refresh or a
 * second build is not a second person.
 *
 * Only the tag and the moment travel. No wallet, no session, nothing about the person.
 */

import { campaignRefsApi, type RefKind } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";

const STORE = "dolphin.ref";
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

function read(): { ref: string; at: number; sent: RefKind[] } | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ref: string; at: number; sent: RefKind[] };
    return Date.now() - parsed.at < KEEP_MS ? parsed : null;
  } catch {
    return null;
  }
}

function write(value: { ref: string; at: number; sent: RefKind[] }) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the count is lost, nothing else */
  }
}

/** Report a moment under the remembered tag, once. A no-op when nobody arrived from a tagged link. */
export function recordRefEvent(kind: RefKind): void {
  if (typeof window === "undefined" || !convexClient) return;
  const stored = read();
  if (!stored || stored.sent.includes(kind)) return;
  write({ ...stored, sent: [...stored.sent, kind] });
  convexClient.mutation(campaignRefsApi.campaignRefs.record, { ref: stored.ref, kind }).catch(() => undefined);
}

/** On arrival: keep a `?ref=` tag and count the visit. */
export function captureRef(): void {
  if (typeof window === "undefined") return;
  const tag = new URLSearchParams(window.location.search).get("ref")?.trim().toLowerCase();
  if (!tag || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(tag)) return;
  const stored = read();
  if (stored?.ref !== tag) write({ ref: tag, at: Date.now(), sent: [] });
  recordRefEvent("visit");
}
