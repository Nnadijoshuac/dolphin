import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentCategory } from "@/types/agent";

export interface HiredAgentSession {
  agentId: string;
  category: AgentCategory;
  hiredAt: string;
  status: "active" | "paused" | "revoked";
  spendCapUsd?: number;
  durationDays?: number;
  expiresAt?: string;
  monitoredAddress?: string;
  lastActionAt?: string;
  recentActivity: {
    timestamp: string;
    action: string;
    txHash?: string;
  }[];
}

export type PreviewHire = Readonly<{
  agentId: string;
  savedAt: string;
  source: "local_preview";
  isOnChain: false;
}>;

interface AppState {
  hasCompletedOnboarding: boolean;
  hiredAgents: HiredAgentSession[];
  previewHires: PreviewHire[];
  recentSearches: string[];
  
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  hireAgent: (session: Omit<HiredAgentSession, "hiredAt" | "status" | "recentActivity">) => void;
  updateAgentStatus: (agentId: string, status: HiredAgentSession["status"]) => void;
  updateAgentSpendCap: (agentId: string, spendCapUsd: number) => void;
  revokeAgent: (agentId: string) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  
  savePreviewHire: (agentId: string) => void;
  removePreviewHire: (agentId: string) => void;
  clearPreviewHires: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      hiredAgents: [],
      previewHires: [],
      recentSearches: ["Venus", "PancakeSwap", "Monitoring", "Yield", "BNB"],
      
      setHasCompletedOnboarding: (isComplete) =>
        set({ hasCompletedOnboarding: isComplete }),
        
      hireAgent: (session) => {
        const now = new Date();
        const durationDays = session.durationDays ?? 30;
        const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
        
        set((state) => {
          const filtered = state.hiredAgents.filter((a) => a.agentId !== session.agentId);
          const newSession: HiredAgentSession = {
            ...session,
            hiredAt: now.toISOString(),
            status: "active",
            expiresAt,
            lastActionAt: now.toISOString(),
            recentActivity: [
              {
                timestamp: now.toISOString().replace("T", " ").slice(0, 19) + " UTC",
                action: session.category === "monitoring"
                  ? "Monitoring initialized for target address"
                  : `Session registered on BSC (Spend Cap: $${session.spendCapUsd ?? 500})`,
              },
            ],
          };
          return { hiredAgents: [newSession, ...filtered] };
        });
      },
      
      updateAgentStatus: (agentId, status) => {
        set((state) => ({
          hiredAgents: state.hiredAgents.map((agent) =>
            agent.agentId === agentId
              ? {
                  ...agent,
                  status,
                  recentActivity: [
                    {
                      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
                      action: `Agent status updated to ${status}`,
                    },
                    ...agent.recentActivity,
                  ],
                }
              : agent
          ),
        }));
      },
      
      updateAgentSpendCap: (agentId, spendCapUsd) => {
        set((state) => ({
          hiredAgents: state.hiredAgents.map((agent) =>
            agent.agentId === agentId
              ? {
                  ...agent,
                  spendCapUsd,
                  recentActivity: [
                    {
                      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
                      action: `Spend cap adjusted to $${spendCapUsd}`,
                    },
                    ...agent.recentActivity,
                  ],
                }
              : agent
          ),
        }));
      },
      
      revokeAgent: (agentId) => {
        set((state) => ({
          hiredAgents: state.hiredAgents.map((agent) =>
            agent.agentId === agentId
              ? {
                  ...agent,
                  status: "revoked",
                  recentActivity: [
                    {
                      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
                      action: "Session revoked on-chain",
                    },
                    ...agent.recentActivity,
                  ],
                }
              : agent
          ),
        }));
      },
      
      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => ({
          recentSearches: [
            trimmed,
            ...state.recentSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
          ].slice(0, 8),
        }));
      },
      
      removeRecentSearch: (query) => {
        set((state) => ({
          recentSearches: state.recentSearches.filter((item) => item !== query),
        }));
      },
      
      clearRecentSearches: () => set({ recentSearches: [] }),
      
      savePreviewHire: (agentId) => {
        const normalizedAgentId = agentId.trim();
        if (!normalizedAgentId) return;

        set((state) => {
          if (state.previewHires.some((h) => h.agentId === normalizedAgentId)) {
            return {};
          }
          const previewHire: PreviewHire = {
            agentId: normalizedAgentId,
            savedAt: new Date().toISOString(),
            source: "local_preview",
            isOnChain: false,
          };
          return { previewHires: [...state.previewHires, previewHire] };
        });
      },
      
      removePreviewHire: (agentId) =>
        set((state) => ({
          previewHires: state.previewHires.filter((h) => h.agentId !== agentId),
        })),
        
      clearPreviewHires: () => set({ previewHires: [] }),
    }),
    {
      name: "dolphin-app-state-v2",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        hiredAgents: state.hiredAgents,
        previewHires: state.previewHires,
        recentSearches: state.recentSearches,
      }),
      version: 2,
    },
  ),
);
