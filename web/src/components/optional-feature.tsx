"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * ===========================================================================
 * AN OPTIONAL PANEL MUST NOT BE ABLE TO TAKE DOWN THE PAGE IT SITS ON
 * ===========================================================================
 * WHAT HAPPENED (2026-09-12). The liquidation-alert panel was added to the
 * wallet screen in the same change as the Convex functions behind it. The
 * functions were code-generated but not DEPLOYED, so `useQuery` on
 * `healthAlerts:alertsAvailable` threw:
 *
 *     Could not find public function for 'healthAlerts:alertsAvailable'
 *
 * and the entire /wallet route went to a runtime error screen. Not the panel -
 * the route. Someone trying to read their balance lost the whole page because
 * an unrelated opt-in feature was a deploy behind.
 *
 * That skew is not an edge case, it is the normal state of a two-deployment
 * product for the minutes between pushing the frontend and pushing the
 * backend, and it happens on every preview branch that points at a production
 * Convex deployment.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RENDERS NOTHING RATHER THAN AN ERROR
 * ---------------------------------------------------------------------------
 * This is for genuinely OPTIONAL surfaces: an extra panel a page is complete
 * without. For those, a visible "something went wrong" box is worse than an
 * absence - it tells the user about a failure they cannot act on, in the
 * middle of a screen about their money.
 *
 * Do NOT wrap load-bearing UI in this. A catalog that fails to load must say
 * so - `backend-status.tsx` exists for exactly that, and it distinguishes
 * "unreachable" from "empty" on purpose. Silence is the right answer only when
 * the feature's absence is itself a valid state.
 *
 * The failure is always logged, so a silent panel is not a silent bug.
 */
export class OptionalFeature extends Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /*
     * console.error rather than the analytics module on purpose: lib/analytics
     * is a CLOSED vocabulary of declared events (see its header), and adding a
     * free-text error channel to it would be the hole through which arbitrary
     * strings - eventually including user data - reach a third party.
     */
    console.error(
      `[OptionalFeature] "${this.props.label}" failed and was hidden.`,
      error,
      info.componentStack,
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
