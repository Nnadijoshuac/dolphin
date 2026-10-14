/**
 * The facts the legal pages depend on, in one place (2026-09-29).
 *
 * THESE PAGES ARE NOT LEGAL ADVICE and were written without a lawyer. They
 * describe what the code actually does (Agent/BRIEF-2026-09-28-privacy-and-
 * security-policy.md) and must be reviewed by counsel before a public launch.
 *
 * Fields left null are decisions only the owner can make. Each page renders
 * an honest fallback for a null rather than inventing a value.
 */
export const LEGAL = {
  /** The trading name the pages use for the operator. */
  name: "Dolphin",
  site: "dolphinamp.xyz",
  /** Legal entity name - set once the operator's entity exists. */
  entity: null as string | null,
  /** Governing law and courts - set with counsel. */
  jurisdiction: null as string | null,
  /** An inbox for privacy and legal requests and security reports. */
  email: null as string | null,
  /**
   * The public channel that exists today. Was @dolphin_Agents on X until that
   * account was suspended (2026-10-15); a dead handle is not a way to reach us.
   */
  instagram: "https://www.instagram.com/dolphinamp/",
  instagramHandle: "@dolphinamp",
  updated: "15 October 2026",
} as const;

/** How to reach us, stated with whatever channel really exists. */
export function contactLine(): string {
  return LEGAL.email
    ? `email ${LEGAL.email}`
    : `message ${LEGAL.instagramHandle} on Instagram (a dedicated email address will be listed here)`;
}
