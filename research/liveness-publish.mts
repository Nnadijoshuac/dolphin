/**
 * Writes Dolphin's liveness chain to research/data/liveness-chain.json and
 * VERIFIES it on the way: every day's chainSha256 is recomputed from the
 * published fields, so a rewritten day fails here and for anyone who runs this.
 * Committing the file to a public repo is the timestamp nobody can edit.
 *
 *   npx tsx research/liveness-publish.mts            (reads NEXT_PUBLIC_CONVEX_URL from web/.env.local)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const url = process.env.CONVEX_URL ?? readFileSync("web/.env.local", "utf8").match(/NEXT_PUBLIC_CONVEX_URL=(.*)/)![1].trim();
type Day = { day: string; live: number; liveKeys: string[]; liveKeysSha256: string; prevChainSha256: string | null; chainSha256: string | null; takenAt: string };
const rows = ((await new ConvexHttpClient(url).query(anyApi.liveness.chain, {})) as Day[]).reverse();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let prev: string | null = null;
for (const row of rows) {
  if (sha(row.liveKeys.join("\n")) !== row.liveKeysSha256) throw new Error(`${row.day}: the live list does not match its hash`);
  if (row.prevChainSha256 !== prev) throw new Error(`${row.day}: does not link to the previous day`);
  const expected = sha(`${prev ?? "genesis"}\n${row.day}\n${row.live}\n${row.liveKeysSha256}`);
  if (expected !== row.chainSha256) throw new Error(`${row.day}: chain hash does not recompute`);
  prev = row.chainSha256;
}
writeFileSync("research/data/liveness-chain.json", `${JSON.stringify({ verifiedAt: new Date().toISOString(), days: rows }, null, 2)}\n`);
console.log(`verified ${rows.length} day(s); head ${prev}`);
