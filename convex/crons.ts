import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync discovered agents from 8004scan",
  { hours: 12 },
  internal.discoveredAgents.syncDiscoveredAgents,
  {},
);

export default crons;
