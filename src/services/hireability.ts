import type { Agent } from "@/types/agent";

/**
 * Whether an agent can actually be hired, and if not, why not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-06)
 * ---------------------------------------------------------------------------
 * Every agent in the catalog was offered a "Hire — Free" button. Tapping it
 * wrote a row in Convex and did nothing else: no agent was contacted, no work
 * was commissioned, nothing was delivered. The My Agents screen then said so
 * itself, in a banner, after the fact - "not yet wired to live activity".
 *
 * That is a checkout that prints a receipt reading "this receipt is not for
 * anything", and offering it uniformly hid the far more interesting truth:
 * SOME of these agents really do sell work, over a real on-chain escrow, and
 * Dolphin can really buy it (convex/agentPayments.ts, and the payment and
 * delivery cards that already existed for it).
 *
 * So hireability stops being universal and becomes a property of the agent,
 * stated on its page. An agent that can be hired gets the real flow. An agent
 * that cannot is said to not be hireable yet, with the specific reason, instead
 * of being given a button that resolves to nothing.
 *
 * ---------------------------------------------------------------------------
 * THESE CONDITIONS MIRROR THE BACKEND'S OWN REFUSALS, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `requestQuote` in convex/agentPayments.ts refuses in exactly two cases: no
 * registered `agentWallet` (nothing to check the payee against), and no callable
 * A2A endpoint (nobody to ask for a price). This function must agree with it
 * field for field, because a disagreement means offering a button that always
 * errors - the same reason `canNegotiate` in wallet/erc8183-policy.ts is
 * documented as having to agree with `selectNegotiationEndpoint`.
 *
 * If the backend's conditions change, change these in the same commit.
 */

export type Hireability =
  | {
      hireable: true;
      /** The A2A endpoint a quote will be requested from. */
      endpoint: string;
    }
  | {
      hireable: false;
      /** What is missing, in a sentence a non-technical reader can act on. */
      reason: string;
      /** Who would have to do something about it. Never implies Dolphin will. */
      nextStep: string;
    };

/**
 * The endpoint a quote would go to, or null.
 *
 * Mirrors `selectNegotiationEndpoint` in convex/lib/erc8183.ts. The two
 * exclusions are the same and for the same reasons: only A2A speaks this
 * protocol, and an endpoint still carrying an un-substituted `{agentId}`
 * template is not a URL anyone can call.
 */
export function negotiationEndpoint(
  services: readonly { name: string; endpoint: string }[],
): string | null {
  const match = services.find(
    (service) => service.name === "a2a" && !service.endpoint.includes("{"),
  );
  return match?.endpoint ?? null;
}

export function assessHireability(
  agent: Pick<Agent, "services" | "agentWallet" | "name">,
): Hireability {
  const endpoint = negotiationEndpoint(agent.services);

  if (endpoint === null) {
    return {
      hireable: false,
      reason:
        "This agent has not published a service endpoint, so there is no way to ask it for a price or to send it work. Its registry identity is real; what is missing is a way to reach it.",
      nextStep:
        "Its publisher would need to register an A2A endpoint in the ERC-8004 record. Dolphin cannot supply one on their behalf.",
    };
  }

  if (!agent.agentWallet) {
    return {
      hireable: false,
      reason:
        "This agent publishes an endpoint but has no wallet in its on-chain registry record, so Dolphin cannot check who a payment would actually go to.",
      nextStep:
        "Dolphin will not send money to an unverified payee. Its publisher would need to register the agent's wallet on-chain.",
    };
  }

  return { hireable: true, endpoint };
}

/**
 * The catalog's hireable subset.
 *
 * Note what this is NOT used for: it is not a filter on browsing. A
 * non-hireable agent is still a real registry identity worth reading about, and
 * hiding it would make the marketplace look fuller than it is - which is the
 * opposite of the point. This exists for counting and for honest headline copy.
 */
export function hireableAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter((agent) => assessHireability(agent).hireable);
}

/**
 * Hireable agents first, original order preserved within each group.
 *
 * A stable partition rather than a sort key, so the catalog's own ordering
 * (which carries curation and category intent) survives inside each half. The
 * only thing being asserted is that an agent you can actually hire should not
 * sit below one you cannot.
 *
 * This does NOT hide anything. A non-hireable agent is a real registry identity
 * and stays in the list, marked - see the note on hireableAgents above for why
 * filtering the catalog down to what is purchasable would make the marketplace
 * look fuller than it is rather than more honest.
 */
export function sortHireableFirst(agents: readonly Agent[]): Agent[] {
  const hireable: Agent[] = [];
  const rest: Agent[] = [];
  for (const agent of agents) {
    (assessHireability(agent).hireable ? hireable : rest).push(agent);
  }
  return [...hireable, ...rest];
}
