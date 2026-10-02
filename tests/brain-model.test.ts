/**
 * A Brain's model must belong to its provider (convex/lib/openrouter.ts). Run:
 *   npx tsx --test tests/brain-model.test.ts
 * The case that prompted it (2026-10-02): an OpenRouter id saved under OpenAI,
 * and every run failed with "invalid model ID".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { modelProviderMismatch } from "../convex/lib/openrouter";

describe("modelProviderMismatch", () => {
  it("refuses an OpenRouter id under OpenAI, and says which provider to pick", () => {
    assert.match(modelProviderMismatch("openai", "nvidia/nemotron-3-ultra-550b-a55b:free") ?? "", /Choose OpenRouter/);
  });
  it("accepts each provider's own ids", () => {
    assert.equal(modelProviderMismatch("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"), null);
    assert.equal(modelProviderMismatch("openai", "gpt-4o-mini"), null);
    assert.equal(modelProviderMismatch("anthropic", "claude-haiku-4-5-20251001"), null);
    assert.equal(modelProviderMismatch("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo"), null);
  });
  it("refuses a bare id under OpenRouter and a non-Claude id under Anthropic", () => {
    assert.ok(modelProviderMismatch("openrouter", "gpt-4o-mini"));
    assert.ok(modelProviderMismatch("anthropic", "gpt-4o"));
  });
});
