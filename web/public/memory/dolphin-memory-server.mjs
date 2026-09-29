#!/usr/bin/env node
/**
 * Dolphin memory server - a one-file home for your agents' memory.
 *
 * Dolphin never keeps your agent's memory. Run this on any server you
 * control (a VPS, a home server, a cloud VM) and point your agent's Memory
 * block at it. It speaks the Dolphin Memory Interface v1:
 *
 *   POST /remember  { "agent": "...", "text": "...", "kind": "note" | "run" }  -> { "ok": true }
 *   POST /recall    { "agent": "...", "limit": 12, "query": "optional" }      -> { "memories": [{ "text", "at" }] }
 *
 * Run it (Node 18 or newer, no packages needed):
 *
 *   DOLPHIN_MEMORY_TOKEN=pick-a-long-secret node dolphin-memory-server.mjs
 *
 * It listens on port 8787 (set PORT to change it) and writes one file per
 * agent under ./dolphin-memory/. Put it behind HTTPS - Dolphin only talks to
 * https:// addresses - for example with Caddy:  caddy reverse-proxy --to :8787
 *
 * Then, in Dolphin: add the token to your Keys (e.g. MEMORY_TOKEN), add a
 * Memory block, enter your https address and choose that key.
 */

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TOKEN = process.env.DOLPHIN_MEMORY_TOKEN;
const PORT = Number(process.env.PORT || 8787);
const DIR = process.env.DOLPHIN_MEMORY_DIR || "./dolphin-memory";
const MAX_TEXT = 1000;
const MAX_PER_AGENT = 5000;

if (!TOKEN || TOKEN.length < 16) {
  console.error("Set DOLPHIN_MEMORY_TOKEN to a secret of at least 16 characters.");
  process.exit(1);
}
await mkdir(DIR, { recursive: true });

const fileFor = (agent) => join(DIR, `${String(agent).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}.jsonl`);

async function readAll(agent) {
  try {
    const raw = await readFile(fileFor(agent), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "bad token" });
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) return send(res, 413, { error: "too large" });
  }
  let input;
  try {
    input = JSON.parse(body || "{}");
  } catch {
    return send(res, 400, { error: "not JSON" });
  }
  if (typeof input.agent !== "string" || !input.agent) return send(res, 400, { error: "agent is required" });

  if (req.url === "/remember") {
    const text = String(input.text ?? "").trim().slice(0, MAX_TEXT);
    if (!text) return send(res, 400, { error: "text is required" });
    const row = { text, kind: input.kind === "run" ? "run" : "note", at: new Date().toISOString() };
    await appendFile(fileFor(input.agent), `${JSON.stringify(row)}\n`);
    const all = await readAll(input.agent);
    if (all.length > MAX_PER_AGENT) {
      await writeFile(fileFor(input.agent), all.slice(-MAX_PER_AGENT).map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return send(res, 200, { ok: true });
  }

  if (req.url === "/recall") {
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 12));
    const words = String(input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    let rows = await readAll(input.agent);
    if (words.length) rows = rows.filter((row) => words.some((word) => row.text.toLowerCase().includes(word)));
    return send(res, 200, { memories: rows.slice(-limit).map(({ text, at }) => ({ text, at })) });
  }

  send(res, 404, { error: "use /remember or /recall" });
}).listen(PORT, () => console.log(`Dolphin memory server on :${PORT}, writing to ${DIR}`));
