/**
 * THE SUBMISSION PATH (Task 5) - a publisher asking to be listed.
 *
 * The registry sweep is the passive discovery path; this is the active one. It
 * exists because the sweep is bounded by what 8004scan's search surfaces and by
 * how far the backfill has walked, and a publisher who wants to be listed today
 * should not have to wait for either.
 *
 * ---------------------------------------------------------------------------
 * DECISION: a submission gets NO weaker evaluation than a swept agent.
 * ---------------------------------------------------------------------------
 * A submitter asserting their own agent is real is not evidence that it is -
 * it is the single least independent source available, and a self-submission
 * path that trusts its submitter is exactly how a marketplace fills with spam.
 * So `submitAgent` does not insert into the catalog. It puts the agent at the
 * FRONT of the same queue everything else is in, and the identical pipeline
 * decides: pre-filter, classifier, registration-file cross-check, live endpoint
 * probe, then convex/lib/pipelineStatus.ts's publish gate.
 *
 * The only privilege a submission gets is priority. It jumps the deep-evaluation
 * queue and is evaluated within seconds instead of on the next cron cycle.
 *
 * ---------------------------------------------------------------------------
 * DECISION: what the submitter sees back is "under review", never "listed".
 * ---------------------------------------------------------------------------
 * The mutation returns immediately - it has to, because the evaluation involves
 * network calls a Convex mutation cannot make - and what it returns is an
 * honest `under-review` state plus a pointer to `getSubmissionStatus`. Telling a
 * submitter their agent is live before anything has probed it would be a
 * plausible-looking false claim about a real agent, which is the exact failure
 * mode AGENTS.md §5 rules out. It also would not survive contact with the
 * pipeline: an unreachable agent lands `pending` a few seconds later, and the
 * submitter would have been told the opposite.
 *
 * NO UI THIS SESSION, deliberately - AGENTS.md §11 reserves that. What a future
 * UI hookup needs is only: (1) call `agentSubmissions.submitAgent` with a
 * tokenId, (2) poll or subscribe to `agentSubmissions.getSubmissionStatus` for
 * that tokenId, and (3) render `state` and `reason` verbatim, because both are
 * already written to be shown to a person.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { ERC8004_IDENTITY_REGISTRY } from "./lib/agentCatalog";

const AGENTS_URL =
  process.env.SCAN8004_API_URL?.trim() || "https://api.8004scan.io/api/v1/agents";
const REQUEST_TIMEOUT_MS = 15_000;

function scan8004Headers(): HeadersInit {
  const apiKey = process.env.SCAN8004_API_KEY;
  return apiKey
    ? { Accept: "application/json", "X-API-Key": apiKey }
    : { Accept: "application/json" };
}

/** Publisher-facing states. Every one of these is safe to render verbatim. */
export type SubmissionState =
  | "under-review"
  | "listed"
  | "held-pending"
  | "not-listed"
  | "unknown";

/**
 * Accepts a submission and puts it at the front of the evaluation queue.
 *
 * `contractAddress` is optional and defaults to the AgentIdentity registry
 * Dolphin's catalog is keyed against. It is accepted because Task 0.5 found a
 * second identity registry on BNB Chain (BRC8004) whose token ids collide with
 * this one's, so "tokenId 25" is genuinely ambiguous without it.
 */
export const submitAgent = mutation({
  args: {
    tokenId: v.string(),
    contractAddress: v.optional(v.string()),
    /** Free text from the submitter. Recorded, never trusted as evidence. */
    note: v.optional(v.string()),
  },
  handler: async (ctx, { tokenId, contractAddress, note }) => {
    const trimmed = tokenId.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `"${tokenId}" is not an ERC-8004 token id. Submit the numeric token id of the agent's identity NFT.`,
      );
    }

    const registryAddress = (contractAddress ?? ERC8004_IDENTITY_REGISTRY).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress)) {
      throw new Error(`"${contractAddress}" is not a contract address.`);
    }

    const submittedAt = new Date().toISOString();

    const existing = await ctx.db
      .query("agentCandidates")
      .withIndex("by_agent", (q) =>
        q
          .eq("chainId", BSC_CHAIN_ID)
          .eq("registryAddress", registryAddress)
          .eq("tokenId", trimmed),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        submittedAt,
        // An already-rejected agent is re-opened by a submission: the publisher
        // may have edited their registration since it was judged. It is
        // re-evaluated on the same bar, not admitted on the strength of asking.
        ...(existing.status === "published"
          ? {}
          : {
              status: "pending" as const,
              statusReason:
                "Submitted by a publisher and re-queued for evaluation. A submission does not change the bar; it changes the queue position.",
              lastDeepEvaluatedAt: null,
            }),
      });
    } else {
      await ctx.db.insert("agentCandidates", {
        chainId: BSC_CHAIN_ID,
        registryAddress,
        tokenId: trimmed,
        status: "pending",
        statusReason:
          "Submitted by a publisher. Awaiting the same classification, cross-check and live endpoint probe every swept agent goes through.",
        source: "submission",
        // Filled in by the scheduled action below from 8004scan's own record -
        // deliberately NOT taken from the submitter, who is not a source.
        name: "",
        description: "",
        scanIconUrl: null,
        ownerAddress: "",
        registeredAt: null,
        x402Supported: null,
        prefilterRule: null,
        category: null,
        confidence: null,
        score: null,
        runnerUpCategory: null,
        runnerUpScore: null,
        matchedTerms: [],
        classificationEvidence: note ? [`submitter note (not evidence): ${note}`] : [],
        shortfall: null,
        crossCheckState: null,
        crossCheckTokenUri: null,
        crossCheckDrift: null,
        livenessState: null,
        livenessProtocol: null,
        livenessUrl: null,
        livenessDetail: null,
        livenessCheckedAt: null,
        consecutiveProbeFailures: 0,
        manualOverride: null,
        submittedAt,
        firstSeenAt: submittedAt,
        lastSeenAt: submittedAt,
        lastEvaluatedAt: submittedAt,
        lastDeepEvaluatedAt: null,
      });
    }

    // A mutation cannot make a network call, so the evaluation is scheduled. It
    // starts within a second, which is why the honest answer to return right now
    // is "under review" rather than any verdict.
    await ctx.scheduler.runAfter(0, internal.agentSubmissions.evaluateSubmission, {
      tokenId: trimmed,
      registryAddress,
    });

    return {
      tokenId: trimmed,
      registryAddress,
      state: "under-review" as SubmissionState,
      reason:
        "Under review. Dolphin is now reading this agent's own registration file, classifying it, and calling its advertised endpoint to confirm it responds. It appears in the catalog only if it lands in one of the browsable categories with a confirmed classification and a live endpoint.",
      checkStatusWith: "agentSubmissions.getSubmissionStatus",
    };
  },
});

/**
 * Fills the candidate row in from 8004scan's own record, then runs the standard
 * deep evaluation over it. Split out of the mutation because both steps need
 * the network.
 */
export const evaluateSubmission = internalAction({
  args: { tokenId: v.string(), registryAddress: v.string() },
  handler: async (ctx, { tokenId }): Promise<{ tokenId: string; hydrated: boolean }> => {
    let hydrated = false;

    try {
      const response = await fetch(
        `${AGENTS_URL}/${BSC_CHAIN_ID}/${encodeURIComponent(tokenId)}`,
        { headers: scan8004Headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (response.ok) {
        const payload = (await response.json()) as Record<string, unknown>;
        const data = (
          typeof payload.data === "object" && payload.data !== null ? payload.data : payload
        ) as Record<string, unknown>;

        const str = (key: string) =>
          typeof data[key] === "string" && (data[key] as string).trim().length > 0
            ? (data[key] as string).trim()
            : null;

        await ctx.runMutation(internal.agentSubmissions.hydrateSubmission, {
          tokenId,
          name: str("name") ?? "",
          description: str("description") ?? "",
          scanIconUrl: str("image_url"),
          ownerAddress: str("owner_address") ?? "",
          registeredAt: str("created_at"),
          x402Supported: typeof data.x402_supported === "boolean" ? data.x402_supported : null,
        });
        hydrated = true;
      }
    } catch {
      // 8004scan not answering is not fatal: the deep evaluation reads the
      // agent's own registration file on-chain regardless, which is the more
      // authoritative source anyway.
    }

    await ctx.runAction(internal.discoveryPipeline.deepEvaluate, { tokenIds: [tokenId] });
    return { tokenId, hydrated };
  },
});

export const hydrateSubmission = internalMutation({
  args: {
    tokenId: v.string(),
    name: v.string(),
    description: v.string(),
    scanIconUrl: v.union(v.string(), v.null()),
    ownerAddress: v.string(),
    registeredAt: v.union(v.string(), v.null()),
    x402Supported: v.union(v.boolean(), v.null()),
  },
  handler: async (ctx, { tokenId, ...fields }) => {
    const row = await ctx.db
      .query("agentCandidates")
      .withIndex("by_token", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      name: fields.name || row.name,
      description: fields.description || row.description,
      scanIconUrl: fields.scanIconUrl ?? row.scanIconUrl,
      ownerAddress: fields.ownerAddress || row.ownerAddress,
      registeredAt: fields.registeredAt ?? row.registeredAt,
      x402Supported: fields.x402Supported,
    });
  },
});

/**
 * What a submitter is told. Every branch returns the pipeline's own recorded
 * reason, so the answer is the real one rather than a summary written to sound
 * reassuring.
 */
export const getSubmissionStatus = query({
  args: { tokenId: v.string(), contractAddress: v.optional(v.string()) },
  handler: async (ctx, { tokenId, contractAddress }) => {
    const registryAddress = (contractAddress ?? ERC8004_IDENTITY_REGISTRY).trim();
    const row = await ctx.db
      .query("agentCandidates")
      .withIndex("by_agent", (q) =>
        q
          .eq("chainId", BSC_CHAIN_ID)
          .eq("registryAddress", registryAddress)
          .eq("tokenId", tokenId.trim()),
      )
      .unique();

    if (!row) {
      return {
        tokenId,
        state: "unknown" as SubmissionState,
        reason: "Dolphin has no evaluation record for this token id. Submit it with agentSubmissions.submitAgent.",
        category: null,
        confidence: null,
        liveness: null,
        lastEvaluatedAt: null,
      };
    }

    const state: SubmissionState =
      row.status === "published"
        ? "listed"
        : row.lastDeepEvaluatedAt === null
          ? "under-review"
          : row.status === "pending"
            ? "held-pending"
            : "not-listed";

    return {
      tokenId: row.tokenId,
      state,
      reason: row.statusReason,
      category: row.category,
      confidence: row.confidence,
      liveness: row.livenessState,
      livenessDetail: row.livenessDetail,
      shortfall: row.shortfall,
      lastEvaluatedAt: row.lastDeepEvaluatedAt,
    };
  },
});

/** Manual trigger, so the submission path can be exercised end to end by hand. */
export const evaluateSubmissionNow = action({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }): Promise<{ tokenId: string; hydrated: boolean }> =>
    ctx.runAction(internal.agentSubmissions.evaluateSubmission, {
      tokenId,
      registryAddress: ERC8004_IDENTITY_REGISTRY,
    }),
});
