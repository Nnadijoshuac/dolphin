/**
 * THE FUNNEL, AS A CLOSED VOCABULARY.
 *
 * ===========================================================================
 * WHY THIS EXISTS (2026-09-08)
 * ===========================================================================
 * There was no telemetry of any kind on this site. No SDK, no events, no error
 * reporting. `grep -rniE "analytics|gtag|posthog|plausible|mixpanel|sentry"`
 * over src/ and package.json returned nothing.
 *
 * The consequence is not "we lack a dashboard". It is that no question about
 * this product has an answer: how many people opened an agent page, where they
 * stopped, whether anyone finished a hire, whether the catalog was ever
 * unreachable while a real person was looking at it. A marketplace that cannot
 * answer those is being run on assertion.
 *
 * ===========================================================================
 * THE RULE: INSTRUMENT THE PRODUCT, NOT THE PERSON
 * ===========================================================================
 * Users connect financial accounts here. AGENTS.md's honesty rule and a
 * defensible privacy posture point the same way, so this module is deliberately
 * constrained rather than general:
 *
 *  - There is NO `track(name, arbitraryObject)`. Every event is declared in
 *    `AnalyticsEvents` below with the exact properties it may carry, and
 *    TypeScript refuses anything else. Adding a property is a code review.
 *  - NO WALLET ADDRESS, ever, in any event. Not hashed, not truncated, not as
 *    a user id. An address is a pseudonymous handle on someone's entire
 *    financial history; joining it to behavioural events is the one thing this
 *    file must never make easy. `walletConnected` records THAT a wallet
 *    connected and by which connector, never which wallet.
 *  - No free text. No search QUERIES - `searchSubmitted` carries the query's
 *    length and whether it returned anything, because "are people searching and
 *    finding nothing" is the question, and the query strings themselves are the
 *    user's business.
 *  - `agentKey` IS carried. It identifies a public catalog listing, not a
 *    person, and "which agents get opened" is the core question this product
 *    exists to answer for itself.
 *
 * ===========================================================================
 * TRANSPORT
 * ===========================================================================
 * Vercel Web Analytics, because the site is already on Vercel
 * (https://dolphinamp.vercel.app), it is cookieless, it needs no consent banner
 * in most jurisdictions, and it adds no vendor. `@vercel/analytics` no-ops off
 * Vercel, so local development and CI stay silent without a branch here.
 *
 * If a funnel tool with retention cohorts is added later, change `send()` and
 * nothing else - the vocabulary above it is the durable part.
 */

import { track as vercelTrack } from "@vercel/analytics";

/** Where in the app an event happened. Kept small on purpose. */
export type AnalyticsSurface =
  | "discover"
  | "search"
  | "agent"
  | "my-agents"
  | "wallet"
  | "onboarding";

/**
 * Every event this product may emit, and every property it may carry.
 *
 * Ordered as the funnel runs, because the ORDER is the point: each one answers
 * a question that the event before it makes askable.
 */
export type AnalyticsEvents = {
  /** Someone reached the site and the catalog rendered. The denominator. */
  catalog_viewed: {
    surface: AnalyticsSurface;
    /** null while facets are still loading. */
    categoryCount: number | null;
  };
  /** A browse chip was used. Answers "does anyone browse by role, or only search". */
  category_selected: {
    surface: AnalyticsSurface;
    category: string;
    /** How many agents the chip promised, so a dead-end chip is visible. */
    count: number | null;
  };
  /** A search ran. No query text - see the privacy note above. */
  search_submitted: {
    queryLength: number;
    category: string | null;
    resultCount: number;
  };
  /** An agent record was opened. The single most important number here. */
  agent_card_opened: {
    agentKey: string;
    category: string;
    surface: AnalyticsSurface;
  };
  /** The detail page rendered. Separate from the click: the gap is drop-off. */
  agent_viewed: {
    agentKey: string;
    category: string;
    hasLiveStats: boolean;
    /** Whether this record has a chart, which is the thing being evaluated. */
    hasPerformanceSeries: boolean;
  };
  /** A wallet connected. WHICH wallet is never recorded. */
  wallet_connected: { connector: string; surface: AnalyticsSurface };
  /** Sign-In With Ethereum completed. The step between connecting and acting. */
  wallet_signed_in: { surface: AnalyticsSurface };
  /** Hire pressed. Start of the conversion event proper. */
  hire_started: { agentKey: string; category: string; requiresPayment: boolean };
  /** Hire recorded by the backend. */
  hire_completed: { agentKey: string; category: string; paid: boolean };
  /**
   * Hire did not complete, with a KIND rather than a message. Messages carry
   * user data and vendor strings; kinds are comparable across releases.
   */
  hire_failed: {
    agentKey: string;
    reason: "declined" | "price_unresolved" | "payment_outstanding" | "error";
  };
  /** A hire was ended. Retention's numerator depends on this being real. */
  hire_cancelled: { agentKey: string };
  /** The review form was opened by someone eligible to use it. */
  review_started: { agentKey: string };
  /** A review was saved to Convex. */
  review_submitted: {
    agentKey: string;
    outcome: "yes" | "partially" | "no";
    wouldHireAgain: boolean;
    hasComment: boolean;
  };
  /** A review was published to the ERC-8004 Reputation Registry. */
  review_published_onchain: { agentKey: string };
  /**
   * The backend could not be reached while a real person was looking.
   * This one exists because the site used to render "no agents" in this case
   * and nobody would ever have known.
   */
  backend_unavailable: { surface: AnalyticsSurface; reason: string };
  /** An error boundary caught a render crash. */
  render_error: { surface: string; digest: string | null };
  /** Onboarding progress, so "does anyone finish it" is answerable. */
  onboarding_step_viewed: { step: number; total: number };
  onboarding_completed: { skipped: boolean };
};

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Vercel's `track` accepts flat primitives only. This is the same constraint
 * expressed in our types, so a nested object fails at compile time here rather
 * than being silently dropped at runtime there.
 */
type Flat = Record<string, string | number | boolean | null>;

function send(name: string, properties: Flat) {
  try {
    vercelTrack(name, properties);
  } catch {
    /*
     * Telemetry must never be able to break a page. A blocked script, an
     * ad-blocker, a quota error and a server render all land here, and all of
     * them are strictly less important than the thing the user came for.
     */
  }
}

/**
 * Record one product event.
 *
 * The overload is what makes the vocabulary closed: `name` must be a key of
 * `AnalyticsEvents` and `properties` must match that key's declared shape
 * exactly. `track("agent_viewed", { walletAddress })` does not compile, which
 * is the entire point.
 */
export function track<Name extends AnalyticsEventName>(
  name: Name,
  properties: AnalyticsEvents[Name],
): void {
  send(name, properties as unknown as Flat);
}
