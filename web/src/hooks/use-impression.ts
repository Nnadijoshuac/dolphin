"use client";

import { useEffect, useRef } from "react";

import { recordImpression } from "@/lib/engagement-sink";

/** Half the card on screen, for long enough to have been looked at. */
const VISIBLE_FRACTION = 0.5;
const DWELL_MS = 600;

/**
 * Counts that an agent's card was actually SEEN - on screen, not merely
 * rendered below the fold. Attach the returned ref to the card's root.
 *
 * An impression is the denominator every other funnel number is read against:
 * "opened by 3 people" means nothing until it is "opened by 3 of 400 who saw it".
 */
export function useImpression<T extends Element>(agentKey: string) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          dwell ??= setTimeout(() => {
            recordImpression(agentKey);
            observer.disconnect();
          }, DWELL_MS);
        } else if (dwell) {
          clearTimeout(dwell);
          dwell = null;
        }
      },
      { threshold: VISIBLE_FRACTION },
    );
    observer.observe(element);

    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [agentKey]);

  return ref;
}
