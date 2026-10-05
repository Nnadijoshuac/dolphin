"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { StartDialog } from "@/app/trade/trade-client";
import { tradersApi } from "@/convex/api";

/**
 * HIRE A TRADING AGENT = IT RUNS IN YOUR OWN WALLET (owner, 2026-10-05). On the page of any trading agent
 * built on Dolphin (its draft trades by rules), this replaces the pay-per-job Hire box: the hirer picks an
 * amount and it trades for them from their own Dolphin Wallet - on paper first if they like. The builder's
 * conditions stay locked; what it trades, its stop and target are shown.
 */

export function useRunnableAgent(agentKey: string) {
  return useQuery(tradersApi.traders.runnableFor, { agentKey });
}

export function RunTradingAgent({ agentKey, bare = false }: { agentKey: string; bare?: boolean }) {
  const runnable = useRunnableAgent(agentKey);
  const start = useMutation(tradersApi.traders.startFromAgent);
  const [open, setOpen] = useState(false);
  if (!runnable) return null;
  return (
    <div className={bare ? "" : "surface-raised rounded-2xl p-5"}>
      <p className="trade-label">Hire</p>
      <h2 className="mt-1 text-[1.25rem] font-bold tracking-[-0.02em] text-ink">Let it trade for you</h2>
      <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-soft">
        It runs in your own Dolphin Wallet with the amount you choose. Try it with pretend money first, and stop it any time.
      </p>
      <ul className="mt-3 space-y-2">
        {runnable.rules.map((rule, index) => (
          <li className="rounded-xl bg-paper-muted px-3 py-2 text-[0.8rem] leading-relaxed text-ink" key={index}>
            {rule.words}
          </li>
        ))}
      </ul>
      <button className="trade-start w-full" onClick={() => setOpen(true)} type="button">
        <span>Start {runnable.name}</span>
      </button>
      <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">From ${runnable.minUsd}. Not financial advice; you can lose what it trades.</p>
      {open ? (
        <StartDialog
          begin={(sessionToken, amountUsd, real) => start({ sessionToken, agentKey, amountUsd, real, ...(real ? { acknowledge: true } : {}) })}
          minUsd={runnable.minUsd}
          name={runnable.name}
          onClose={() => setOpen(false)}
          riskLabel="Trading agent"
        />
      ) : null}
    </div>
  );
}
