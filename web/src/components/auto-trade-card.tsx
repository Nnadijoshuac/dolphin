"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { autotradeApi } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * "TRADE WITHOUT ASKING" (owner, 2026-09-28): an opt-in trade key for one
 * agent - 7 days by default, 1 or 30 - and two ways to stop it.
 *
 *  - Stop now: Dolphin destroys its copy of the key at once. No passkey.
 *  - Revoke on-chain: the Dolphin Wallet revokes the key itself, everywhere.
 *
 * The key's limits are enforced by the wallet contract, and this card says
 * what they are before the passkey is asked for (convex/autotrade.ts).
 */

const DURATIONS = [1, 7, 30] as const;

function errorText(cause: unknown, fallback: string): string {
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : toUserMessage(cause, fallback);
}

function until(expiry: number): string {
  return new Date(expiry * 1000).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AutoTradeCard({
  conversationKey,
  hasSwap,
  riskDailyUsd,
}: {
  conversationKey: string;
  /** Swap and Risk limits exist: what a key is limited to. */
  hasSwap: boolean;
  riskDailyUsd: number | null;
}) {
  const session = useWalletSession();
  const altana = useAltanaWallet();
  const state = useQuery(autotradeApi.autotrade.forDraft, { conversationKey });
  const prepare = useAction(autotradeApi.autotrade.prepare);
  const confirmGrant = useMutation(autotradeApi.autotrade.confirmGrant);
  const stop = useMutation(autotradeApi.autotrade.stop);
  const markRevoked = useMutation(autotradeApi.autotrade.markRevoked);
  const [durationDays, setDurationDays] = useState<number>(7);
  const [busy, setBusy] = useState<"grant" | "stop" | "revoke" | null>(null);

  if (!hasSwap) return null;
  const active = state && state.status === "active";
  const unrevoked = state?.unrevoked ?? [];

  const token = async (): Promise<string | null> => session.sessionToken ?? (await session.signIn());

  const allow = async () => {
    if (!altana.address) {
      toast.notice("Create your Dolphin Wallet first (Wallet page) - the agent trades from it.");
      return;
    }
    setBusy("grant");
    try {
      const sessionToken = await token();
      if (!sessionToken) return;
      const prepared = await prepare({ sessionToken, conversationKey, altanaWalletAddress: altana.address, durationDays });
      const transactionHash = await altana.grantAgentTradeKey(prepared);
      await confirmGrant({ sessionToken, keyId: prepared.keyId, transactionHash });
      toast.success(`This agent can now trade by itself for ${durationDays} day${durationDays === 1 ? "" : "s"}, up to $${prepared.dailyUsd.toLocaleString()} a day.`);
    } catch (cause) {
      toast.error(errorText(cause, "Could not give the agent a trade key."));
    } finally {
      setBusy(null);
    }
  };

  const stopNow = async () => {
    setBusy("stop");
    try {
      const sessionToken = await token();
      if (!sessionToken) return;
      await stop({ sessionToken, conversationKey });
      toast.success("Stopped. Dolphin deleted the key - this agent cannot trade until you allow it again.");
    } catch (cause) {
      toast.error(errorText(cause, "Could not stop trading."));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (keyId: string, sessionPublicKey: string, approvalTokens: readonly string[]) => {
    setBusy("revoke");
    try {
      const sessionToken = await token();
      if (!sessionToken) return;
      // Stop first, so Dolphin's copy is gone even if the on-chain step is cancelled.
      await stop({ sessionToken, conversationKey });
      await altana.revokeAgentTradeKey(sessionPublicKey, approvalTokens);
      await markRevoked({ sessionToken, keyId });
      toast.success("Revoked on-chain, and its allowances set back to zero. That key is dead everywhere.");
    } catch (cause) {
      toast.error(errorText(cause, "Could not revoke the key."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-2 mt-2 rounded-xl border border-line bg-paper-strong px-3 py-2.5" data-active={active || undefined}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${active ? "bg-accent" : "bg-line-strong"}`} />
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">Trade without asking</p>
      </div>

      {active ? (
        <>
          <p className="mt-1 text-[0.7rem] leading-snug text-muted">
            On until {until(state.expiry)}. Trades within your Risk limits
            {riskDailyUsd ? ` (up to $${riskDailyUsd.toLocaleString()} a day)` : ""} execute from your Dolphin Wallet without a tap.
            Only PancakeSwap and Dolphin&apos;s verified tokens.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              className="h-8 rounded-lg bg-ink !text-[12px] font-semibold disabled:opacity-40"
              disabled={busy !== null}
              onClick={() => void stopNow()}
              type="button"
            >
              <span className="text-canvas">{busy === "stop" ? "Stopping…" : "Stop now"}</span>
            </button>
            <button
              className="h-8 rounded-lg border border-line !text-[12px] font-semibold text-ink hover:bg-paper-muted disabled:opacity-40"
              disabled={busy !== null}
              onClick={() => void revoke(state.keyId, state.sessionPublicKey, state.approvalTokens ?? [])}
              type="button"
            >
              {busy === "revoke" ? "Revoking…" : "Revoke on-chain"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[0.7rem] leading-snug text-muted">
            {state?.status === "expired" ? "The last key expired. " : ""}
            Off - every trade comes to you as a ticket to sign. Allow it to trade on its own within your Risk limits
            {riskDailyUsd ? ` (up to $${riskDailyUsd.toLocaleString()} a day)` : ""}, only on PancakeSwap and Dolphin&apos;s verified tokens.
          </p>
          {riskDailyUsd ? (
            <p className="mt-1.5 rounded-lg bg-paper-muted/70 px-2.5 py-1.5 text-[0.68rem] leading-snug text-muted">
              Worst case, if someone stole this key: up to ${(riskDailyUsd * durationDays).toLocaleString()} of each token it may
              trade, taken all at once rather than a day at a time, plus ${riskDailyUsd.toLocaleString()} of BNB a day - until it
              expires or you revoke it. A shorter key means a smaller worst case. Your passkey approves two things: those capped
              allowances, then the key.
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            <div className="panel-tabs grid flex-1 grid-cols-3 rounded-full p-[2px]" role="radiogroup" aria-label="How long">
              {DURATIONS.map((days) => (
                <button
                  aria-checked={durationDays === days}
                  className={`rounded-full py-1 !text-[11px] font-semibold transition-colors ${
                    durationDays === days ? "bg-white text-[#171813] shadow-sm" : "text-muted hover:text-ink"
                  }`}
                  key={days}
                  onClick={() => setDurationDays(days)}
                  role="radio"
                  type="button"
                >
                  {days} day{days === 1 ? "" : "s"}
                </button>
              ))}
            </div>
            <button
              className="h-8 shrink-0 rounded-lg bg-accent px-3 !text-[12px] font-semibold text-ink hover:bg-accent-hover disabled:opacity-40"
              disabled={busy !== null || !riskDailyUsd}
              onClick={() => void allow()}
              title={riskDailyUsd ? undefined : "Add Risk limits first"}
              type="button"
            >
              {busy === "grant" ? "Check your wallet…" : "Allow"}
            </button>
          </div>
        </>
      )}

      {!active && unrevoked.length > 0 ? (
        <button
          className="mt-2 !text-[0.7rem] font-semibold text-danger hover:underline disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => void revoke(unrevoked[0].keyId, unrevoked[0].sessionPublicKey, unrevoked[0].approvalTokens ?? [])}
          type="button"
        >
          A stopped key is still valid on-chain until {until(unrevoked[0].expiry)} - revoke it
        </button>
      ) : null}
    </div>
  );
}
