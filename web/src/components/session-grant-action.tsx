// ─────────────────────────────────────────────────────────
// FUTURE WORK — NOT LIVE IN THIS BUILD
// This implements the delegated-portfolio-management permission layer:
// spend caps, protocol allowlist, session duration. The permission
// plumbing is complete, but no execution path exists yet — a granted
// session's signing key is never delivered to an agent and never used
// by this app (see altana-storage.ts for why it's intentionally not
// persisted). Do not wire this to UI until key-custody and an
// agent-side execution runtime are designed.
// ─────────────────────────────────────────────────────────
//
// No caller renders this component today: hire-action.tsx dropped its
// <SessionGrantAction> in the same change that added FEATURE_SESSION_EXECUTION.
// The guard below is a second line of defence, so re-adding the tag somewhere
// cannot quietly put a gas-charging Grant button back in front of a user
// without the flag also being flipped.

"use client";

import { useQuery as useConvexQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { agentSessionsApi } from "@/convex/api";
import type { Agent } from "@/types/agent";
import {
  DEFAULT_SESSION_DURATION_DAYS,
  DEFAULT_SPEND_CAP_WEI,
  FEATURE_SESSION_EXECUTION,
  SESSION_DURATION_CHOICES_DAYS,
  SPEND_CAP_CHOICES_WEI,
  formatBnb,
  sessionPolicyFor,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";

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
    // Skipped outright while the feature is gated off, so a hidden component
    // does not keep a live Convex subscription open for a panel nobody sees.
    FEATURE_SESSION_EXECUTION && altana.address
      ? { tokenId: agent.tokenId, altanaWalletAddress: altana.address }
      : "skip",
  );

  // See the banner at the top of this file. Placed after EVERY hook - including
  // the query above - so this is a legal early return and not a conditional
  // hook call.
  if (!FEATURE_SESSION_EXECUTION) return null;

  if (policy.kind === "read-only") {
    return (
      <div className="mt-4 flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
          <CategoryGlyph color="currentColor" name="shield" size={16} strokeWidth={2} />
        </div>
        <div>
          <p className="text-xs font-semibold text-ink">No spending permission needed</p>
          <p className="mt-1 text-xs leading-5 text-muted">{policy.reason}</p>
        </div>
      </div>
    );
  }

  if (existing) {
    return (
      <div className="mt-4 border-l-2 border-success pl-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-success">Permission active</p>
          <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-success">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
            Granted
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          Up to {formatBnb(BigInt(existing.spendCapWei))} BNB per {existing.spendPeriod},
          and only against {existing.allowlist.map((contract) => contract.label).join(", ")}.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link
            className="interactive flex min-h-10 items-center justify-center rounded-xl border border-line bg-paper px-3 text-xs font-semibold text-ink no-underline hover:bg-canvas"
            href="/wallet"
          >
            Review in Wallet
          </Link>
          <button
            className="interactive min-h-10 rounded-xl border border-line bg-paper px-3 text-xs font-semibold text-muted hover:border-danger hover:bg-danger-soft hover:text-danger disabled:opacity-50"
            disabled={altana.isBusy}
            onClick={() => void altana.revokeSession(existing.sessionPublicKey)}
            type="button"
          >
            Revoke permission
          </button>
        </div>
      </div>
    );
  }

  if (altana.status !== "connected") {
    return (
      <div className="mt-4 border-l-2 border-accent pl-4">
        <p className="text-xs font-semibold text-ink">Dolphin Wallet required</p>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {policy.reason} This uses a separate passkey account, not the connected
          browser wallet.
        </p>
        {altana.status === "unsupported" ? (
          <p className="mt-2 text-xs font-medium leading-5 text-danger">
            {altana.unsupportedReason}
          </p>
        ) : (
          <Link
            className="interactive mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-xs font-semibold text-ink no-underline hover:bg-canvas"
            href="/wallet"
          >
            Set up Dolphin Wallet
            <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-ink">Set a spending permission</p>
      <p className="mt-1.5 text-xs leading-5 text-muted">{policy.reason}</p>

      <dl className="mt-4 border-y border-line text-xs">
        <div className="grid gap-2 py-3 sm:grid-cols-[110px_minmax(0,1fr)]">
          <dt className="text-muted">Allowed calls</dt>
          <dd className="space-y-2 sm:text-right">
            {policy.allowlist.map((contract) => (
              <div key={contract.address}>
                <span className="block font-medium text-ink">{contract.label}</span>
                <span className="block break-all font-mono text-[0.64rem] leading-4 text-faint">
                  {contract.address}
                </span>
              </div>
            ))}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line py-3">
          <dt className="text-muted">Other contracts</dt>
          <dd className="font-medium text-success">Rejected on-chain</dd>
        </div>
      </dl>

      <fieldset className="mt-5">
        <legend className="text-xs font-semibold text-ink">Daily spend cap</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SPEND_CAP_CHOICES_WEI.map((choice) => (
            <button
              aria-pressed={spendCapWei === choice.wei}
              className={`interactive min-h-9 rounded-lg border px-2 text-[0.7rem] font-medium ${
                spendCapWei === choice.wei
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-line bg-paper text-muted hover:text-ink"
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

      <fieldset className="mt-5">
        <legend className="text-xs font-semibold text-ink">Expires after</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {SESSION_DURATION_CHOICES_DAYS.map((days) => (
            <button
              aria-pressed={durationDays === days}
              className={`interactive min-h-9 rounded-lg border px-2 text-[0.7rem] font-medium ${
                durationDays === days
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-line bg-paper text-muted hover:text-ink"
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

      <p className="mt-5 border-y border-line bg-canvas px-3 py-3 text-[0.7rem] leading-5 text-muted">
        Maximum <strong className="font-semibold text-ink">{formatBnb(spendCapWei)} BNB per day</strong>{" "}
        for {durationDays} days, limited to the contract
        {policy.allowlist.length === 1 ? "" : "s"} above. The permission can be
        revoked and expires automatically.
      </p>

      <button
        className="interactive mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
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
        {state.kind === "granting"
          ? "Confirm with passkey…"
          : `Grant ${formatBnb(spendCapWei)} BNB / day`}
      </button>

      {state.kind === "error" ? (
        <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-[0.7rem] font-medium leading-5 text-danger">
          {state.message}
        </p>
      ) : null}

      <p className="mt-3 text-center text-[0.68rem] leading-5 text-faint">
        Granting is an on-chain BNB Smart Chain transaction and uses gas from
        the Dolphin Wallet.
      </p>
    </div>
  );
}
