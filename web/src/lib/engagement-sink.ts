/**
 * THE BACKEND'S COPY OF THE FUNNEL: anonymous per-agent counters in Convex.
 *
 * Vercel Analytics records the funnel for dashboards, but nothing on the
 * backend can read it, so the product could never learn from it. This sink
 * mirrors the agent-keyed events into `agentEngagement` (convex/engagement.ts),
 * where ranking and the admin view can use them.
 *
 * Same rule as analytics.ts: an agent key and an event kind, nothing else. No
 * wallet, no query text, no session id.
 *
 * Batched: events queue for a few seconds and go in one mutation, so a page of
 * 25 cards is one call rather than 25. Impressions go ONLY here, never to
 * Vercel - one per card per page view would exhaust a custom-event quota for a
 * number only the backend needs.
 */

import { engagementApi, type EngagementKind } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";

const FLUSH_DELAY_MS = 4000;
/** Matches the server's per-call cap in convex/engagement.ts. */
const MAX_BATCH = 60;

const queue: { agentKey: string; kind: EngagementKind }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const client = convexClient;
  if (!client || queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  // Telemetry never reaches the page: a dropped batch is a lost count, nothing more.
  client.mutation(engagementApi.engagement.record, { events: batch }).catch(() => undefined);
  if (queue.length > 0) timer = setTimeout(flush, FLUSH_DELAY_MS);
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Leaving the page is the last chance to send what is queued.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function recordEngagement(agentKey: string, kind: EngagementKind): void {
  if (typeof window === "undefined" || !convexClient || agentKey.length === 0) return;
  listen();
  queue.push({ agentKey, kind });
  if (queue.length >= MAX_BATCH) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
}

/**
 * One impression per agent per page, however often the card scrolls in and
 * out. A re-render or a list refresh is not a second person seeing it.
 */
const seen = new Set<string>();

export function recordImpression(agentKey: string): void {
  if (typeof window === "undefined") return;
  const key = `${window.location.pathname}${window.location.search}|${agentKey}`;
  if (seen.has(key)) return;
  seen.add(key);
  recordEngagement(agentKey, "impression");
}
