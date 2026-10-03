import assert from "node:assert/strict";
import { test } from "node:test";

import { chatCompletion, forgetRestingKeys, OpenRouterError } from "../convex/lib/openrouter";

/**
 * Dolphin's keys, one at a time (owner, 2026-10-03). OpenRouter is faked: each key's reply
 * is scripted, and every request records which key sent it.
 */
type Reply = { status: number; body: unknown };
function fakeOpenRouter(script: Record<string, Reply[]>) {
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    const secret = (init?.headers?.authorization ?? "").replace("Bearer ", "");
    sent.push(secret);
    const reply = script[secret]?.shift() ?? { status: 500, body: { error: { message: "unscripted" } } };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = realFetch) };
}

const answer = (content: string): Reply => ({ status: 200, body: { model: "m", choices: [{ message: { content }, finish_reason: "stop" }] } });
const dailyCap: Reply = { status: 429, body: { error: { code: 429, message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day" } } };
const upstream: Reply = { status: 429, body: { error: { code: 429, message: "Provider returned error", metadata: { raw: "nvidia/nemotron is temporarily rate-limited upstream. Please retry shortly." } } } };

function withKeys(keys: Record<string, string>) {
  forgetRestingKeys();
  const before = { ...process.env };
  for (const name of ["OPENROUTER_API_KEY", ...Array.from({ length: 8 }, (_, i) => `OPENROUTER_API_KEY_${i + 2}`)]) delete process.env[name];
  Object.assign(process.env, keys);
  return () => {
    for (const name of Object.keys(keys)) delete process.env[name];
    Object.assign(process.env, before);
  };
}

test("one request goes to one key; a key out for the day hands the request to the next, and stays skipped", async () => {
  const restoreEnv = withKeys({ OPENROUTER_API_KEY: "k1", OPENROUTER_API_KEY_2: "k2", OPENROUTER_API_KEY_3: "k3" });
  const fake = fakeOpenRouter({ k1: [dailyCap], k2: [answer("first"), answer("second")] });
  const counted: string[] = [];
  const ledger = async (name: string) => void counted.push(name);
  try {
    const first = await chatCompletion({ messages: [{ role: "user", content: "hi" }], ledger });
    assert.equal(first.content, "first");
    assert.equal(first.keyName, "OPENROUTER_API_KEY_2");
    assert.deepEqual(fake.sent, ["k1", "k2"]);
    // Each key is charged only for what it sent.
    assert.deepEqual(counted, ["OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2"]);

    // Key 1 rests until midnight UTC: the next request goes straight to key 2, never to all three.
    const second = await chatCompletion({ messages: [{ role: "user", content: "again" }], ledger });
    assert.equal(second.content, "second");
    assert.deepEqual(fake.sent, ["k1", "k2", "k2"]);
    assert.ok(!fake.sent.includes("k3"));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a model busy upstream is not 'out of answers', and does not burn the other keys", async () => {
  const restoreEnv = withKeys({ OPENROUTER_API_KEY: "u1", OPENROUTER_API_KEY_2: "u2" });
  // Three tries (the transient retry), all on the first key.
  const fake = fakeOpenRouter({ u1: [upstream, upstream, upstream] });
  try {
    await assert.rejects(
      chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
      (error: unknown) => error instanceof OpenRouterError && !error.isRateLimit && /busy upstream/.test(error.message),
    );
    assert.ok(fake.sent.every((secret) => secret === "u1"));
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("every key out for the day: a rate limit naming how many keys were tried", async () => {
  const restoreEnv = withKeys({ OPENROUTER_API_KEY: "d1", OPENROUTER_API_KEY_2: "d2" });
  const fake = fakeOpenRouter({ d1: [dailyCap], d2: [dailyCap] });
  try {
    await assert.rejects(
      chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
      (error: unknown) => error instanceof OpenRouterError && error.isRateLimit && /all 2 of its keys/.test(error.message),
    );
    assert.deepEqual(fake.sent, ["d1", "d2"]);
  } finally {
    fake.restore();
    restoreEnv();
  }
});

test("a free model that never answers is given up on, and the retry goes to the next model in the chain", async () => {
  const restoreEnv = withKeys({ OPENROUTER_API_KEY: "k1" });
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const model = (JSON.parse(init?.body ?? "{}") as { model: string }).model;
    asked.push(model);
    if (asked.length === 1) {
      // The first model accepts the request and never answers: only the time limit ends it.
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("The signal has been aborted"))));
    }
    return new Response(JSON.stringify({ model, choices: [{ message: { content: "built" }, finish_reason: "stop" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await chatCompletion({ messages: [{ role: "user", content: "build" }], timeoutMs: 50 });
    assert.equal(result.content, "built");
    assert.equal(asked.length, 2);
    assert.notEqual(asked[1], asked[0], "the retry asks a different model, not the stalled one");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv();
  }
});
