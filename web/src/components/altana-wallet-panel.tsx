"use client";

import { useState } from "react";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import type { AgentSessionRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import {
  ALTANA_FUNDING_HINT,
  formatBnb,
  recoverabilityCopy,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className="interactive inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-[0.7rem] font-medium text-muted hover:bg-canvas hover:text-ink"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); },
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <CategoryGlyph color="currentColor" name={copied ? "check" : "copy"} size={12} strokeWidth={2} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function SessionRow({
  session, onRevoke, isBusy, isLiveThisTab,
}: {
  session: AgentSessionRow;
  onRevoke: () => void;
  isBusy: boolean;
  isLiveThisTab: boolean;
}) {
  const now = useNow();
  const expiresAt = new Date(session.expiry * 1000);
  const daysLeft =
    now === 0
      ? null
      : Math.max(0, Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));
  const isExpiringSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <li className="border-t border-line py-5 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isExpiringSoon ? "bg-accent" : "bg-success"}`} />
            <h3 className="truncate text-sm font-semibold text-ink">{session.agentName}</h3>
            <span className="text-xs text-faint">#{session.tokenId}</span>
          </div>
          <p className="mt-1 text-xs capitalize text-muted">
            {session.category.replaceAll("-", " ")}
            {" · "}
            <span className={isExpiringSoon ? "text-accent-ink" : "text-success"}>
              {daysLeft === null ? "Active" : `${daysLeft}d left`}
            </span>
          </p>
        </div>
        <button
          className="interactive shrink-0 text-xs font-medium text-muted underline-offset-4 hover:text-danger hover:underline disabled:opacity-50"
          disabled={isBusy}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-canvas px-3 py-2.5">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.08em] text-faint">Spend cap</p>
          <p className="mt-1 text-xs font-semibold text-ink">
            {formatBnb(BigInt(session.spendCapWei))} BNB
            <span className="ml-1 font-normal text-muted">/ {session.spendPeriod}</span>
          </p>
        </div>
        <div className="rounded-lg bg-canvas px-3 py-2.5">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.08em] text-faint">Expires</p>
          <p className="mt-1 text-xs font-semibold text-ink">{expiresAt.toISOString().slice(0, 10)}</p>
        </div>
        <div className="col-span-2 rounded-lg bg-canvas px-3 py-2.5 sm:col-span-1">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.08em] text-faint">Contracts</p>
          <p className="mt-1 text-xs font-semibold text-ink">{session.allowlist.length} allowed</p>
        </div>
      </div>

      {!isLiveThisTab && (
        <p className="mt-3 text-[0.68rem] leading-5 text-faint">
          Session key not held in this tab - still revocable.
        </p>
      )}
      {session.grantTransactionHash && (
        <a
          className="interactive mt-3 inline-flex text-[0.7rem] font-medium text-muted underline-offset-4 hover:text-accent-ink hover:underline"
          href={`https://bscscan.com/tx/${session.grantTransactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          View grant tx
        </a>
      )}
    </li>
  );
}

function WalletSetup() {
  const wallet = useAltanaWallet();
  return (
    <section aria-labelledby="wallet-setup-heading">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16">
        <div>
          <p className="eyebrow">Dolphin Wallet</p>
          <h2
            className="mt-4 max-w-[16ch] text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-5xl"
            id="wallet-setup-heading"
          >
            Create a spending account you can bound.
          </h2>
          <p className="body-copy mt-5 max-w-[58ch]">
            A passkey secures this smart account. It is the only Dolphin account
            that can hold funds or issue a scoped permission to an agent.
          </p>
          <div className="mt-9 border-t border-line">
            {[
              { number: "01", title: "Passkey secured", body: "Confirm with your device biometrics or PIN - no seed phrase." },
              { number: "02", title: "Separate balance", body: "Only funds sent to this address can be used by a session." },
              { number: "03", title: "Explicit limits", body: "Every session shows its allowed contracts, daily cap, expiry, and a revoke button." },
            ].map((item) => (
              <article className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-line py-4" key={item.number}>
                <span className="text-xs font-medium text-faint">{item.number}</span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface-raised self-start p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-ink">Set up Dolphin Wallet</p>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-faint" />
              Not created
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            Your browser will open its native passkey confirmation. Dolphin stores
            the public credential, not a private key.
          </p>
          <button
            className="interactive mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
            disabled={wallet.isBusy}
            onClick={() => void wallet.createWallet()}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="wallet" size={16} strokeWidth={2} />
            {wallet.isBusy ? "Waiting for passkey..." : "Create with a passkey"}
          </button>
          <div className="my-5 flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.1em] text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <button
            className="interactive flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
            disabled={wallet.isBusy}
            onClick={() => void wallet.recoverWallet()}
            type="button"
          >
            Recover an existing wallet
          </button>
          <details className="mt-5 border-t border-line pt-4 text-xs leading-5 text-muted">
            <summary className="cursor-pointer font-medium text-ink underline-offset-4 hover:underline">
              What recovery requires
            </summary>
            <p className="mt-2">
              Recovery uses a Dolphin passkey on this device, and works only for a
              wallet whose admin key is already in Altana&apos;s on-chain KeyStore.
              A key lands there on the wallet&apos;s first on-chain action, so a
              wallet that was created and never used cannot be recovered.
            </p>
            <p className="mt-2">
              This applies to a wallet you are about to create, too. Once it exists,
              this screen reads its KeyStore entry and tells you exactly which side
              of that line it is on — and offers to register it for you.
            </p>
          </details>
          {wallet.error && (
            <p className="mt-5 border-l-2 border-danger bg-danger-soft p-3 text-xs font-medium leading-5 text-danger">
              {wallet.error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Whether THIS wallet could be rebuilt from its passkey on another device.
 *
 * Deliberately not a fixed disclaimer. The answer genuinely differs per wallet
 * and is one `eth_call` away, so the screen reads it and says which it is - see
 * the decision note in altana-policy.ts for why a blanket warning was rejected
 * as hedging rather than honesty.
 */
function RecoverabilityPanel() {
  const wallet = useAltanaWallet();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "registering" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const copy = recoverabilityCopy(wallet.recoverability);
  const fee = wallet.registrationFeeWei;
  // Compared as bigints. A null balance is "unread", never "enough".
  const canAffordFee =
    fee !== null && wallet.balanceWei !== null && wallet.balanceWei > fee;

  const tone =
    wallet.recoverability === "registered"
      ? { border: "border-success", text: "text-success" }
      : wallet.recoverability === "unregistered"
        ? { border: "border-danger", text: "text-danger" }
        : { border: "border-line", text: "text-muted" };

  return (
    <div className={`mt-6 border-l-2 pl-4 ${tone.border}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-semibold ${tone.text}`}>{copy.title}</p>
        <button
          className="interactive shrink-0 text-[0.68rem] font-medium text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
          disabled={wallet.isCheckingRecoverability}
          onClick={() => wallet.refreshRecoverability()}
          type="button"
        >
          {wallet.isCheckingRecoverability ? "Checking..." : "Re-check"}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted">{copy.body}</p>

      {wallet.recoverabilityError && (
        <p className="mt-2 text-xs leading-5 text-danger">{wallet.recoverabilityError}</p>
      )}

      {wallet.recoverability === "unregistered" && (
        <div className="mt-4">
          <p className="text-xs leading-5 text-muted">
            You can register it now without doing anything else. This is an on-chain
            transaction paid from this wallet:{" "}
            <strong className="font-semibold text-ink">
              {fee === null ? "reading fee..." : `${formatBnb(fee)} BNB`}
            </strong>{" "}
            registration fee plus gas. Granting an agent permission or paying one
            does the same thing automatically, so this is only worth doing if you
            want the wallet secured first.
          </p>

          {!canAffordFee && fee !== null && (
            <p className="mt-2 text-xs leading-5 text-danger">
              {wallet.balanceWei === null
                ? "This wallet's balance could not be read, so Dolphin will not start a transaction it cannot price against your funds."
                : `This wallet holds ${formatBnb(wallet.balanceWei)} BNB, which will not cover the ${formatBnb(fee)} BNB fee plus gas. Fund it first.`}
            </p>
          )}

          <button
            className="interactive mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
            disabled={state.kind === "registering" || wallet.isBusy || !canAffordFee}
            onClick={() => {
              setState({ kind: "registering" });
              void wallet.registerWallet().then(
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
            {state.kind === "registering"
              ? "Confirm with passkey..."
              : fee === null
                ? "Make this wallet recoverable"
                : `Make recoverable - ${formatBnb(fee)} BNB + gas`}
          </button>

          {state.kind === "error" && (
            <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-[0.7rem] font-medium leading-5 text-danger">
              {state.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedWallet() {
  const wallet = useAltanaWallet();
  const [confirmForget, setConfirmForget] = useState(false);
  const address = wallet.address!;
  const activeSessions = (wallet.sessions ?? []).filter((s) => s.status === "active");
  const pastSessions = (wallet.sessions ?? []).filter((s) => s.status !== "active");

  return (
    <div className="space-y-12">

      {/* Balance hero */}
      <section aria-label="Wallet overview">
        <div className="surface-raised overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
              <span className="text-xs font-semibold text-ink">Dolphin Wallet</span>
            </div>
            <span className="text-xs text-muted">{wallet.networkLabel} / {wallet.chainId}</span>
          </div>

          <div className="px-5 pt-8 pb-6 sm:px-8 sm:pt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">Balance</p>
            <div className="mt-3 flex items-end gap-3">
              <BnbLogo size={32} />
              {wallet.balanceError ? (
                <p className="text-4xl font-semibold tracking-[-0.06em] text-danger">Unavailable</p>
              ) : wallet.balanceWei === null ? (
                <p className="text-4xl font-semibold tracking-[-0.06em] text-faint">
                  {wallet.isReadingBalance ? "Reading..." : "-"}
                </p>
              ) : (
                <p className="text-5xl font-semibold tracking-[-0.065em] text-ink sm:text-6xl">
                  {formatBnb(wallet.balanceWei)}
                  <span className="ml-2 text-2xl font-normal text-muted">BNB</span>
                </p>
              )}
            </div>
            {wallet.balanceError && (
              <p className="mt-2 text-xs text-danger">{wallet.balanceError}</p>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <p className="font-mono text-sm font-medium text-ink">{truncateAddress(address)}</p>
              <CopyButton label="Copy Dolphin Wallet address" value={address} />
              <a
                className="interactive inline-flex items-center gap-1 text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
                href={`https://bscscan.com/address/${address}`}
                rel="noreferrer"
                target="_blank"
              >
                BscScan
              </a>
            </div>
            <button
              className="interactive shrink-0 text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              disabled={wallet.isReadingBalance}
              onClick={() => void wallet.refreshBalance()}
              type="button"
            >
              {wallet.isReadingBalance ? "Reading..." : "Refresh balance"}
            </button>
          </div>

          {wallet.balanceWei !== null && wallet.balanceWei === BigInt(0) && (
            <div className="border-t border-line bg-accent-soft px-5 py-4 sm:px-6">
              <p className="text-xs font-semibold text-accent-ink">Fund this wallet</p>
              <p className="mt-1 text-xs leading-5 text-muted">{ALTANA_FUNDING_HINT}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{address}</span>
                <CopyButton label="Copy funding address" value={address} />
              </div>
            </div>
          )}
        </div>
        {wallet.error && (
          <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-xs font-medium leading-5 text-danger">
            {wallet.error}
          </p>
        )}

        <RecoverabilityPanel />
      </section>

      {/* Agent permissions */}
      <section aria-labelledby="permissions-heading">
        <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="eyebrow">Agent access</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-ink" id="permissions-heading">
              Active permissions
            </h2>
          </div>
          {!wallet.sessionsUnavailable && wallet.sessions !== undefined && (
            <span className="text-sm text-muted">{activeSessions.length} active</span>
          )}
        </div>

        {wallet.sessionsUnavailable ? (
          <div className="pt-5">
            <StatePanel
              body="Dolphin's backend is not configured, so this page cannot make a claim about active sessions. New grants are refused in this state."
              compact
              state="unavailable"
              title="Permission records unavailable"
            />
          </div>
        ) : wallet.sessions === undefined ? (
          <div className="pt-5">
            <StatePanel
              body="Reading the durable permission records attached to this Dolphin Wallet."
              compact
              state="syncing"
              title="Checking permissions"
            />
          </div>
        ) : activeSessions.length === 0 ? (
          <div className="flex items-start gap-4 py-7">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
              <CategoryGlyph color="currentColor" name="shield" size={18} strokeWidth={2} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">No active spending permissions</p>
              <p className="mt-1 text-sm leading-6 text-muted">
                Read-only hires do not appear here - they receive no spending authority.
              </p>
            </div>
          </div>
        ) : (
          <ul>
            {activeSessions.map((session) => (
              <SessionRow
                isBusy={wallet.isBusy}
                isLiveThisTab={wallet.liveSessionKeys.includes(session.sessionPublicKey)}
                key={session.sessionPublicKey}
                onRevoke={() => void wallet.revokeSession(session.sessionPublicKey)}
                session={session}
              />
            ))}
          </ul>
        )}

        {pastSessions.length > 0 && (
          <details className="border-t border-line pt-5">
            <summary className="cursor-pointer text-sm font-medium text-ink underline-offset-4 hover:underline">
              {pastSessions.length} inactive permission{pastSessions.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-3 border-t border-line">
              {pastSessions.map((session) => (
                <li
                  className="flex items-center justify-between gap-4 border-b border-line py-3 text-xs"
                  key={session.sessionPublicKey}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{session.agentName}</p>
                    <p className="mt-1 text-muted">
                      {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
                      {" · "}#{session.tokenId}
                    </p>
                  </div>
                  <span className="shrink-0 capitalize text-faint">{session.status}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Device access */}
      <section className="border-t border-line pt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Device access</h2>
            <p className="mt-1 max-w-lg text-sm leading-6 text-muted">
              Remove the local wallet record from this browser. This does not
              change the wallet or revoke active permissions on-chain.
            </p>
          </div>
          {confirmForget ? (
            <div className="min-w-[220px]">
              <p className="text-xs font-semibold text-ink">Remove from this browser?</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="interactive min-h-9 flex-1 rounded-xl border border-line px-3 text-xs font-medium text-muted hover:text-ink"
                  onClick={() => setConfirmForget(false)}
                  type="button"
                >
                  Keep it
                </button>
                <button
                  className="interactive min-h-9 flex-1 rounded-xl bg-danger-soft px-3 text-xs font-semibold text-danger hover:bg-danger hover:text-white"
                  onClick={() => { wallet.forgetWallet(); setConfirmForget(false); }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              className="interactive shrink-0 text-sm font-medium text-muted underline-offset-4 hover:text-danger hover:underline"
              onClick={() => setConfirmForget(true)}
              type="button"
            >
              Remove from this browser
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();

  if (wallet.status === "loading") {
    return (
      <div className="max-w-3xl">
        <StatePanel body="Checking this browser for an existing Dolphin Wallet credential." state="syncing" title="Checking this device" />
      </div>
    );
  }
  if (wallet.status === "unsupported") {
    return (
      <div className="max-w-3xl">
        <StatePanel body={wallet.unsupportedReason ?? "This browser cannot create a passkey wallet."} state="unavailable" title="Dolphin Wallet is not supported here" />
      </div>
    );
  }
  if (wallet.status === "no-wallet") {
    return <WalletSetup />;
  }
  return <ConnectedWallet />;
}