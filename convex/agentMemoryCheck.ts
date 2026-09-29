/**
 * "Test connection" for the Memory block: one recall against the builder's
 * own memory server, with their own key, before they rely on it. Nothing is
 * written - to their server or to Dolphin's database.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { recall } from "./lib/agentMemory";

export const test = action({
  args: { sessionToken: v.string(), url: v.string(), keyName: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken, url, keyName }): Promise<{ ok: boolean; text: string }> => {
    const walletAddress: string = await ctx.runQuery(internal.envVars.walletFor, { sessionToken });
    const key: string | null = keyName ? await ctx.runAction(internal.envVars.reveal, { walletAddress, name: keyName }) : null;
    if (keyName && !key) return { ok: false, text: `You have no key called ${keyName}.` };
    try {
      const memories = await recall({ url: url.trim(), key, agent: "dolphin-connection-test" }, { limit: 1 });
      return { ok: true, text: `Connected. The server answered${memories.length ? " with a memory" : ", with no memories yet"}.` };
    } catch (cause) {
      return { ok: false, text: `Not connected: ${cause instanceof Error ? cause.message : String(cause)}.` };
    }
  },
});
