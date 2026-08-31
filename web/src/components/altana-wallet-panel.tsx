"use client";

import { useState } from "react";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import type { AgentSessionRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import { ALTANA_FUNDING_HINT, formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      aria-label={label}
      className="interactive inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-[0.7rem] font-medium text-muted hover:bg-canvas hover:text-ink"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          },
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <CategoryGlyph
        color="currentColor"
        name={copied ? "check" : "copy"}
        size={12}
        strokeWidth={2}
      />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SeparateWalletNotice() {
  return (
    <div className="border-l-2 border-accent pl-4">
      <p className="text-xs font-semibold text-ink">Separate from your identity wallet</p>
      <p className="mt-1 text-xs leading-5 text-muted">
        The Dolphin Wallet has its own address and balance. It cannot see or use
        funds in MetaMask, Trust Wallet, or another browser wallet. BNB must be
        sent here before a scoped session can spend it.
      </p>
    </div>
  );
}

function SessionRow({
  session,
  onRevoke,
  isBusy,
  isLiveThisTab,
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
      : Math.max(
          0,
          Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)),
        );

  return (
    <li className="border-t border-line py-5 first:border-t-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-semibold tracking-[-0.025em] text-ink">
              {session.agentName}
            </h3>
            <span className="text-xs text-faint">Agent #{session.tokenId}</span>
          </div>
          <p className="mt-1 text-xs capitalize text-muted">
            {session.category.replaceAll("-", " ")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              daysLeft !== null && daysLeft <= 3 ? "text-accent-ink" : "text-success"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                daysLeft !== null && daysLeft <= 3 ? "bg-accent" : "bg-success"
              }`}
            />
            {daysLeft === null ? "Active" : `${daysLeft} days left`}
          </span>
          <button
            className="interactive text-xs font-medium text-muted underline-offset-4 hover:text-danger hover:underline disabled:opacity-50"
            disabled={isBusy}
            onClick={onRevoke}
            type="button"
          >
            Revoke
          </button>
        </div>
      </div>

      <dl className="mt-5 grid border-l border-t border-line text-xs sm:grid-cols-2">
        <div className="border-b border-r border-line p-3.5">
          <dt className="text-faint">Spend cap</dt>
          <dd className="mt-1 font-semibold text-ink">
            {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
          </dd>
        </div>
        <div className="border-b border-r border-line p-3.5">
          <dt className="text-faint">Expires</dt>
          <dd className="mt-1 font-semibold text-ink">
            {expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </dd>
        </div>
        <div className="border-b border-r border-line p-3.5 sm:col-span-2">
          <dt className="text-faint">Allowed contracts</dt>
          <dd className="mt-2 space-y-2">
            {session.allowlist.map((contract) => (
              <div
                className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)]"
                key={contract.address}
              >
                <span className="font-medium text-ink">{contract.label}</span>
                <span className="break-all font-mono text-[0.65rem] text-muted">
                  {contract.address}
                </span>
              </div>
            ))}
          </dd>
        </div>
      </dl>

      {!isLiveThisTab ? (
        <p className="mt-4 border-l-2 border-line-strong pl-3 text-[0.7rem] leading-5 text-muted">
          This tab does not hold the session signing key. The permission remains
          active on-chain and can still be revoked here.
        </p>
      ) : null}

      {session.grantTransactionHash ? (
        <a
          className="interactive mt-4 inline-flex text-xs font-medium text-ink underline-offset-4 hover:text-accent-ink hover:underline"
          href={`https://bscscan.com/tx/${session.grantTransactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          View grant transaction ↗
        </a>
      ) : null}
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
              {
                number: "01",
                title: "Passkey secured",
                body: "Confirm with your device biometrics or PIN instead of entering a seed phrase into Dolphin.",
              },
              {
                number: "02",
                title: "Separate balance",
                body: "Only funds sent to this address can be used by a session.",
              },
              {
                number: "03",
                title: "Explicit limits",
                body: "Every session shows its allowed contracts, daily cap, expiry, and revoke action.",
              },
            ].map((item) => (
              <article
                className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-line py-4"
                key={item.number}
              >
                <span className="text-xs font-medium text-faint">{item.number}</span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-7 max-w-xl">
            <SeparateWalletNotice />
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
            the public credential required to recover this account, not a private key.
          </p>

          <button
            className="interactive mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
            disabled={wallet.isBusy}
            onClick={() => void wallet.createWallet()}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="wallet" size={16} strokeWidth={2} />
            {wallet.isBusy ? "Waiting for passkey…" : "Create with a passkey"}
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
              Recovery uses a Dolphin passkey on this device. The wallet must have
              completed at least one prior transaction so its admin key exists in
              Altana&apos;s on-chain registry. A never-used wallet has no on-chain
              recovery record yet.
            </p>
          </details>

          {wallet.error ? (
            <p className="mt-5 border-l-2 border-danger bg-danger-soft p-3 text-xs font-medium leading-5 text-danger">
              {wallet.error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ConnectedWallet() {
  const wallet = useAltanaWallet();
  const [confirmForget, setConfirmForget] = useState(false);
  const address = wallet.address!;
  const activeSessions = (wallet.sessions ?? []).filter(
    (session) => session.status === "active",
  );
  const pastSessions = (wallet.sessions ?? []).filter(
    (session) => session.status !== "active",
  );

  return (
    <div>
      <section aria-labelledby="wallet-overview-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Dolphin Wallet</p>
            <h2
              className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl"
              id="wallet-overview-heading"
            >
              Account overview
            </h2>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
            {wallet.networkLabel} · {wallet.chainId}
          </span>
        </div>

        <div className="mt-8 grid border-l border-t border-line lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
          <div className="border-b border-r border-line p-5 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                Account address
              </p>
              <CopyButton label="Copy Dolphin Wallet address" value={address} />
            </div>
            <p className="mt-6 break-all font-mono text-base font-medium leading-7 text-ink sm:text-lg">
              {address}
            </p>
            <a
              className="interactive mt-5 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
              href={`https://bscscan.com/address/${address}`}
              rel="noreferrer"
              target="_blank"
            >
              Open on BscScan ↗
            </a>
          </div>

          <div className="border-b border-r border-line p-5 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                Native balance
              </p>
              <button
                className="interactive text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                disabled={wallet.isReadingBalance}
                onClick={() => void wallet.refreshBalance()}
                type="button"
              >
                {wallet.isReadingBalance ? "Reading…" : "Refresh"}
              </button>
            </div>
            <div className="mt-6 flex items-end gap-3">
              <BnbLogo size={30} />
              {wallet.balanceError ? (
                <p className="text-2xl font-semibold tracking-[-0.035em] text-danger">
                  Unavailable
                </p>
              ) : wallet.balanceWei === null ? (
                <p className="text-2xl font-semibold tracking-[-0.035em] text-faint">
                  {wallet.isReadingBalance ? "Reading…" : "Not read yet"}
                </p>
              ) : (
                <p className="text-4xl font-semibold tracking-[-0.055em] text-ink">
                  {formatBnb(wallet.balanceWei)} <span className="text-lg text-muted">BNB</span>
                </p>
              )}
            </div>
            <p className="mt-4 text-xs text-faint">
              {wallet.balanceWei === null
                ? "No balance is assumed while the read is unresolved."
                : `Read from BNB Smart Chain · ${wallet.chainId}`}
            </p>
          </div>
        </div>

        {wallet.balanceError ? (
          <p className="mt-3 break-words text-xs leading-5 text-danger">{wallet.balanceError}</p>
        ) : null}

        {wallet.balanceWei !== null && wallet.balanceWei === BigInt(0) ? (
          <div className="mt-7 grid gap-5 border-y border-line py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div>
              <p className="text-sm font-semibold text-ink">Fund this wallet</p>
              <p className="mt-1 text-xs leading-5 text-muted">Balance is currently 0 BNB.</p>
            </div>
            <div>
              <p className="text-xs leading-5 text-muted">{ALTANA_FUNDING_HINT}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 break-all font-mono text-xs font-medium text-ink">
                  {address}
                </span>
                <CopyButton label="Copy funding address" value={address} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-7 max-w-2xl">
          <SeparateWalletNotice />
        </div>

        {wallet.error ? (
          <p className="mt-5 border-l-2 border-danger bg-danger-soft p-3 text-xs font-medium leading-5 text-danger">
            {wallet.error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="permissions-heading" className="mt-14 border-t border-line pt-10 sm:mt-20 sm:pt-12">
        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
          <header>
            <p className="eyebrow">Agent access</p>
            <h2
              className="mt-3 text-xl font-semibold tracking-[-0.035em] text-ink"
              id="permissions-heading"
            >
              Permissions
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Exact spend caps, allowed contracts, expiry, and revocation status.
            </p>
          </header>

          <div>
            <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
              <p className="text-sm font-semibold text-ink">Active sessions</p>
              {!wallet.sessionsUnavailable && wallet.sessions !== undefined ? (
                <span className="text-sm text-muted">{activeSessions.length} active</span>
              ) : null}
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
              <div className="py-7">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
                    <CategoryGlyph color="currentColor" name="shield" size={18} strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">No active spending permissions</p>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                      Read-only hires do not appear here because they receive no
                      spending authority.
                    </p>
                  </div>
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

            {pastSessions.length > 0 ? (
              <details className="border-t border-line pt-5">
                <summary className="cursor-pointer text-sm font-medium text-ink underline-offset-4 hover:underline">
                  {pastSessions.length} inactive permission
                  {pastSessions.length === 1 ? "" : "s"}
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
                          {" · "}agent #{session.tokenId}
                        </p>
                      </div>
                      <span className="shrink-0 capitalize text-faint">{session.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-14 border-t border-line pt-8 sm:mt-20">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.025em] text-ink">
              Device access
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Remove the local wallet record from this browser. This does not
              change the wallet or revoke active permissions on-chain.
            </p>
          </div>
          {confirmForget ? (
            <div className="min-w-[260px]">
              <p className="text-xs font-semibold text-ink">Remove it from this browser?</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="interactive min-h-10 flex-1 rounded-xl border border-line px-3 text-xs font-medium text-muted hover:text-ink"
                  onClick={() => setConfirmForget(false)}
                  type="button"
                >
                  Keep it
                </button>
                <button
                  className="interactive min-h-10 flex-1 rounded-xl bg-danger-soft px-3 text-xs font-semibold text-danger hover:bg-danger hover:text-white"
                  onClick={() => {
                    wallet.forgetWallet();
                    setConfirmForget(false);
                  }}
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
        <StatePanel
          body="Checking this browser for an existing Dolphin Wallet credential."
          state="syncing"
          title="Checking this device"
        />
      </div>
    );
  }

  if (wallet.status === "unsupported") {
    return (
      <div className="max-w-3xl">
        <StatePanel
          body={wallet.unsupportedReason ?? "This browser cannot create a passkey wallet."}
          state="unavailable"
          title="Dolphin Wallet is not supported here"
        />
      </div>
    );
  }

  if (wallet.status === "no-wallet") {
    return <WalletSetup />;
  }

  return <ConnectedWallet />;
}
