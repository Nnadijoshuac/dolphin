/**
 * WHICH PROVIDER A KEY BELONGS TO, AND ITS MODELS. (owner, 2026-09-28: "when
 * you are choosing a key, why do we need to know if it's OpenRouter or
 * whatever? From the key, can't we tell?")
 *
 * The builder picks one of their saved keys; this reads it (decrypted here,
 * in an action, never returned), works out the provider, and lists that
 * provider's models for the Brain panel's picker.
 *
 * NEVER SPRAY A KEY. Sending someone's OpenAI key to DeepSeek to "see if it
 * works" would hand a secret to a third party. So:
 *   - a prefix that identifies its provider decides alone, with no request;
 *   - an ambiguous key is tried ONLY against the providers its shape fits
 *     (a bare `sk-` key: DeepSeek or OpenAI), one at a time;
 *   - a shape that fits none is not probed at all - the builder chooses.
 * Every model-list endpoint below answered as itself on 2026-09-28.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { BRAIN_PROVIDERS, type BrainProvider } from "./lib/openrouter";

const MODEL_LISTS: Partial<Record<BrainProvider, string>> = {
  openai: "https://api.openai.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/models",
  groq: "https://api.groq.com/openai/v1/models",
  deepseek: "https://api.deepseek.com/models",
  mistral: "https://api.mistral.ai/v1/models",
  xai: "https://api.x.ai/v1/models",
  together: "https://api.together.xyz/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
};

/** Not chat models: skipped so the picker offers only what a Brain can use. */
const NOT_CHAT = /embed|whisper|tts|dall-e|image|moderation|audio|transcri|realtime|rerank|vision-preview|search-preview|davinci|babbage|guard/i;

/** The providers a key's shape can belong to, most likely first. Empty: do not probe. */
export function candidatesFor(key: string): BrainProvider[] {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return ["anthropic"];
  if (k.startsWith("sk-or-")) return ["openrouter"];
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-") || k.startsWith("sk-admin-")) return ["openai"];
  if (k.startsWith("gsk_")) return ["groq"];
  if (k.startsWith("xai-")) return ["xai"];
  if (k.startsWith("AIza")) return ["google"];
  if (k.startsWith("fw_")) return ["fireworks"];
  if (/^sk-[0-9a-f]{32}$/i.test(k)) return ["deepseek", "openai"];
  if (k.startsWith("sk-")) return ["openai", "deepseek"];
  if (/^[0-9a-f]{64}$/i.test(k)) return ["together"];
  if (/^[A-Za-z0-9]{32}$/.test(k)) return ["mistral"];
  return [];
}

async function listModels(provider: BrainProvider, key: string): Promise<string[] | null> {
  if (provider === "anthropic") {
    try {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10_000 });
      const ids: string[] = [];
      for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
      return ids;
    } catch {
      return null;
    }
  }
  const url = MODEL_LISTS[provider];
  if (!url) return null;
  try {
    // OpenRouter's list is public; its key is checked on /key first.
    if (provider === "openrouter") {
      const check = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!check.ok) return null;
    }
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>;
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

export const detect = action({
  args: { sessionToken: v.string(), keyName: v.string(), provider: v.optional(v.string()) },
  handler: async (
    ctx,
    { sessionToken, keyName, provider },
  ): Promise<{ provider: BrainProvider | null; label: string | null; models: string[]; note: string | null }> => {
    const walletAddress: string = await ctx.runQuery(internal.envVars.walletFor, { sessionToken });
    const key: string | null = await ctx.runAction(internal.envVars.reveal, { walletAddress, name: keyName });
    if (!key) throw new ConvexError(`You have no key called ${keyName}.`);

    // The builder named the provider: list its models with that key only.
    const forced = provider && provider !== "custom" && provider in BRAIN_PROVIDERS ? (provider as BrainProvider) : null;
    const candidates = forced ? [forced] : candidatesFor(key);
    if (candidates.length === 0) {
      return { provider: null, label: null, models: [], note: "This key's format does not say which provider it is for. Choose the provider." };
    }
    for (const candidate of candidates) {
      const models = await listModels(candidate, key);
      if (models) {
        const chat = models.filter((id) => !NOT_CHAT.test(id)).sort((a, b) => a.localeCompare(b));
        return { provider: candidate, label: BRAIN_PROVIDERS[candidate].label, models: chat.slice(0, 400), note: null };
      }
    }
    return {
      provider: forced,
      label: forced ? BRAIN_PROVIDERS[forced].label : null,
      models: [],
      note: forced
        ? `${BRAIN_PROVIDERS[forced].label} did not accept this key, or could not list its models. You can still type a model id.`
        : candidates.length === 1
          ? `This looks like ${/^[AEIOU]/.test(BRAIN_PROVIDERS[candidates[0]].label) ? "an" : "a"} ${BRAIN_PROVIDERS[candidates[0]].label} key, but ${BRAIN_PROVIDERS[candidates[0]].label} did not accept it. Check the key.`
          : "No provider this key's format fits accepted it. Check the key, or choose the provider.",
    };
  },
});
