"use client";

import { useState } from "react";
import { useBalance } from "wagmi";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import type { AgentSessionRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import {
  ALTANA_FUNDING_HINT,
  FEATURE_SESSION_EXECUTION,
  formatBnb,
  recoverabilityCopy,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

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

      {/*
       * Three mutually exclusive branches, never a disabled button.
       *
       * This used to render "Make recoverable — 0.000723 BNB + gas" greyed out
       * above a line explaining the balance was too low. That is a dead end: the
       * only control offered is one the user cannot use, and the thing that
       * WOULD unblock them (depositing) is not offered at all. Every Dolphin
       * Wallet in existence is empty, so that dead end was the state every user
       * actually saw.
       *
       * Now the panel offers the action that is genuinely available at each
       * point: deposit when short, register when funded, and neither when the
       * fee could not be read — because an action Dolphin cannot price is one it
       * must not put a button behind (AGENTS.md §5).
       */}
      {isUnregistered && (
        <div className="mt-4">
          {fee === null ? (
            <p className="wallet-inline-error">
              The registration fee could not be read just now, so Dolphin will not
              offer an action it cannot price for you. Re-check to try again.
            </p>
          ) : !canAffordFee ? (
            <div className="wallet-fund-banner">
              <div className="wallet-fund-banner__row">
                <p className="wallet-fund-banner__title">
                  Deposit BNB to make this wallet recoverable
                </p>
                {wallet.address && (
                  <CopyButton label="Copy wallet address" value={wallet.address} />
                )}
              </div>
              <code className="wallet-fund-banner__address">{wallet.address}</code>
              <p className="wallet-fund-banner__hint">
                {/*
                 * The fee is stated exactly because it was read from the chain.
                 * Gas is named but NOT quantified — Dolphin has not measured it
                 * and will not print a plausible-looking guess beside a real
                 * figure. "plus relay gas" is the honest amount of precision.
                 */}
                Registration costs {formatBnb(fee)} BNB plus relay gas, paid by
                this wallet. It currently holds{" "}
                {wallet.balanceWei === null
                  ? "an amount Dolphin could not read"
                  : `${formatBnb(wallet.balanceWei)} BNB`}
                . Send BNB to the address above, then re-check.
              </p>
            </div>
          ) : (
            <button
              className="wallet-action-btn wallet-action-btn--accent interactive"
              disabled={state.kind === "registering" || wallet.isBusy}
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
                : `Make recoverable — ${formatBnb(fee)} BNB + gas`}
            </button>
          )}

          {state.kind === "error" && (
            <p className="wallet-error-banner mt-3">{state.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── nothing connected at all ─────────────── */

/**
 * The only thing shown when neither wallet exists yet.
 *
 * Deliberately one decision on the screen. The Dolphin Wallet creation panel
 * used to live here too, which meant a first-time visitor's opening choice was
 * between two different wallets whose distinction they had not been told yet.
 * Connecting an address is the cheaper, more familiar, and completely
 * reversible one, so it goes first and alone.
 */
function ConnectFirstPanel() {
  return (
    <section className="wallet-setup" aria-labelledby="wallet-connect-heading">
      <div className="wallet-setup__copy">
        <p className="eyebrow">Wallet</p>
        <h1 className="wallet-setup__headline" id="wallet-connect-heading">
          Connect a wallet<br />to get started.
        </h1>
        <p className="wallet-setup__sub">
          Dolphin reads only your public address, to remember which agents you
          have hired. No agent is ever given permission to spend from it.
        </p>
      </div>

      <div className="wallet-setup__card surface-raised">
        <div className="wallet-setup__card-header">
          <p className="wallet-setup__card-title">Your wallet</p>
          <span className="wallet-status-badge wallet-status-badge--idle">Not connected</span>
        </div>
        <WalletConnectButton connectLabel="Connect wallet" />
      </div>
    </section>
  );
}

/* ─────────────── setup (no agent wallet yet) ─────────────── */

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
        {/*
         * Stated outright, because this panel now sits under a connected
         * identity card and could otherwise read as a required second step.
         * It is not: browsing, hiring and managing agents all work without a
         * Dolphin Wallet. It is only needed to PAY an agent.
         */}
        <p className="wallet-setup__sub">
          <strong>Optional.</strong> You can browse, hire and manage agents
          without one — you only need it to pay an agent.
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

/* ─────────────── quick action button ─────────────── */

function WalletAction({ icon, label, href, onClick, disabled }: {
  icon: string;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls = "wcard__action interactive";
  const inner = (
    <>
      <span className="wcard__action-icon" aria-hidden="true">{icon}</span>
      <span className="wcard__action-label">{label}</span>
    </>
  );
  if (href) {
    return <a className={cls} href={href} rel="noreferrer" target="_blank">{inner}</a>;
  }
  return (
    <button className={cls} disabled={disabled} onClick={onClick} type="button">
      {inner}
    </button>
  );
}

/* ─────────────── identity wallet card (wagmi) ─────────────── */

function IdentityWalletCard() {
  const identity = useWallet();
  const { data: balData, isLoading: balLoading } = useBalance({
    address: identity.address as `0x${string}` | undefined,
    query: { enabled: Boolean(identity.isConnected && identity.address) },
  });

  if (!identity.isConnected || !identity.address) {
    return (
      <div className="wcard wcard--identity wcard--dim" aria-label="Identity wallet">
        <div className="wcard__eyebrow">
          <span className="wcard__eyebrow-icon">👤</span>
          Your wallet
        </div>
        <p className="wcard__hero-balance wcard__hero-balance--muted">—</p>
        <p className="wcard__hero-sub">Not connected</p>
        {/*
         * No action row in the disconnected state, deliberately.
         *
         * It previously rendered disabled Send / Receive / Swap buttons. Two of
         * those three were features this app does not have at all (Send was
         * wired to an empty handler; Swap was never implemented anywhere), so
         * the row advertised capabilities that do not exist and would not exist
         * after connecting either. A disabled control still makes a promise.
         * The hint below is the only honest thing to show here.
         */}
        <div className="wcard__asset-row wcard__asset-row--empty">
          <span className="wcard__asset-row-hint">Connect identity wallet above ↑</span>
        </div>
      </div>
    );
  }

  /*
   * Formatted with the SAME helper the agent card uses, deliberately.
   *
   * This previously did its own `Number(value / 10n**14n) / 10000` then
   * `.toFixed(4)`, which truncated to 4 decimals while the agent card's
   * formatBnb keeps 6. Two cards on one screen, both denominated in BNB on the
   * same chain, disagreed about the same quantity: a balance that rendered as
   * "0.00001" on one showed as "0.0000" on the other, which reads as "empty"
   * when it is not. Sharing formatBnb makes that class of mismatch impossible
   * rather than merely fixed once.
   *
   * It also drops a float conversion from a wei value — formatBnb stays in
   * bigint arithmetic, so a large balance cannot lose precision.
   */
  const bnbStr = balLoading ? "…" : balData ? formatBnb(balData.value) : "—";

  return (
    <div className="wcard wcard--identity surface-raised" aria-label="Identity wallet">
      <div className="wcard__top-row">
        <div className="wcard__eyebrow">
          <span className="wcard__eyebrow-icon">👤</span>
          Your wallet
        </div>
        <code className="wcard__addr-pill">{truncateAddress(identity.address)}</code>
      </div>

      {/* Hero balance */}
      <p className="wcard__hero-balance">
        {bnbStr}
        <span className="wcard__hero-unit">BNB</span>
      </p>
      <p className="wcard__hero-sub">Identity · hire records</p>

      {/*
       * Quick actions. Every control here does something real.
       *
       * "Send" was removed rather than disabled: it was wired to an empty
       * handler (`onClick={() => { /* future *\/ }}`), so it rendered as a live
       * button that silently did nothing. Dolphin never moves funds out of the
       * identity wallet — that wallet is the user's own MetaMask/WalletConnect
       * account and they already have a full wallet UI for sending. Offering a
       * worse copy of it here would be a dead end at best.
       */}
      <div className="wcard__actions">
        <WalletAction icon="↓" label="Receive" onClick={() => {
          void navigator.clipboard?.writeText(identity.address!);
        }} />
        <WalletAction
          href={`https://bscscan.com/address/${identity.address}`}
          icon="↗"
          label="BscScan"
        />
      </div>

      {/* Asset row */}
      <div className="wcard__asset-list">
        <div className="wcard__asset-row">
          <span className="wcard__asset-icon"><BnbLogo size={18} /></span>
          <span className="wcard__asset-name">BNB</span>
          <span className="wcard__asset-sub">BNB Smart Chain</span>
          <span className="wcard__asset-amount">{bnbStr} BNB</span>
        </div>
      </div>
    </div>
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

      {/* ── Dual wallet cards ── */}
      <section aria-label="Wallets overview" className="wallet-dual-section">

        {/* Agent card (Dolphin / Altana passkey) */}
        <div className="wcard wcard--agent surface-raised">
          <div className="wcard__top-row">
            {/*
             * "Agent Payments", not "For agents" / "Agent spending".
             *
             * The old wording was ambiguous in a money-shaped way: it read as
             * though this account holds what an agent EARNS. It does not, and
             * there is no code path that would put earnings here — a paid hire
             * sends $U to the agent's own registered ERC-8004 wallet
             * (convex/agentPayments.ts verifies the payee against it). This
             * balance is outbound only: funds the USER deposits in order to pay
             * agents. The subcopy below says so in as many words.
             */}
            <div className="wcard__eyebrow">
              <span className="wcard__eyebrow-icon">⚡</span>
              Agent Payments
            </div>
            <code className="wcard__addr-pill">{truncateAddress(address)}</code>
          </div>

          {/* Hero balance */}
          <p className={`wcard__hero-balance${
            wallet.balanceError ? " wcard__hero-balance--error" :
            wallet.balanceWei === null ? " wcard__hero-balance--muted" : ""
          }`}>
            {wallet.balanceError ? "Unavailable" :
             wallet.balanceWei === null ? (wallet.isReadingBalance ? "…" : "—") :
             formatBnb(wallet.balanceWei)}
            {!wallet.balanceError && wallet.balanceWei !== null && (
              <span className="wcard__hero-unit">BNB</span>
            )}
          </p>
          <p className="wcard__hero-sub">Funds you send to pay agents you hire</p>

          {/* Quick actions */}
          <div className="wcard__actions">
            <WalletAction
              icon="↓"
              label="Deposit"
              onClick={() => void navigator.clipboard?.writeText(address)}
            />
            {/* Labelled "BscScan" to match the identity card and the session
                rows below — one name for one destination, not two. */}
            <WalletAction
              href={`https://bscscan.com/address/${address}`}
              icon="↗"
              label="BscScan"
            />
            <WalletAction
              disabled={wallet.isReadingBalance}
              icon="↻"
              label="Refresh"
              onClick={() => void wallet.refreshBalance()}
            />
          </div>

          {/* Asset row */}
          <div className="wcard__asset-list">
            <div className="wcard__asset-row">
              <span className="wcard__asset-icon"><BnbLogo size={18} /></span>
              <span className="wcard__asset-name">BNB</span>
              <span className="wcard__asset-sub">Dolphin Wallet · passkey-secured</span>
              <span className="wcard__asset-amount">
                {wallet.balanceWei !== null ? `${formatBnb(wallet.balanceWei)} BNB` : "—"}
              </span>
            </div>
          </div>

          {/* Agent-flavour watermark glyph */}
          <span aria-hidden="true" className="wcard__watermark">⚡</span>
        </div>

        {/* Identity card (wagmi MetaMask / WalletConnect) */}
        <IdentityWalletCard />
      </section>

      {/* Refresh + network row */}
      <div className="wallet-meta-row">
        <span className="wallet-meta-row__network">{wallet.networkLabel} · {wallet.chainId}</span>
        <button
          className="interactive wallet-balance-card__refresh"
          disabled={wallet.isReadingBalance}
          onClick={() => void wallet.refreshBalance()}
          type="button"
        >
          {wallet.isReadingBalance ? "Reading…" : "Refresh agent balance"}
        </button>
      </div>

      {/* Zero balance funding prompt */}
      {wallet.balanceWei !== null && wallet.balanceWei === BigInt(0) && (
        <div className="wallet-fund-banner">
          <div className="wallet-fund-banner__row">
            <p className="wallet-fund-banner__title">Fund the agent wallet to get started</p>
            <CopyButton label="Copy funding address" value={address} />
          </div>
          <code className="wallet-fund-banner__address">{address}</code>
          <p className="wallet-fund-banner__hint">{ALTANA_FUNDING_HINT}</p>
        </div>
      )}

      {wallet.error && <p className="wallet-error-banner">{wallet.error}</p>}

      <RecoverabilityPanel />

      {/*
       * ── Active permissions ──
       *
       * Gated off by FEATURE_SESSION_EXECUTION (see altana-policy.ts for the
       * full reasoning). `false &&` removes this from the rendered tree
       * entirely rather than disabling controls inside it, while keeping the
       * markup type-checked and one flag away from returning.
       *
       * Why it is off: a granted session's signing key never reaches an agent
       * and nothing in this app can execute with one, so this panel listed
       * permissions that no party could exercise - and the Grant button that
       * fed it charged real BNB in gas to create them.
       */}
      {FEATURE_SESSION_EXECUTION && (
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
      )}

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

/**
 * Decides which wallet layout the screen shows.
 *
 * ---------------------------------------------------------------------------
 * FIXED (2026-09-01): the identity card no longer depends on the agent wallet.
 * ---------------------------------------------------------------------------
 * This used to branch on `wallet.status` ALONE, and that status describes only
 * the Altana/Dolphin wallet - altana-provider.tsx derives it as
 * `stored ? "connected" : "no-wallet"`, where `stored` is the passkey
 * credential in localStorage. IdentityWalletCard is rendered inside
 * ConnectedWallet, so it was reachable only once a Dolphin Wallet existed.
 *
 * The effect: someone could connect MetaMask and see no trace of it, because
 * the screen was still showing "create a Dolphin Wallet". Two independent
 * accounts, one of them gating the other's visibility for no reason.
 *
 * The two are now read independently, which is what they always were:
 *
 *   agent wallet exists            -> full dual dashboard (unchanged)
 *   no agent wallet, not connected -> one Connect prompt, nothing else
 *   no agent wallet, connected     -> identity card NOW, plus an explicitly
 *                                     optional Dolphin Wallet panel
 *
 * Note the agent-wallet branch comes FIRST and ignores `identity.isConnected`.
 * A Dolphin Wallet can hold real funds, so once one exists it is shown
 * regardless - hiding it because no MetaMask happens to be connected would be
 * hiding someone's money. IdentityWalletCard already renders its own
 * "Not connected" state in that case.
 *
 * This changes VISIBILITY only. createPasskeyWallet is untouched and remains a
 * separate, explicit, user-initiated action - nothing here auto-creates a
 * wallet or makes one a precondition for anything else.
 */
export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();
  const identity = useWallet();

  if (wallet.status === "loading") {
    return (
      <div className="wallet-loading">
        <StatePanel body="Checking this browser for a Dolphin Wallet credential." state="syncing" title="Checking device" />
      </div>
    );
  }

  // An agent wallet exists: show everything, exactly as before.
  if (wallet.status === "connected") {
    return <ConnectedWallet />;
  }

  // No agent wallet and no connected address: a single decision.
  if (!identity.isConnected) {
    return <ConnectFirstPanel />;
  }

  // Connected, no agent wallet yet. The identity card appears immediately; the
  // Dolphin Wallet is offered beside it as an optional next step.
  return (
    <div className="wallet-dashboard">
      <section aria-label="Wallets overview" className="wallet-dual-section wallet-dual-section--single">
        <IdentityWalletCard />
      </section>

      {/*
       * WebAuthn unavailable is now a note beside a working identity card,
       * rather than a full-screen state that hid the connected address too.
       * The browser cannot hold a Dolphin Wallet; it can still hire agents.
       */}
      {wallet.status === "unsupported" ? (
        <StatePanel
          body={wallet.unsupportedReason ?? "This browser cannot create a passkey wallet."}
          state="unavailable"
          title="Dolphin Wallet not supported in this browser"
        />
      ) : (
        <WalletSetup />
      )}
    </div>
  );
}