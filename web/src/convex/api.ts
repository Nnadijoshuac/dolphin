import { anyApi } from "convex/server";

import type {
  Agent,
  AgentCategory,
  AgentLiveStats,
  AgentPriceModel,
} from "@/types/agent";

/**
 * Typed handle on the Convex queries this site calls.
 *
 * WHY NOT `convex/_generated/api`. That codegen lives at the repo root, beside
 * the mobile app. Importing it from here would mean this project's build
 * reaches outside web/ and resolves the `convex` package from the ROOT
 * node_modules - so the website could not install or build from a clean clone
 * without the mobile app also being installed. Keeping the two projects
 * independently installable is a deliberate constraint of this repo (see the
 * import commit for web/), and it outranks the convenience of shared codegen.
 *
 * This is not a hand-rolled reimplementation of anything: `_generated/api.js`
 * is literally `export const api = anyApi`, so the runtime object below IS the
 * generated one. Only the type annotation is written by hand, and it declares
 * a signature, never behaviour - all the curation, taxonomy, pricing and merge
 * logic stays in convex/lib/agentCatalog.ts where both frontends read it.
 *
 * IF convex/agents.ts CHANGES the args or return shape of either query, change
 * the annotation here in the same commit. Both projects pin convex ^1.45.0.
 */
type Query<Args, Result> = {
  _type: "query";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

type Mutation<Args, Result> = {
  _type: "mutation";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

type Action<Args, Result> = {
  _type: "action";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

export const api = anyApi as unknown as {
  agents: {
    /** convex/agents.ts -> listAgents */
    listAgents: Query<Record<string, never>, Agent[]>;
    /** convex/agents.ts -> getAgent */
    getAgent: Query<{ reference: string }, Agent | null>;
  };
};

/** One agentLiveStats row - convex/categoryStats.ts's cache table. */
export interface AgentCategoryStatsRow {
  chainId: number;
  tokenId: string;
  category: AgentCategory;
  agentWallet: string | null;
  stats: AgentLiveStats;
  checkedAt: string;
}

/**
 * Kept separate from `api` above only because convex/react's `useQuery` and
 * `useAction` want the reference itself; splitting the namespaces makes the two
 * modules' call sites read the same as the mobile app's `api.categoryStats.*`.
 */
export const categoryStatsApi = anyApi as unknown as {
  categoryStats: {
    /** convex/categoryStats.ts -> getAgentCategoryStats */
    getAgentCategoryStats: Query<
      { tokenId: string; category: AgentCategory },
      AgentCategoryStatsRow | null
    >;
    /** convex/categoryStats.ts -> refreshAgentCategoryStats */
    refreshAgentCategoryStats: Action<
      { tokenId: string; category: AgentCategory; agentWallet: string | null },
      unknown
    >;
  };
};

/**
 * convex/agentHires.ts. A hire is a read-only subscription row - no signature,
 * no spend cap, no transaction. `priceModel` must be the agent's ALREADY
 * RESOLVED priceModel.value, or null; passing null makes the mutation reject
 * rather than assume free, and a non-zero price also rejects because no x402
 * seller-side integration exists. Both of those refusals are deliberate and
 * must not be worked around on the client.
 */
export const agentHiresApi = anyApi as unknown as {
  agentHires: {
    hireReadOnlyAgent: Mutation<
      {
        tokenId: string;
        category: AgentCategory;
        walletAddress: string;
        priceModel: AgentPriceModel | null;
      },
      string
    >;
    getHiredAgentsForWallet: Query<
      { walletAddress: string },
      {
        tokenId: string;
        category: AgentCategory;
        walletAddress: string;
        status: "active" | "cancelled";
        hiredAt: string;
      }[]
    >;
  };
};
