"use client";

import { useQuery as useConvexQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { StatusBadge } from "@/components/status-badge";
import { agentSessionsApi } from "@/convex/api";
import type { Agent } from "@/types/agent";
import {
  DEFAULT_SESSION_DURATION_DAYS,
  DEFAULT_SPEND_CAP_WEI,
  SESSION_DURATION_CHOICES_DAYS,
  SPEND_CAP_CHOICES_WEI,
  formatBnb,
  sessionPolicyFor,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * The session-grant step of the hire flow.
 *
 * Only rendered where a session is honestly warranted. For every other agent
 * this component says so plainly rather than quietly disappearing - a user
 * being told "this agent needs no spending permission, and here is why" is the
 * point, not an omission. See CATEGORY_SESSION_POLICY in altana-policy.ts for
 * how that call is made per category.
 */
export function SessionGrantAction({ agent }: { agent: Agent }) {
  const altana = useAltanaWallet();
  const hirer = useWallet();
  const policy = sessionPolicyFor(agent.category);

  const [spendCapWei, setSpendCapWei] = useState<bigint>(DEFAULT_SPEND_CAP_WEI);
  const [durationDays, setDurationDays] = useState<number>(
    DEFAULT_SESSION_DURATION_DAYS,
  );
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "granting" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const existing = useConvexQuery(
    agentSessionsApi.agentSessions.getActiveSessionForAgent,
    altana.address
      ? { tokenId: agent.tokenId, altanaWalletAddress: altana.address }
      : "skip",
  );

  /* --- read-only categories: say why, do not offer a session ------------- */
  if (policy.kind === "read-only") {
    return (
      <div className="mt-4 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
        <div className="flex items-center gap-2">
          <CategoryGlyph color="#1C6A44" name="shield" size={15} strokeWidth={2.5} />
          <p className="text-xs font-black text-[#111214]">
            No spending permission needed
          </p>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E706B]">
          {policy.reason}
        </p>
      </div>
    );
  }

  /* --- already granted --------------------------------------------------- */
  if (existing) {
    return (
      <div className="mt-4 rounded-2xl border border-[#BFE0CC] bg-[#DCEFE4] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CategoryGlyph color="#1C6A44" name="check" size={15} strokeWidth={2.5} />
            <p className="text-xs font-black text-[#1C6A44]">
              Spending permission active
            </p>
          </div>
          <StatusBadge label="Granted" tone="live" />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#1C6A44]">
          Up to {formatBnb(BigInt(existing.spendCapWei))} BNB per{" "}
          {existing.spendPeriod}, and only against{" "}
          {existing.allowlist.map((c) => c.label).join(", ")}.
        </p>
        <div className="mt-3 flex gap-2">
          <Link
            className="pressable-scale flex min-h-[40px] flex-1 items-center justify-center rounded-2xl border border-[#BFE0CC] bg-white px-4 text-xs font-black text-[#1C6A44] no-underline"
            href="/wallet"
          >
            See it in your wallet
          </Link>
          <button
            className="pressable-scale min-h-[40px] flex-1 rounded-2xl border border-[#ECE8DE] bg-white px-4 text-xs font-black text-[#6E706B] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-50"
            disabled={altana.isBusy}
            onClick={() => void altana.revokeSession(existing.sessionPublicKey)}
            type="button"
          >
            Revoke now
          </button>
        </div>
      </div>
    );
  }

  /* --- no Dolphin wallet yet --------------------------------------------- */
  if (altana.status !== "connected") {
    return (
      <div className="mt-4 rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6] p-4">
        <div className="flex items-center gap-2">
          <CategoryGlyph color="#946B00" name="wallet" size={15} strokeWidth={2.5} />
          <p className="text-xs font-black text-[#946B00]">
            This agent can be given a spending permission
          </p>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E706B]">
          {policy.reason} That needs a Dolphin Wallet — a separate passkey
          account, not your browser extension wallet.
        </p>
        {altana.status === "unsupported" ? (
          <p className="mt-2 text-[11px] font-semibold text-[#B9473A]">
            {altana.unsupportedReason}
          </p>
        ) : (
          <Link
            className="pressable-scale mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-xs font-black text-[#111214] no-underline hover:bg-[#E2A500]"
            href="/wallet"
          >
            <CategoryGlyph color="#111214" name="wallet" size={14} strokeWidth={2.4} />
            Set up a Dolphin Wallet
          </Link>
        )}
      </div>
    );
  }

  /* --- the grant step ---------------------------------------------------- */
  return (
    <div className="mt-4 rounded-2xl border border-[#ECE8DE] bg-white p-4">
      <div className="flex items-center gap-2">
        <CategoryGlyph color="#946B00" name="shield" size={15} strokeWidth={2.5} />
        <p className="text-xs font-black text-[#111214]">
          Give this agent a spending permission
        </p>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#6E706B]">
        {policy.reason}
      </p>

      {/* Exactly what is being authorized, before anything is signed. */}
      <dl className="mt-3 space-y-2 rounded-xl border border-[#ECE8DE] bg-[#FBF9F4] p-3 text-[11px]">
        <div className="flex items-start justify-between gap-3">
          <dt className="font-semibold text-[#6E706B]">It can only call</dt>
          <dd className="text-right">
            {policy.allowlist.map((c) => (
              <div key={c.address} className="mb-1 last:mb-0">
                <span className="block font-bold text-[#111214]">{c.label}</span>
                <span className="block break-all font-mono text-[10px] text-[#A5A79F]">
                  {c.address}
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#ECE8DE] pt-2">
          <dt className="font-semibold text-[#6E706B]">Anything else</dt>
          <dd className="font-bold text-[#1C6A44]">Rejected on-chain</dd>
        </div>
      </dl>

      <fieldset className="mt-3">
        <legend className="text-[11px] font-black text-[#111214]">
          Most it can spend
        </legend>
        <div className="mt-1.5 flex gap-2">
          {SPEND_CAP_CHOICES_WEI.map((choice) => (
            <button
              className={`min-h-[36px] flex-1 rounded-xl border px-2 text-[11px] font-bold transition-colors ${
                spendCapWei === choice.wei
                  ? "border-[#F5B300] bg-[#FEF5D6] text-[#946B00]"
                  : "border-[#ECE8DE] bg-white text-[#6E706B] hover:border-[#F3E3A6]"
              }`}
              key={choice.label}
              onClick={() => setSpendCapWei(choice.wei)}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-[11px] font-black text-[#111214]">
          Permission expires after
        </legend>
        <div className="mt-1.5 flex gap-2">
          {SESSION_DURATION_CHOICES_DAYS.map((days) => (
            <button
              className={`min-h-[36px] flex-1 rounded-xl border px-2 text-[11px] font-bold transition-colors ${
                durationDays === days
                  ? "border-[#F5B300] bg-[#FEF5D6] text-[#946B00]"
                  : "border-[#ECE8DE] bg-white text-[#6E706B] hover:border-[#F3E3A6]"
              }`}
              key={days}
              onClick={() => setDurationDays(days)}
              type="button"
            >
              {days} days
            </button>
          ))}
        </div>
      </fieldset>

      <p className="mt-3 rounded-xl bg-[#F5F3EB] p-2.5 text-[10px] leading-relaxed text-[#6E706B]">
        You are authorizing at most{" "}
        <strong className="font-bold text-[#111214]">
          {formatBnb(spendCapWei)} BNB per day
        </strong>{" "}
        for {durationDays} days, against the contract{policy.allowlist.length === 1 ? "" : "s"}{" "}
        listed above and nothing else. You can revoke it at any time from your
        wallet, and it stops working on its own when it expires.
      </p>

      <button
        className="pressable-scale mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-xs font-black text-[#111214] hover:bg-[#E2A500] disabled:cursor-wait disabled:opacity-60"
        disabled={state.kind === "granting" || altana.isBusy}
        onClick={() => {
          setState({ kind: "granting" });
          void altana
            .grantSession({
              tokenId: agent.tokenId,
              agentName: agent.name,
              category: agent.category,
              spendCapWei,
              durationDays,
              hirerWalletAddress: hirer.address,
            })
            .then(
              () => setState({ kind: "idle" }),
              (cause: unknown) =>
                setState({
                  kind: "error",
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
            );
        }}
        type="button"
      >
        <CategoryGlyph color="#111214" name="shield" size={14} strokeWidth={2.4} />
        {state.kind === "granting"
          ? "Confirm with your passkey…"
          : `Grant ${formatBnb(spendCapWei)} BNB / day`}
      </button>

      {state.kind === "error" && (
        <p className="mt-2 rounded-xl border border-[#FECACA] bg-[#FEE2E2] p-2.5 text-[10px] font-semibold leading-relaxed text-[#B91C1C]">
          {state.message}
        </p>
      )}

      {/* This costs real BNB. Saying so before the button is pressed, not
          after it fails, is the difference between a bounded surprise and an
          unbounded one - see the mainnet decision in altana-policy.ts. */}
      <p className="mt-2 text-center text-[10px] leading-relaxed text-[#A5A79F]">
        Granting is an on-chain transaction on BNB Smart Chain and costs gas
        from your Dolphin Wallet.
      </p>
    </div>
  );
}
