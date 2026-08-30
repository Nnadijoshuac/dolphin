/**
 * The continuous discovery cycle (Task 6).
 *
 * ---------------------------------------------------------------------------
 * THE CADENCE IS CALCULATED FROM MEASURED NUMBERS, NOT PICKED.
 * ---------------------------------------------------------------------------
 * Every figure below came from a live run against the real 8004scan API during
 * this session, recorded in SESSION-LOG-2026-08-29-discovery.md:
 *
 *   registry size            291,508 identities on BSC mainnet
 *   request budget           600/min, 100,000/day (authenticated)
 *   page size                100 (`limit` caps there; 200+ returns HTTP 422)
 *   full walk                2,916 pages
 *   search sweep, measured   53 terms -> 71 requests -> 2,255 unique records
 *                            in 62 seconds
 *   new registrations        ~28/hour (`total` moved 289,938 -> 289,971 in
 *                            ~70 minutes of this session's own calls)
 *   Convex action ceiling    10 minutes
 *
 * SWEEP EVERY HOUR. One sweep costs ~75 requests for the search and tail paths
 * plus whatever the backfill fits into its remaining budget. Hourly is
 * comfortably inside the request budget (see below) and, at ~28 new
 * registrations per hour, means the descending tail sweep sees a brand-new
 * agent within one hour of it appearing - three pages of 100 is ~10x the
 * hourly registration rate, so nothing new can slip past between cycles even
 * if registrations spike an order of magnitude.
 *
 * The backfill resumes from a stored offset and is bounded by wall clock, so it
 * walks the whole registry over a rolling window of cycles rather than trying
 * to finish in one - which it cannot, because a full walk exceeds the 10-minute
 * action ceiling by a wide margin.
 *
 * DAILY REQUEST BUDGET CHECK. 24 sweeps x (71 search + 3 tail + backfill pages)
 * plus 48 deep-evaluation passes (a handful of requests each) plus the 6-hourly
 * directory refresh. Even at several hundred backfill pages per cycle this
 * lands in the low tens of thousands against a 100,000/day allowance, with the
 * per-minute limit never approached because concurrency is capped at 4.
 *
 * DEEP EVALUATION EVERY 30 MINUTES, offset from the sweep. Separate from the
 * sweep on purpose: it is bounded by ENDPOINT latency (other people's servers),
 * not by 8004scan, so tying the two together would let one slow agent eat the
 * sweep's budget. 40 candidates per pass x 48 passes = 1,920 evaluations/day of
 * capacity against a candidate population in the hundreds, so a newly-swept
 * agent is fully evaluated within about half an hour of being seen.
 *
 * STALENESS IS HANDLED IN BOTH DIRECTIONS, which Task 6.2 asks for explicitly:
 *   - going stale: a published agent is re-probed every 24h, and delisted after
 *     3 consecutive failures (convex/lib/pipelineStatus.ts). It is demoted to
 *     `pending`, not deleted, so one successful probe re-lists it automatically.
 *   - arriving: the tail sweep bounds time-to-first-sight at one hour, and the
 *     deep-evaluation pass picks new candidates up within the next 30 minutes.
 *
 * ---------------------------------------------------------------------------
 * THE LEGACY KEYWORD SYNC IS REMOVED FROM THE SCHEDULE, DELIBERATELY.
 * ---------------------------------------------------------------------------
 * `discoveredAgents.syncDiscoveredAgents` wrote into the same `discoveredAgents`
 * table the new pipeline publishes to, using the single-keyword classifier and
 * with no liveness gate beyond 8004scan's own `is_active` flag. Leaving it on
 * the schedule would mean the two fighting over the catalog: the pipeline would
 * delist an agent whose endpoint stopped answering, and the old sync would put
 * it straight back an hour later.
 *
 * The function itself is intentionally NOT deleted - it is still callable by
 * hand and is the fallback if the new pipeline ever needs to be switched off in
 * a hurry. Only its cron entry is gone.
 */

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "discovery sweep (search + new-registration tail + resumable backfill)",
  { hours: 1 },
  internal.discoveryPipeline.sweep,
  {},
);

crons.interval(
  "deep-evaluate candidates (cross-check, liveness probe, icon, publish gate)",
  { minutes: 30 },
  internal.discoveryPipeline.deepEvaluate,
  {},
);

// Fills icon gaps for anything the candidate pipeline does not cover - notably
// the eight hand-vetted editorial agents, which never pass through it. Cheap
// and idempotent: it skips every agent that already has a cached icon, so on a
// steady-state run it does nothing.
crons.interval(
  "cache an icon for every listed agent",
  { hours: 12 },
  internal.discoveryPipeline.ensureCatalogIcons,
  {},
);

// Keeps 8004scan's indexed view of the listed agents fresh for agents.listAgents.
// More often than a full sweep because this is what both frontends actually
// render - name, description, reputation, x402 support, endpoint health - and
// it is a cheap per-agent detail fetch over a few dozen token IDs, not a scan.
crons.interval(
  "refresh 8004scan agent directory",
  { hours: 6 },
  internal.agents.refreshAgentDirectory,
  {},
);

export default crons;
