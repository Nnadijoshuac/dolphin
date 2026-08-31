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

/* ─────────────── tiny helpers ─────────────── */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className="wallet-copy-btn interactive"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); },
          () => setCopied(false),
        );
      }}
      type="button"
    >
      <CategoryGlyph color="currentColor" name={copied ? "check" : "copy"} size={11} strokeWidth={2} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/* ─────────────── session row ─────────────── */

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
    <li className="wallet-session-row">
      <div className="wallet-session-row__header">
        <div className="wallet-session-row__meta">
          <span
            aria-label={isExpiringSoon ? "expiring soon" : "active"}
            className={`wallet-session-dot ${isExpiringSoon ? "wallet-session-dot--warn" : "wallet-session-dot--ok"}`}
          />
          <span className="wallet-session-row__name">{session.agentName}</span>
          <span className="wallet-session-row__id">#{session.tokenId}</span>
        </div>
        <button
          className="wallet-revoke-btn interactive"
          disabled={isBusy}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      </div>

      <div className="wallet-session-row__chips">
        <div className="wallet-chip">
          <p className="wallet-chip__label">Cap</p>
          <p className="wallet-chip__value">
            {formatBnb(BigInt(session.spendCapWei))} BNB
            <span className="wallet-chip__sub"> / {session.spendPeriod}</span>
          </p>
        </div>
        <div className="wallet-chip">
          <p className="wallet-chip__label">Expires</p>
          <p className={`wallet-chip__value ${isExpiringSoon ? "wallet-chip__value--warn" : ""}`}>
            {daysLeft === null ? "Active" : `${daysLeft}d`}
          </p>
        </div>
        <div className="wallet-chip">
          <p className="wallet-chip__label">Contracts</p>
          <p className="wallet-chip__value">{session.allowlist.length}</p>
        </div>
      </div>

      {session.grantTransactionHash && (
        <a
          className="interactive wallet-session-row__tx"
          href={`https://bscscan.com/tx/${session.grantTransactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          View on BscScan ↗
        </a>
      )}
    </li>
  );
}

/* ─────────────── recoverability ─────────────── */

function RecoverabilityPanel() {
  const wallet = useAltanaWallet();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "registering" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const copy = recoverabilityCopy(wallet.recoverability);
  const fee = wallet.registrationFeeWei;
  const canAffordFee =
    fee !== null && wallet.balanceWei !== null && wallet.balanceWei > fee;

  const isRegistered = wallet.recoverability === "registered";
  const isUnregistered = wallet.recoverability === "unregistered";

  return (
    <div className={`wallet-recoverability ${isRegistered ? "wallet-recoverability--ok" : isUnregistered ? "wallet-recoverability--warn" : ""}`}>
      <div className="wallet-recoverability__row">
        <p className="wallet-recoverability__title">{copy.title}</p>
        <button
          className="interactive wallet-recoverability__recheck"
          disabled={wallet.isCheckingRecoverability}
          onClick={() => wallet.refreshRecoverability()}
          type="button"
        >
          {wallet.isCheckingRecoverability ? "Checking…" : "Re-check"}
        </button>
      </div>
      <p className="wallet-recoverability__body">{copy.body}</p>

      {wallet.recoverabilityError && (
        <p className="wallet-inline-error">{wallet.recoverabilityError}</p>
      )}

      {isUnregistered && (
        <div className="mt-4">
          {!canAffordFee && fee !== null && (
            <p className="wallet-inline-error">
              {wallet.balanceWei === null
                ? "Balance unread — Dolphin won't start a transaction it can't price."
                : `Balance (${formatBnb(wallet.balanceWei)} BNB) too low for the ${formatBnb(fee)} BNB fee + gas.`}
            </p>
          )}
          <button
            className="wallet-action-btn wallet-action-btn--accent interactive mt-3"
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
              ? "Confirm with passkey…"
              : fee === null
                ? "Make recoverable"
                : `Make recoverable — ${formatBnb(fee)} BNB + gas`}
          </button>

          {state.kind === "error" && (
            <p className="wallet-error-banner mt-3">{state.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── setup (no wallet yet) ─────────────── */

function WalletSetup() {
  const wallet = useAltanaWallet();

  return (
    <section className="wallet-setup" aria-labelledby="wallet-setup-heading">
      {/* Left: explanation */}
      <div className="wallet-setup__copy">
        <p className="eyebrow">Dolphin Wallet</p>
        <h1
          className="wallet-setup__headline"
          id="wallet-setup-heading"
        >
          A spending account<br />you control.
        </h1>
        <p className="wallet-setup__sub">
          Secured by your device passkey. No seed phrase. Funds only go where you allow.
        </p>

        <ul className="wallet-setup__pillars">
          {[
            { icon: "shield", label: "Passkey secured", note: "Biometric or PIN — no seed phrase" },
            { icon: "wallet", label: "Separate balance", note: "Only funds you send can be spent" },
            { icon: "info",   label: "Explicit limits",  note: "Cap, contracts, expiry — visible and revocable" },
          ].map((p) => (
            <li className="wallet-setup__pillar" key={p.label}>
              <span className="wallet-setup__pillar-icon">
                <CategoryGlyph color="currentColor" name={p.icon as "shield"} size={15} strokeWidth={2} />
              </span>
              <div>
                <p className="wallet-setup__pillar-label">{p.label}</p>
                <p className="wallet-setup__pillar-note">{p.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: action card */}
      <div className="wallet-setup__card surface-raised">
        <div className="wallet-setup__card-header">
          <p className="wallet-setup__card-title">Create Dolphin Wallet</p>
          <span className="wallet-status-badge wallet-status-badge--idle">Not created</span>
        </div>

        <button
          className="wallet-action-btn wallet-action-btn--accent interactive"
          disabled={wallet.isBusy}
          onClick={() => void wallet.createWallet()}
          type="button"
        >
          <CategoryGlyph color="currentColor" name="wallet" size={15} strokeWidth={2} />
          {wallet.isBusy ? "Waiting for passkey…" : "Create with passkey"}
        </button>

        <div className="wallet-divider">
          <span className="wallet-divider__line" />
          <span className="wallet-divider__text">or</span>
          <span className="wallet-divider__line" />
        </div>

        <button
          className="wallet-action-btn wallet-action-btn--ghost interactive"
          disabled={wallet.isBusy}
          onClick={() => void wallet.recoverWallet()}
          type="button"
        >
          Recover existing wallet
        </button>

        <details className="wallet-setup__recovery-note">
          <summary>What recovery requires</summary>
          <p>
            Recovery needs a Dolphin passkey on this device and works only for
            a wallet whose admin key is already in Altana&apos;s on-chain KeyStore.
            A wallet that was created and never used cannot yet be recovered.
          </p>
        </details>

        {wallet.error && (
          <p className="wallet-error-banner">{wallet.error}</p>
        )}
      </div>
    </section>
  );
}

/* ─────────────── connected state ─────────────── */

function ConnectedWallet() {
  const wallet = useAltanaWallet();
  const [confirmForget, setConfirmForget] = useState(false);
  const address = wallet.address!;
  const activeSessions = (wallet.sessions ?? []).filter((s) => s.status === "active");
  const pastSessions = (wallet.sessions ?? []).filter((s) => s.status !== "active");

  return (
    <div className="wallet-dashboard">

      {/* ── Balance card ── */}
      <section className="wallet-balance-card surface-raised" aria-label="Wallet overview">
        <div className="wallet-balance-card__top">
          <div className="wallet-balance-card__badge">
            <span aria-hidden="true" className="wallet-live-dot" />
            <span>Dolphin Wallet</span>
          </div>
          <span className="wallet-balance-card__network">
            {wallet.networkLabel} · {wallet.chainId}
          </span>
        </div>

        <div className="wallet-balance-card__body">
          <p className="wallet-balance-card__label">Balance</p>
          <div className="wallet-balance-card__amount">
            <BnbLogo size={28} />
            {wallet.balanceError ? (
              <span className="wallet-balance-card__figure wallet-balance-card__figure--error">Unavailable</span>
            ) : wallet.balanceWei === null ? (
              <span className="wallet-balance-card__figure wallet-balance-card__figure--muted">
                {wallet.isReadingBalance ? "Reading…" : "—"}
              </span>
            ) : (
              <span className="wallet-balance-card__figure">
                {formatBnb(wallet.balanceWei)}
                <span className="wallet-balance-card__unit">BNB</span>
              </span>
            )}
          </div>
          {wallet.balanceError && (
            <p className="wallet-inline-error mt-1">{wallet.balanceError}</p>
          )}
        </div>

        <div className="wallet-balance-card__footer">
          <div className="wallet-balance-card__address">
            <code className="wallet-balance-card__addr-text">{truncateAddress(address)}</code>
            <CopyButton label="Copy wallet address" value={address} />
            <a
              className="interactive wallet-balance-card__bscscan"
              href={`https://bscscan.com/address/${address}`}
              rel="noreferrer"
              target="_blank"
            >
              BscScan ↗
            </a>
          </div>
          <button
            className="interactive wallet-balance-card__refresh"
            disabled={wallet.isReadingBalance}
            onClick={() => void wallet.refreshBalance()}
            type="button"
          >
            {wallet.isReadingBalance ? "Reading…" : "Refresh"}
          </button>
        </div>

        {/* Zero balance funding prompt */}
        {wallet.balanceWei !== null && wallet.balanceWei === BigInt(0) && (
          <div className="wallet-fund-banner">
            <div className="wallet-fund-banner__row">
              <p className="wallet-fund-banner__title">Fund this wallet to get started</p>
              <CopyButton label="Copy funding address" value={address} />
            </div>
            <code className="wallet-fund-banner__address">{address}</code>
            <p className="wallet-fund-banner__hint">{ALTANA_FUNDING_HINT}</p>
          </div>
        )}
      </section>

      {wallet.error && <p className="wallet-error-banner">{wallet.error}</p>}

      <RecoverabilityPanel />

      {/* ── Active permissions ── */}
      <section aria-labelledby="permissions-heading" className="wallet-section">
        <div className="wallet-section__header">
          <div>
            <p className="eyebrow">Agent access</p>
            <h2 className="wallet-section__title" id="permissions-heading">Permissions</h2>
          </div>
          {!wallet.sessionsUnavailable && wallet.sessions !== undefined && (
            <span className="wallet-count-badge">{activeSessions.length} active</span>
          )}
        </div>

        {wallet.sessionsUnavailable ? (
          <StatePanel
            body="Backend not configured — active sessions cannot be shown. New grants are refused."
            compact
            state="unavailable"
            title="Permission records unavailable"
          />
        ) : wallet.sessions === undefined ? (
          <StatePanel
            body="Reading permission records…"
            compact
            state="syncing"
            title="Checking permissions"
          />
        ) : activeSessions.length === 0 ? (
          <div className="wallet-empty-permissions">
            <span className="wallet-empty-permissions__icon">
              <CategoryGlyph color="currentColor" name="shield" size={16} strokeWidth={2} />
            </span>
            <div>
              <p className="wallet-empty-permissions__title">No active permissions</p>
              <p className="wallet-empty-permissions__sub">Read-only hires receive no spending authority.</p>
            </div>
          </div>
        ) : (
          <ul className="wallet-sessions-list">
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
          <details className="wallet-past-sessions">
            <summary>
              {pastSessions.length} inactive permission{pastSessions.length === 1 ? "" : "s"}
            </summary>
            <ul className="wallet-past-sessions__list">
              {pastSessions.map((session) => (
                <li className="wallet-past-sessions__row" key={session.sessionPublicKey}>
                  <div>
                    <p className="wallet-past-sessions__name">{session.agentName}</p>
                    <p className="wallet-past-sessions__meta">
                      {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
                      {" · "}#{session.tokenId}
                    </p>
                  </div>
                  <span className="wallet-past-sessions__status">{session.status}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── Device access / danger zone ── */}
      <section className="wallet-danger-zone" aria-label="Device access">
        <div className="wallet-danger-zone__body">
          <p className="wallet-danger-zone__title">Remove from this device</p>
          <p className="wallet-danger-zone__sub">
            Clears the local record only. Active permissions on-chain are unchanged.
          </p>
        </div>
        {confirmForget ? (
          <div className="wallet-danger-zone__confirm">
            <p className="wallet-danger-zone__confirm-label">Remove wallet from this browser?</p>
            <div className="wallet-danger-zone__confirm-actions">
              <button
                className="wallet-action-btn wallet-action-btn--ghost interactive"
                onClick={() => setConfirmForget(false)}
                type="button"
              >
                Keep it
              </button>
              <button
                className="wallet-action-btn wallet-action-btn--danger interactive"
                onClick={() => { wallet.forgetWallet(); setConfirmForget(false); }}
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            className="interactive wallet-danger-zone__trigger"
            onClick={() => setConfirmForget(true)}
            type="button"
          >
            Remove
          </button>
        )}
      </section>

    </div>
  );
}

/* ─────────────── public export ─────────────── */

export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();

  if (wallet.status === "loading") {
    return (
      <div className="wallet-loading">
        <StatePanel body="Checking this browser for a Dolphin Wallet credential." state="syncing" title="Checking device" />
      </div>
    );
  }
  if (wallet.status === "unsupported") {
    return (
      <div className="wallet-loading">
        <StatePanel body={wallet.unsupportedReason ?? "This browser cannot create a passkey wallet."} state="unavailable" title="Wallet not supported" />
      </div>
    );
  }
  if (wallet.status === "no-wallet") {
    return <WalletSetup />;
  }
  return <ConnectedWallet />;
}