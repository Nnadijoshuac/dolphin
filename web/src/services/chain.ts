import { createPublicClient, http, zeroAddress } from "viem";
import { bsc } from "viem/chains";

import {
  AGENT_DATA_SOURCES,
  BSC_RPC_URL,
  ERC8004_REGISTRY_ADDRESSES,
} from "@/constants/agents";
import type { LiveMetric, RegistryVerification, Address } from "@/types/agent";

export const ERC8004_IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const bscPublicClient = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC_URL),
});

export interface RegistryVerificationOptions {
  includeTokenUri?: boolean;
  includeAgentWallet?: boolean;
}

function liveRegistryMetric<T>(value: T, asOf: string): LiveMetric<T> {
  return { status: "live", value, asOf, source: AGENT_DATA_SOURCES.registry };
}

function unavailableRegistryMetric<T>(
  reason: string,
  asOf: string | null,
): LiveMetric<T> {
  return {
    status: "unavailable",
    value: null,
    asOf,
    source: AGENT_DATA_SOURCES.registry,
    reason,
  };
}

function unavailableVerification(reason: string): RegistryVerification {
  const checkedAt = new Date().toISOString();
  return {
    registered: unavailableRegistryMetric<boolean>(reason, checkedAt),
    owner: unavailableRegistryMetric<Address>(reason, checkedAt),
    tokenUri: unavailableRegistryMetric<string>(reason, checkedAt),
    agentWallet: unavailableRegistryMetric<Address>(reason, checkedAt),
  };
}

function parseTokenId(tokenId: string): bigint | null {
  const normalized = tokenId.trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

export async function verifyAgentRegistration(
  tokenId: string,
  options: RegistryVerificationOptions = {},
): Promise<RegistryVerification> {
  const numericTokenId = parseTokenId(tokenId);
  if (numericTokenId === null) {
    return unavailableVerification("The ERC-8004 token ID is invalid.");
  }

  const includeTokenUri = options.includeTokenUri ?? true;
  const includeAgentWallet = options.includeAgentWallet ?? true;
  const checkedAt = new Date().toISOString();

  const ownerPromise = bscPublicClient.readContract({
    address: ERC8004_REGISTRY_ADDRESSES.identity,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [numericTokenId],
  });
  const tokenUriPromise = includeTokenUri
    ? bscPublicClient.readContract({
        address: ERC8004_REGISTRY_ADDRESSES.identity,
        abi: ERC8004_IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [numericTokenId],
      })
    : Promise.resolve<string | null>(null);
  const agentWalletPromise = includeAgentWallet
    ? bscPublicClient.readContract({
        address: ERC8004_REGISTRY_ADDRESSES.identity,
        abi: ERC8004_IDENTITY_REGISTRY_ABI,
        functionName: "getAgentWallet",
        args: [numericTokenId],
      })
    : Promise.resolve<Address | null>(null);

  const [ownerResult, tokenUriResult, agentWalletResult] =
    await Promise.allSettled([
      ownerPromise,
      tokenUriPromise,
      agentWalletPromise,
    ] as const);

  const owner =
    ownerResult.status === "fulfilled"
      ? liveRegistryMetric(ownerResult.value as Address, checkedAt)
      : unavailableRegistryMetric<Address>(
          "The registry owner read failed or the token does not exist.",
          checkedAt,
        );

  const registered =
    ownerResult.status === "fulfilled"
      ? liveRegistryMetric(true, checkedAt)
      : unavailableRegistryMetric<boolean>(
          "Registration could not be confirmed from the BSC registry.",
          checkedAt,
        );

  let tokenUri: LiveMetric<string>;
  if (!includeTokenUri) {
    tokenUri = unavailableRegistryMetric("The token URI check was not requested.", checkedAt);
  } else if (
    tokenUriResult.status === "fulfilled" &&
    typeof tokenUriResult.value === "string" &&
    tokenUriResult.value.length > 0
  ) {
    tokenUri = liveRegistryMetric(tokenUriResult.value, checkedAt);
  } else {
    tokenUri = unavailableRegistryMetric("The registry did not return a token URI.", checkedAt);
  }

  let agentWallet: LiveMetric<Address>;
  if (!includeAgentWallet) {
    agentWallet = unavailableRegistryMetric("The agent wallet check was not requested.", checkedAt);
  } else if (
    agentWalletResult.status === "fulfilled" &&
    agentWalletResult.value !== null &&
    (agentWalletResult.value as string).toLowerCase() !== zeroAddress
  ) {
    agentWallet = liveRegistryMetric(agentWalletResult.value as Address, checkedAt);
  } else {
    agentWallet = unavailableRegistryMetric(
      "No agent wallet could be confirmed from the registry.",
      checkedAt,
    );
  }

  return { registered, owner, tokenUri, agentWallet };
}
