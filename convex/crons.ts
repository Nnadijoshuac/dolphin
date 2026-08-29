import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync discovered agents from 8004scan",
  { hours: 12 },
  internal.discoveredAgents.syncDiscoveredAgents,
  {},
);

// Keeps 8004scan's indexed view of the listed agents fresh for agents.listAgents.
// More often than discovery (12h) because this is what both frontends actually
// render - name, description, reputation, x402 support, endpoint health - and
// it is a cheap per-agent detail fetch over a few dozen token IDs, not a scan.
crons.interval(
  "refresh 8004scan agent directory",
  { hours: 6 },
  internal.agents.refreshAgentDirectory,
  {},
);

export default crons;
