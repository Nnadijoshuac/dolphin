import type { DataSourceLabelInput } from "./liveMetric";

/**
 * Mirrors AGENT_DATA_SOURCES in src/constants/agents.ts. Convex can't import
 * from src/, so this list is duplicated deliberately - keep the two in sync
 * by hand when either changes.
 */
export const CATEGORY_DATA_SOURCES = {
  venus: {
    id: "venus-protocol-bsc",
    label: "Venus Protocol on BSC",
    url: "https://app.venus.io",
  },
  pancakeswapV3: {
    id: "pancakeswap-v3-bsc",
    label: "PancakeSwap V3 on BSC",
    url: "https://pancakeswap.finance",
  },
  aaveV3: {
    id: "aave-v3-bsc",
    label: "Aave V3 on BSC",
    url: "https://app.aave.com",
  },
  lista: {
    id: "lista-dao-bsc",
    label: "Lista DAO on BSC",
    url: "https://lista.org",
  },
  backend: {
    id: "dolphin-backend",
    label: "Dolphin backend aggregation",
  },
} as const satisfies Record<string, DataSourceLabelInput>;
