/**
 * THE CONTINUOUS CYCLE.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE OLD SCHEDULE LOOKED LIKE, AND WHY IT STOPPED
 * ---------------------------------------------------------------------------
 * The hourly discovery sweep was COMMENTED OUT on 2026-09-02 and had not run
 * since. Not a design decision - a storage emergency. The sweep was the only
 * scheduled writer that inserted into `agentCandidates`, that table had reached
 * 259,914 rows and ~1.05 GB counting index overhead, and the deployment was
 * over its plan limit. Discovery coverage simply stopped advancing for five
 * days, and the note left in its place said re-enabling it as-is would walk the
 * deployment straight back over the limit at ~26,000 rows a day.
 *
 * Nothing on this schedule can do that, because nothing on it writes a row per
 * record seen. Discovery writes one narrow row per candidate that publishes a
 * callable endpoint, and counters for everything else.
 *
 * ---------------------------------------------------------------------------
 * THE CADENCES, FROM MEASURED NUMBERS
 * ---------------------------------------------------------------------------
 *   registry size            307,559 identities (BSC mainnet, 2026-09-07)
 *   with an A2A endpoint      27,742
 *   with an MCP server         5,474
 *   new registrations          1,348/day  (~56/hour)
 *   request budget             600/min, 100,000/day authenticated
 *   Convex action ceiling      30 min (Convex runtime), 10 min (Node runtime)
 *
 * DISCOVERY EVERY 30 MINUTES. In the steady state it asks
 * `created_after=<high-water mark>` and gets back ~28 records - one page, one
 * request. During the one-time backfill it walks 8 pages of the A2A and MCP
 * slices per run, which finishes ~330 pages in a couple of days without any
 * single long-running action. Against a 100,000/day allowance this is
 * rounding error.
 *
 * VERIFICATION EVERY 10 MINUTES, and separate from discovery ON PURPOSE. It is
 * bounded by OTHER PEOPLE'S SERVERS, not by 8004scan, so tying the two together
 * would let one slow agent eat the discovery budget - which is exactly what the
 * old `refreshAgentDirectory` did by probing inside the same loop that fetched.
 * 200 agents per pass x 144 passes = 28,800 probes/day of capacity against a
 * candidate population of ~33,000.
 *
 * STALENESS IS HANDLED IN BOTH DIRECTIONS:
 *   arriving - a new registration is seen within 30 minutes and probed within
 *              the next 10, so time-to-listing is under an hour.
 *   going    - a listed agent is re-probed every 24h and delisted after 3
 *              consecutive failures. It is marked `unavailable`, never deleted,
 *              so one successful probe re-lists it automatically and an existing
 *              hire's detail page never 404s.
 */

import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "discovery (incremental by created_at, backfill over the A2A and MCP slices)",
  { minutes: 30 },
  internal.discovery.run,
  {},
);

crons.interval(
  "verification (fan out one probe per due agent)",
  { minutes: 10 },
  internal.verification.scheduleBatch,
  {},
);

/**
 * The browse chips, recomputed on a slow schedule as a backstop.
 *
 * `applyVerification` already schedules a recompute whenever catalog membership
 * changes, so this is belt-and-braces for the case where a change is missed -
 * and it is cheap, because `facets.write` compares before patching and a
 * recompute that finds nothing different writes nothing.
 */
crons.interval(
  "recompute catalog facets",
  { hours: 6 },
  internal.facets.recompute,
  {},
);

export default crons;
