"use client";

import { useState } from "react";
import { useMutation } from "convex/react";

import { agentHiresApi } from "@/convex/api";
import { StatePanel } from "@/components/state-panel";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import type { Agent } from "@/types/agent";

/**
 * The end of the judged journey: discover -> understand -> connect -> activate.
 *
 * A hire writes a row to convex/agentHires.ts. It is a read-only subscription
 * record - no signature is requested, no spend cap is granted, no session key
 * is issued and no transaction is sent. The copy below says exactly that rather
 * than implying more.
 *
 * Two refusals from the backend are deliberate and are surfaced, never worked
 * around here: an unresolved priceModel is rejected instead of assumed free,
 * and a non-zero price is rejected because no x402 seller-side integration
 * exists. If either fires, the user sees the backend's own message.
 */
export function HireAction({ agent }: { agent: Agent }) {
  const wallet = useWallet();
  const hire = useMutation(agentHiresApi.agentHires.hireReadOnlyAgent);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "hiring" } | { kind: "done"; id: string } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const price = agent.priceModel;
  const priceResolved = price.status === "live" || price.status === "stale";

  async function onHire() {
    if (!wallet.address) return;
    setState({ kind: "hiring" });
    try {
      const id = await hire({
        tokenId: agent.tokenId,
        category: agent.category,
        walletAddress: wallet.address,
        // Only ever the resolved value. An unresolved metric is passed as null
        // so the backend refuses, rather than the client inventing a free price.
        priceModel: priceResolved ? price.value : null,
      });
      setState({ kind: "done", id: String(id) });
    } catch (cause) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return (
    <Surface>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: colors.muted }}
          >
            Dolphin hire price
          </span>
          <span className="text-[15px] font-bold" style={{ color: colors.ink }}>
            {priceResolved
              ? price.value.amount === "0"
                ? "Free"
                : `${price.value.amount} ${price.value.token}`
              : "Not resolved"}
          </span>
        </div>
        {/*
          Split in two so the marketplace's own price can never be read as the
          publisher's - the same distinction convex/lib/agentCatalog.ts's price
          policy draws. ERC-8004 and 8004scan expose no price field at all.
        */}
        <div className="flex items-baseline justify-between gap-4">
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: colors.muted }}
          >
            Publisher price
          </span>
          <span className="text-[15px]" style={{ color: colors.muted }}>
            Not published
          </span>
        </div>

        <p className="text-[12px] leading-5" style={{ color: colors.muted }}>
          Hiring records a read-only subscription. No signature, no spending
          approval, no session key, no transaction.
        </p>

        {state.kind === "done" ? (
          <StatePanel
            title="Agent hired"
            body={`Recorded against ${wallet.address}. Reference ${state.id}.`}
            state="live"
            compact
          />
        ) : !wallet.isConnected ? (
          <WalletConnectButton connectLabel="Connect wallet to hire" />
        ) : (
          <button
            onClick={() => void onHire()}
            disabled={state.kind === "hiring"}
            className="w-full rounded-xl py-3 px-5 font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
            style={{ backgroundColor: colors.gold, color: colors.ink }}
          >
            {state.kind === "hiring"
              ? "Recording hire…"
              : priceResolved && price.value.amount === "0"
                ? "Hire — Free"
                : "Hire"}
          </button>
        )}

        {state.kind === "error" && (
          <p className="text-xs font-medium text-red-600">{state.message}</p>
        )}
      </div>
    </Surface>
  );
}
