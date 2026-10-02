"use client";

import { useAction } from "convex/react";
import { useEffect, useRef } from "react";

import { agentPaymentsApi, type AgentJobRow } from "@/convex/api";

/**
 * The result a seller delivered, for a job that is delivered (2026-10-02).
 *
 * The first screen to see a delivered job without the result asks the backend
 * to fetch it (agentPayments.fetchDeliverable reads the URL from the seller's
 * submit transaction and stores the text on the job); every later view reads
 * the stored row through the job query, so this runs once per job.
 */
export function useDeliverable(job: AgentJobRow | null | undefined, delivered: boolean) {
  const fetchDeliverable = useAction(agentPaymentsApi.agentPayments.fetchDeliverable);
  const asked = useRef<string | null>(null);
  const jobId = job?.jobId ?? null;
  const have = Boolean(job?.deliverable?.content);

  useEffect(() => {
    if (!delivered || !jobId || have || asked.current === jobId) return;
    asked.current = jobId;
    void fetchDeliverable({ jobId }).catch(() => undefined);
  }, [delivered, jobId, have, fetchDeliverable]);

  return job?.deliverable ?? null;
}
