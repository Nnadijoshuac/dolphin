import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

const configuredRpcUrl = process.env.BSC_RPC_URL?.trim();

export const BSC_CHAIN_ID = 56 as const;

export const bscPublicClient = createPublicClient({
  chain: bsc,
  transport: http(configuredRpcUrl || "https://bsc-dataseed.bnbchain.org"),
});
