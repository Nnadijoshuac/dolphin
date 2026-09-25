/**
 * THE USAGE TERM OF `rank`: what real, paying users did with an agent.
 *
 * ---------------------------------------------------------------------------
 * WHY (2026-09-25)
 * ---------------------------------------------------------------------------
 * lib/rank.ts orders the catalog on facts the PROBE can see - a payable quote,
 * skills, on-chain feedback, a verified domain. Nothing a user did with an
 * agent reached the order at all, though Dolphin records every hire, every
 * escrow job and every review. A store ranks on what people do with what it
 * sells. This adds that, as a term `rank` carries beside its base.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MAY TRUST, AND WHY IT IS BUILT TO BE HARD TO GAME
 * ---------------------------------------------------------------------------
 * Ranking is a prize, and Set and Earn excludes sybil and wash activity. So:
 *
 *  1. WALLET-BACKED ONLY. Inputs come from agentHires, agentJobs and
 *     agentReviews, each written behind a signed-in wallet or read back off the
 *     chain. The anonymous engagement counters (convex/engagement.ts) are
 *     deliberately NOT inputs: anyone can increment them.
 *  2. DISTINCT WALLETS, not events. One wallet hiring an agent fifty times is
 *     one hirer.
 *  3. MONEY WEIGHS MORE. A paid hire went through an ERC-8183 escrow and cost
 *     real funds; a free hire costs a signature. Reviews tied to a paid hire
 *     count fully, others at FREE_REVIEW_WEIGHT, and retention is measured over
 *     paying hirers only. Measured on the scenario check: at half weight, 30
 *     free sybil wallets scored 300 against 326 for five real paying users.
 *  4. SHRUNK TOWARDS A PRIOR. Rates are Bayesian averages that start at a
 *     neutral value and move only with volume, so three enthusiastic reviews
 *     cannot put an agent on top, and one bad one cannot bury it.
 *  5. NO SELF-DEALING. The caller removes the agent's own owner and payee
 *     wallets, and Dolphin's team wallets, before anything is counted.
 *  6. IT CAN GO NEGATIVE. Consistently poor delivery pushes an agent DOWN.
 *
 * Like `rank`, this is shelf position, never a displayed score.
 */

export interface UsageInput {
  /** Distinct wallets that hired it, after exclusions. */
  hirers: number;
  /** Of those, distinct wallets whose hire was paid through escrow. */
  paidHirers: number;
  /** Of the PAYING hirers, distinct wallets still running their hire. */
  retainedPaidHirers: number;
  /** Distinct paying wallets with a job the kernel reads as COMPLETED. */
  completedJobs: number;
  /** Review weight: 1 per paid-hire review, FREE_REVIEW_WEIGHT per free-hire review. */
  reviewWeight: number;
  /** Weighted "would hire again" answers. */
  wouldHireAgainWeight: number;
  /** Weighted delivery: outcome "yes" = 1, "partially" = 0.5, "no" = 0. */
  deliveredWeight: number;
}

/** What a review from a hire that paid nothing is worth, against 1 for a paid one. */
export const FREE_REVIEW_WEIGHT = 0.2;

/** Neutral starting points and how many observations each is worth. */
const PRIORS = {
  wouldHireAgain: { mean: 0.7, strength: 5 },
  delivered: { mean: 0.75, strength: 5 },
  retention: { mean: 0.6, strength: 5 },
} as const;

function saturate(value: number, scale: number, cap: number): number {
  if (value <= 0) return 0;
  return cap * (1 - Math.exp(-value / scale));
}

function shrunk(successes: number, trials: number, prior: { mean: number; strength: number }): number {
  return (successes + prior.mean * prior.strength) / (trials + prior.strength);
}

export function computeUsageRank(input: UsageInput): number {
  let score = 0;

  // Adoption. Free hires are cheap to fake, so this is capped low and grows slowly.
  score += saturate(input.hirers, 6, 60);
  // Paid adoption: real money through escrow. The strongest single signal.
  score += saturate(input.paidHirers, 3, 160);
  // It finished the work it was paid for, as the kernel records it.
  score += saturate(input.completedJobs, 3, 120);

  // Would they hire it again? Max +150, and down to -200 for an agent people regret.
  const again = shrunk(input.wouldHireAgainWeight, input.reviewWeight, PRIORS.wouldHireAgain);
  score += Math.max(-200, (again - PRIORS.wouldHireAgain.mean) * 500);

  // Did it do what it said? Max +75, down to -150.
  const delivered = shrunk(input.deliveredWeight, input.reviewWeight, PRIORS.delivered);
  score += Math.max(-150, (delivered - PRIORS.delivered.mean) * 300);

  // Do paying people keep it running? Free hires are not evidence here: keeping
  // a free hire open costs nothing.
  if (input.paidHirers > 0) {
    const retained = shrunk(input.retainedPaidHirers, input.paidHirers, PRIORS.retention);
    score += (retained - PRIORS.retention.mean) * 150;
  }

  return Math.round(score);
}

/** Wallets whose activity never counts: the agent's own, and Dolphin's team. */
export function excludedWallets(
  agent: { ownerAddress: string; agentWallet: string | null },
  teamWallets: readonly string[],
): Set<string> {
  const excluded = new Set(teamWallets.map((w) => w.toLowerCase()));
  excluded.add(agent.ownerAddress.toLowerCase());
  if (agent.agentWallet) excluded.add(agent.agentWallet.toLowerCase());
  return excluded;
}

/** Parses DOLPHIN_TEAM_WALLETS: comma or whitespace separated addresses. */
export function parseTeamWallets(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w));
}
