import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * A hire saved only on this device for UI preview purposes.
 * It is deliberately impossible to type this value as an on-chain hire.
 */
export type PreviewHire = Readonly<{
  agentId: string;
  savedAt: string;
  source: "local_preview";
  isOnChain: false;
}>;

type AppState = {
  hasCompletedOnboarding: boolean;
  previewHires: PreviewHire[];
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  savePreviewHire: (agentId: string) => void;
  removePreviewHire: (agentId: string) => void;
  clearPreviewHires: () => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      previewHires: [],
      setHasCompletedOnboarding: (isComplete) =>
        set({ hasCompletedOnboarding: isComplete }),
      savePreviewHire: (agentId) => {
        const normalizedAgentId = agentId.trim();

        if (!normalizedAgentId) {
          return;
        }

        set((state) => {
          if (
            state.previewHires.some(
              (previewHire) => previewHire.agentId === normalizedAgentId,
            )
          ) {
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
          previewHires: state.previewHires.filter(
            (previewHire) => previewHire.agentId !== agentId,
          ),
        })),
      clearPreviewHires: () => set({ previewHires: [] }),
    }),
    {
      name: "dolphin-local-preview-state-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        previewHires: state.previewHires,
      }),
      version: 1,
    },
  ),
);
