/**
 * STAGE 4: what actually reaches the public catalog, and what does not.
 *
 * This module holds every threshold that decides publication. It is separated
 * from the scorer and the probe on purpose: the classifier answers "what is
 * this", the probe answers "does it work", and this file is the single place
 * where those two answers are turned into "is a judge allowed to see it".
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-30): auto-publish requires BOTH a confirmed classification
 * AND a live endpoint. Anything else lands `pending`.
 * ---------------------------------------------------------------------------
 * Documented here in the same style as DEFAULT_READ_ONLY_PRICE_MODEL, so it is
 * reversible by whoever disagrees, in one place.
 *
 * The failure modes are not symmetric, and the threshold follows that:
 *
 *   - A wrongly-published spam agent is seen by every visitor, is indistinguish-
 *     able from a vetted listing, and damages trust in the whole marketplace.
 *   - A real agent held in `pending` for one more cycle costs that agent one
 *     cycle. Nobody sees a wrong claim in the meantime.
 *
 * So the gate is deliberately conservative, and `pending` is a real, populated,
 * inspectable state rather than a synonym for "dropped".
 *
 * WHY LIVENESS IS PART OF THE PUBLISH GATE AND NOT JUST A BADGE. Dolphin's
 * entire premise is that a zero-knowledge user can find an agent and use it.
 * Listing an agent whose service does not answer sends that user into a dead
 * end, which is the exact Functionality failure project-scope.md §11 rules out.
 * An agent that advertises no endpoint at all cannot be used either, so
 * `no-endpoint-advertised` also holds at `pending` - honestly recorded, not
 * rejected, because the publisher may add one later.
 *
 * NOTE ON SCOPE: this gate governs DISCOVERED agents only. The eight
 * hand-vetted editorial agents in convex/lib/agentCatalog.ts are curated by a
 * human and are not routed through it, so nothing here can delist them.
 */

import type { AgentCategory } from "./agentCatalog";
import type { LivenessState } from "./liveness";

export type CandidateStatus =
  /** Dropped by the cheap pre-filter. Never deep-evaluated. */
  | "rejected-prefilter"
  /** Deep-evaluated and found not to be a single-purpose agent in any category. */
  | "rejected-classifier"
  /** Plausible, recorded in full, deliberately NOT public yet. */
  | "pending"
  /** Live in the catalog that both frontends render. */
  | "published";

/**
 * How many consecutive failed probes before a published agent is delisted.
 *
 * DECISION: three, not one. A single failed probe is weak evidence - the
 * session's own measurements saw 8004scan itself return 500/502/524s, and a
 * publisher redeploying their service will fail one probe and pass the next.
 * Delisting on one failure would flicker the catalog on ordinary noise. Three
 * consecutive failures across three separate deep-evaluation passes is a
 * sustained pattern, which is a defensible signal.
 *
 * A delisted agent is demoted to `pending`, never deleted: its evaluation
 * record survives, and one successful probe restores it. That also means a
 * publisher who fixes their endpoint is re-listed automatically, with no human
 * in the loop - which is the whole point of this session.
 */
export const DELIST_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * How long a `verified-live` result is trusted before the agent is re-probed.
 *
 * DECISION: 24 hours. Short enough that a dead agent is caught within a day,
 * long enough that the deep-evaluation batch spends its budget on candidates
 * that have never been evaluated rather than re-probing the same few dozen
 * healthy agents every cycle.
 */
export const LIVENESS_RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How long a rejected candidate is left alone before it is reconsidered.
 *
 * DECISION: 14 days. Publishers do edit their registrations - a rejected record
 * is not permanently rejected - but re-evaluating 280,000+ rejections every
 * cycle is exactly the waste Task 1's incremental tracking exists to prevent.
 * A sweep that re-sees a rejected tokenId refreshes its `lastSeenAt` cheaply
 * and only re-runs the filter once the record is this old.
 */
export const REEVALUATE_REJECTED_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export interface StatusInput {
  category: AgentCategory | null;
  confidence: "confirmed" | "likely" | null;
  liveness: LivenessState;
  /** Consecutive failed probes INCLUDING the one in `liveness`. */
  consecutiveProbeFailures: number;
  /** True for anything not on the registry 8004scan indexes - see Task 0.5. */
  offPrimaryRegistry: boolean;
  /** The manual safety valve, keep-out direction. */
  manuallyExcluded: boolean;
  /**
   * The manual safety valve, let-in direction: a human has reviewed this agent
   * and vouched for the category. It relaxes the CLASSIFICATION half of the gate
   * only - a hand-included agent whose endpoint does not answer still gets
   * delisted, because the liveness half is a claim about right now that no past
   * human review can stand in for.
   */
  manuallyIncluded: boolean;
  /** Whether this candidate is currently published, for the delist decision. */
  currentlyPublished: boolean;
}

export interface StatusDecision {
  status: CandidateStatus;
  /** Always set. Says in one checkable sentence why the agent is where it is. */
  reason: string;
}

/**
 * The publish gate. Every branch returns a reason, because a status with no
 * stated cause is not auditable and this pipeline runs without a human
 * watching it.
 */
export function resolveStatus(input: StatusInput): StatusDecision {
  if (input.manuallyExcluded) {
    return {
      status: "rejected-classifier",
      reason:
        "Held out by the manual exclusion list. A human reviewed this agent and rejected it; the automated pipeline does not overrule that.",
    };
  }

  if (input.category === null) {
    return {
      status: "rejected-classifier",
      reason: "The classifier did not place this agent in any browsable category.",
    };
  }

  if (input.offPrimaryRegistry) {
    return {
      status: "pending",
      reason:
        "Registered on the BRC8004 identity registry rather than the AgentIdentity registry Dolphin's catalog is keyed against. Its token id collides with a different agent's id on the primary registry, so publishing it would silently merge two agents. Held pending a registry-qualified catalog key.",
    };
  }

  if (input.liveness === "unreachable") {
    if (input.currentlyPublished && input.consecutiveProbeFailures < DELIST_AFTER_CONSECUTIVE_FAILURES) {
      return {
        status: "published",
        reason: `Endpoint did not answer this pass (${input.consecutiveProbeFailures} consecutive failure(s)). A single failed probe is not treated as death; delisting happens at ${DELIST_AFTER_CONSECUTIVE_FAILURES} consecutive failures.`,
      };
    }
    return {
      status: "pending",
      reason: input.currentlyPublished
        ? `Delisted after ${input.consecutiveProbeFailures} consecutive failed endpoint probes. The evaluation record is kept and one successful probe re-lists it automatically.`
        : "The agent's advertised endpoint did not answer a protocol-appropriate probe, so Dolphin cannot confirm it works.",
    };
  }

  if (input.liveness === "no-endpoint-advertised") {
    return {
      status: "pending",
      reason:
        "The agent advertises no endpoint anywhere in its 8004scan record or its own registration file, so there is nothing to confirm it works. Held pending rather than rejected - a publisher can add one.",
    };
  }

  if (input.confidence !== "confirmed") {
    if (input.manuallyIncluded) {
      return {
        status: "published",
        reason:
          "Classified `likely` rather than `confirmed`, but a human reviewed the agent and vouched for the category, and its endpoint answered a protocol-appropriate probe. The liveness half of the gate was still enforced.",
      };
    }
    return {
      status: "pending",
      reason:
        "Endpoint is confirmed live, but the classification is only `likely` - below the confidence needed to auto-publish a category claim.",
    };
  }

  return {
    status: "published",
    reason:
      "Classified `confirmed` into a browsable category, and its own advertised endpoint answered a protocol-appropriate probe.",
  };
}

/** Whether a candidate is due a (relatively expensive) deep evaluation now. */
export function needsDeepEvaluation(
  candidate: {
    status: CandidateStatus;
    lastDeepEvaluatedAt: string | null;
  },
  now: number,
): boolean {
  if (candidate.lastDeepEvaluatedAt === null) return true;
  const age = now - Date.parse(candidate.lastDeepEvaluatedAt);
  if (!Number.isFinite(age)) return true;

  switch (candidate.status) {
    case "rejected-prefilter":
      // The pre-filter is pure string work and already re-runs on every sweep.
      return false;
    case "rejected-classifier":
      return age >= REEVALUATE_REJECTED_AFTER_MS;
    case "pending":
    case "published":
      return age >= LIVENESS_RECHECK_AFTER_MS;
  }
}
