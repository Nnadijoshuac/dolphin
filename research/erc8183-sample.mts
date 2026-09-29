/**
 * What BNB Chain's ERC-8183 job escrow actually holds - read straight from the
 * AgenticCommerce kernel, no Dolphin data involved. For the "State of Live
 * Agents on BNB Chain" funnel (mentor review, 2026-09-29).
 *
 *   npx tsx research/erc8183-sample.mts [sampleSize=2000]
 *
 * Reads `jobCounter()` for the exact total, then the latest N jobs with
 * `getJob` (batched through multicall). Prints JSON: status counts, distinct
 * clients and providers, concentration, repeat buyers, and simple
 * related-party signals. Addresses come from @altananetwork/sdk's
 * ERC8183_ADDRESSES (the bnbagent registry), not typed in here.
 */

import { ERC8183_ADDRESSES } from "@altananetwork/sdk";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";

const SAMPLE = Number(process.argv[2] ?? 2000);
const STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
const commerce = ERC8183_ADDRESSES[56].commerce;
const abi = parseAbi([
  "function jobCounter() view returns (uint256)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);
const client = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org"), batch: { multicall: true } });

const total = await client.readContract({ address: commerce, abi, functionName: "jobCounter" });
const first = total > BigInt(SAMPLE) ? total - BigInt(SAMPLE) + 1n : 1n;
const ids: bigint[] = [];
for (let id = first; id <= total; id++) ids.push(id);

type Job = { client: string; provider: string; evaluator: string; budget: bigint; status: number; deliverable: string; expiredAt: bigint };
const jobs: Job[] = [];
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  const results = await client.multicall({
    contracts: chunk.map((id) => ({ address: commerce, abi, functionName: "getJob", args: [id] }) as const),
    allowFailure: true,
  });
  for (const result of results) {
    if (result.status !== "success") continue;
    const job = result.result as unknown as Job;
    jobs.push({
      client: job.client.toLowerCase(),
      provider: job.provider.toLowerCase(),
      evaluator: job.evaluator.toLowerCase(),
      budget: job.budget,
      status: Number(job.status),
      deliverable: job.deliverable,
      expiredAt: job.expiredAt,
    });
  }
}

const count = <T,>(items: T[], key: (item: T) => string) => {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};
const statuses = Object.fromEntries(count(jobs, (job) => STATUS[job.status] ?? `status${job.status}`));
const clients = count(jobs, (job) => job.client);
const providers = count(jobs, (job) => job.provider);
const funded = jobs.filter((job) => job.budget > 0n && job.status >= 1);
const delivered = jobs.filter((job) => job.deliverable !== `0x${"0".repeat(64)}`);
const pairs = count(jobs, (job) => `${job.client}>${job.provider}`);

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      kernel: commerce,
      jobCounter: total.toString(),
      sampled: { fromJobId: first.toString(), toJobId: total.toString(), read: jobs.length },
      statuses,
      fundedWithBudget: funded.length,
      withDeliverable: delivered.length,
      distinctClients: clients.length,
      distinctProviders: providers.length,
      topClientShare: clients[0] ? +(clients[0][1] / jobs.length).toFixed(3) : null,
      top5ClientsShare: +(clients.slice(0, 5).reduce((sum, [, n]) => sum + n, 0) / Math.max(1, jobs.length)).toFixed(3),
      topProviderShare: providers[0] ? +(providers[0][1] / jobs.length).toFixed(3) : null,
      repeatPairs: pairs.filter(([, n]) => n >= 2).length,
      providersWithARepeatClient: new Set(pairs.filter(([, n]) => n >= 2).map(([pair]) => pair.split(">")[1])).size,
      topProviders: providers.slice(0, 5).map(([address, n]) => ({ address, jobs: n })),
      // expiredAt = creation + the job's window, so its month tracks when jobs were made.
      jobsByExpiryMonth: Object.fromEntries(
        count(jobs, (job) => new Date(Number(job.expiredAt) * 1000).toISOString().slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0])),
      ),
      relatedPartySignals: {
        clientIsProvider: jobs.filter((job) => job.client === job.provider).length,
        clientIsEvaluator: jobs.filter((job) => job.client === job.evaluator).length,
      },
    },
    null,
    2,
  ),
);
