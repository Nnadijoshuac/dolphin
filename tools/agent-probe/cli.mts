#!/usr/bin/env node
/**
 * agent-probe - is this on-chain agent actually alive?
 *
 * The same probe Dolphin runs on every agent it lists (convex/lib/probe.ts),
 * as a command anyone can run. It sends exactly what a first hire would send
 * - an A2A `negotiate` call, or an MCP `initialize` + `tools/list` - and
 * reports what came back. No key, no account, nothing written anywhere.
 *
 *   npx tsx tools/agent-probe/cli.mts 49467                 an ERC-8004 agent on BNB Chain, by token id
 *   npx tsx tools/agent-probe/cli.mts 56:0x8004…:49467       by full agent key (chain:registry:tokenId)
 *   npx tsx tools/agent-probe/cli.mts --a2a https://…/.well-known/agent-card.json [--wallet 0x…]
 *   npx tsx tools/agent-probe/cli.mts --mcp https://…/mcp
 *   add --json for machine-readable output
 */

import { fetchAgentDetail } from "../../convex/sources/scan8004";
import { probeAgent, type ProbeInput } from "../../convex/lib/probe";

type Parsed = { input: ProbeInput; label: string } | { error: string };

async function parse(argv: string[]): Promise<Parsed> {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? (argv[at + 1] ?? null) : null;
  };
  const wallet = flag("--wallet");
  const a2a = flag("--a2a");
  const mcp = flag("--mcp");
  if (a2a || mcp) {
    const services = [...(a2a ? [{ name: "a2a", endpoint: a2a }] : []), ...(mcp ? [{ name: "mcp", endpoint: mcp }] : [])];
    return { input: { services, agentWallet: wallet }, label: a2a ?? mcp ?? "" };
  }
  const reference = argv.find((arg) => !arg.startsWith("--"));
  if (!reference) return { error: "Give an agent (token id or chain:registry:tokenId), or --a2a / --mcp with a URL." };
  const parts = reference.split(":");
  const chainId = parts.length === 3 ? Number(parts[0]) : 56;
  const tokenId = parts.length === 3 ? parts[2] : reference;
  if (!/^\d+$/.test(tokenId) || !Number.isFinite(chainId)) return { error: `Not an agent reference: ${reference}` };
  const detail = await fetchAgentDetail(chainId, tokenId);
  if (!detail) return { error: `8004scan has no agent ${tokenId} on chain ${chainId}.` };
  return {
    input: { services: detail.services.map(({ name, endpoint }) => ({ name, endpoint })), agentWallet: wallet ?? detail.agentWallet },
    label: `${detail.name ?? "agent"} (${chainId}:${tokenId})`,
  };
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.length === 0) {
  console.log((await import("node:fs")).readFileSync(new URL("./README.md", import.meta.url), "utf8").split("## Usage")[1]?.split("##")[0] ?? "");
  process.exit(0);
}
const parsed = await parse(argv);
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(2);
}
const started = Date.now();
const result = await probeAgent(parsed.input);
const out = {
  agent: parsed.label,
  live: result.state === "live",
  state: result.state,
  failureClass: result.failureClass,
  detail: result.detail,
  protocol: result.protocol,
  probedEndpoint: result.probedEndpoint,
  checkedAt: new Date().toISOString(),
  ms: Date.now() - started,
};
if (argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${out.live ? "LIVE" : "NOT LIVE"}  ${out.agent}`);
  console.log(`  ${out.detail}`);
  if (out.failureClass) console.log(`  failure class: ${out.failureClass}`);
  if (out.probedEndpoint) console.log(`  endpoint: ${out.probedEndpoint}`);
}
process.exit(out.live ? 0 : 1);
