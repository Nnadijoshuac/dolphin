/**
 * Review constants mirrored by hand from convex/agentReviews.ts.
 *
 * AGENTS.md SS9's manual-mirror rule: the website cannot import from the repo
 * root's Convex modules without breaking its clean-install guarantee (see the
 * note at the top of src/convex/api.ts), so these are written twice. CHANGE
 * BOTH IN ONE COMMIT.
 *
 * The cap is enforced server-side regardless; this copy exists so the textarea
 * stops at the same number rather than letting someone write 400 characters and
 * lose 120 of them on submit.
 */

/** convex/agentReviews.ts -> REVIEW_COMMENT_MAX_LENGTH */
export const REVIEW_COMMENT_MAX_LENGTH = 280;

/**
 * convex/agentReviews.ts -> MIN_REVIEW_AGE_MS. 24 hours.
 *
 * Not used to gate anything here - the backend does that and returns the real
 * reason - but kept so the copy on this side can say "a day" without inventing
 * a number.
 */
export const MIN_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * convex/agentReviews.ts and convex/agentRetention.ts -> MIN_DENOMINATOR.
 *
 * Below this many reviews (or eligible hires) a percentage is not computed at
 * all: "100% would hire again" over one review is true arithmetic and a false
 * impression. Both backends return `null` instead, and a caller that gets null
 * must render counts. This constant exists so the UI can EXPLAIN the null
 * rather than silently showing nothing.
 */
export const MIN_RATE_DENOMINATOR = 5;
