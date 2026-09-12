"use client";

import { useState } from "react";
import { useBalance } from "wagmi";

import { AgentActivity } from "@/components/agent-activity";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ReceiveSheet } from "@/components/receive-sheet";
import { StatePanel } from "@/components/state-panel";
import { WalletAvatar } from "@/components/wallet-avatar";
import type { AgentSessionRow } from "@/convex/api";
import { useBnbPrice, type BnbPriceState } from "@/hooks/use-bnb-price";
import { useNow } from "@/hooks/use-now";
import { useAppStore, type DisplayCurrency } from "@/store/use-app-store";
import {
  ALTANA_CHAIN_ID,
  ALTANA_NETWORK_LABEL,
  FEATURE_SESSION_EXECUTION,
  formatBnb,
  recoverabilityCopy,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatUsdFromWei } from "@/wallet/bnb-price";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { summariseTotal } from "@/wallet/wallet-total";

/* ═══════════════════════════════════════════════════════════════════════════
   THE WALLET SCREEN
   ═══════════════════════════════════════════════════════════════════════════

   Rebuilt 2026-09-12, then rebuilt again the same day against the note
   "too stiff — think skeuomorphism, and little is more".

   Those two pull against each other, and the resolution is the whole design:
   FEWER ELEMENTS, EACH ONE PHYSICAL. Not textures and stitching — depth that
   means something. A raised hero that catches light on its top edge. Buttons
   that travel down under the finger. A balance sunk into the surface like a
   display window. A QR on its own plate, because it is the thing a camera is
   pointed at.

   Skeuomorphism earns its keep when the material tells you what a thing does.
   It becomes costume when it decorates something that was already clear. Every
   effect here is attached to an affordance; none is attached to a label.

   "Little is more" showed up as deletions, and they are the larger half of
   this diff:
     - ONE address on the screen, not four (see receive-sheet.tsx)
     - the eye icon instead of the word "Hide"
     - two-word card subtitles instead of two-sentence ones
     - no "Deposit" button beside a "Receive" button opening the same sheet
     - no fund banner reprinting an address the sheet already owns

   THE ORDER is the one every wallet has settled on and it did not change: one
   total, the network, the actions, the accounts, activity, security last.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────── money ─────────────── */

const HIDDEN = "••••";

/**
 * One wei amount, in whichever denomination the user picked.
 *
 * ---------------------------------------------------------------------------
 * USD IS REFUSED RATHER THAN APPROXIMATED. The preference is remembered, but a
 * remembered preference cannot conjure a price: when the Chainlink round is
 * missing or stale this returns the BNB figure regardless of the setting
 * (AGENTS.md §5). The switch disables its own USD side in that case, so the
 * user is told why rather than silently ignored.
 * ---------------------------------------------------------------------------
 */
function renderAmount(
  wei: bigint,
  currency: DisplayCurrency,
  price: BnbPriceState,
  hidden: boolean,
): { figure: string; unit: string | null } {
  if (hidden) return { figure: HIDDEN, unit: null };
  if (currency === "USD" && price.status === "ready") {
    return { figure: formatUsdFromWei(wei, price.price), unit: null };
  }
  return { figure: formatBnb(wei), unit: "BNB" };
}

/* ─────────────── small parts ─────────────── */

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * A quick action: icon over a ONE-WORD label. "Receive", "BscScan", "Refresh"
 * each name a verb or a destination that needs no sentence around it.
 */
function QuickAction({ glyph, label, href, onClick, disabled }: {
  glyph: "receive" | "external" | "refresh";
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <span aria-hidden="true" className="wallet-quick__icon">
        <CategoryGlyph color="currentColor" name={glyph} size={17} strokeWidth={1.8} />
      </span>
      {label}
    </>
  );
  if (href) {
    return (
      <a className="wallet-quick" href={href} rel="noreferrer" target="_blank">
        {inner}
      </a>
    );
  }
  return (
    <button className="wallet-quick" disabled={disabled} onClick={onClick} type="button">
      {inner}
    </button>
  );
}

/**
 * BNB / USD — a physical two-position selector whose raised key slides between
 * the slots.
 *
 * The USD side is DISABLED, not hidden, while no price is readable. Hiding it
 * leaves the user wondering whether the feature exists; disabling it with a
 * reason says the feature exists and the price does not. `title` carries the
 * reason the hook actually gave rather than a generic one.
 */
function CurrencySwitch({
  currency,
  onChange,
  price,
}: {
  currency: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  price: BnbPriceState;
}) {
  const usdReady = price.status === "ready";
  const usdReason =
    price.status === "loading"
      ? "Reading the BNB price…"
      : price.status === "unavailable"
        ? price.reason
        : undefined;

  return (
    <div
      aria-label="Display currency"
      className="wallet-switch"
      data-active={currency === "USD" && usdReady ? "usd" : "bnb"}
      role="group"
    >
      <span aria-hidden="true" className="wallet-switch__key" />
      <button
        aria-pressed={currency === "BNB" || !usdReady}
        className="wallet-switch__opt"
        onClick={() => onChange("BNB")}
        type="button"
      >
        BNB
      </button>
      <button
        aria-pressed={currency === "USD" && usdReady}
        className="wallet-switch__opt"
        disabled={!usdReady}
        onClick={() => onChange("USD")}
        title={usdReason}
        type="button"
      >
        USD
      </button>
    </div>
  );
}

/* ─────────────── session row ─────────────── */

function SessionRow({
  session, onRevoke, isBusy,
}: {
  session: AgentSessionRow;
  onRevoke: () => void;
  isBusy: boolean;
  isLiveThisTab?: boolean;
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
          <span className="wallet-session-row__id">#{session.agentKey}</span>
        </div>
        <button
          className="wallet-revoke-btn"
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
          className="wallet-session-row__tx"
          href={`https://bscscan.com/tx/${session.grantTransactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          BscScan
        </a>
      )}
    </li>
  );
}

/* ─────────────── recoverability ─────────────── */

/**
 * MOVED 2026-09-12: this used to be the FIRST thing on the wallet page, above
 * the title it did not have, rendered unconditionally — including when no
 * Dolphin Wallet existed, warning about the recoverability of an account that
 * was not there. It now sits under the card it describes, and only when there
 * is one.
 *
 * Its deposit branch used to print the full wallet address with its own copy
 * button, which was the third full address on one screen. It opens the receive
 * sheet now, like every other address affordance here.
 */
export function RecoverabilityPanel({ onDeposit }: { onDeposit: () => void }) {
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
    <div
      className={`wallet-note ${isRegistered ? "wallet-note--ok" : isUnregistered ? "wallet-note--warn" : ""}`}
    >
      <span aria-hidden="true" className="wallet-note__icon">
        <CategoryGlyph color="currentColor" name="shield" size={15} strokeWidth={2} />
      </span>

      <div className="wallet-note__body">
        <p className="wallet-note__title">{copy.title}</p>
        <p className="wallet-note__text">{copy.body}</p>

        {wallet.recoverabilityError && (
          <p className="wallet-inline-error">{wallet.recoverabilityError}</p>
        )}

        {/*
         * Three mutually exclusive branches, never a disabled button.
         *
         * This used to render "Make recoverable — 0.000723 BNB + gas" greyed
         * out above a line explaining the balance was too low: the only control
         * offered was one the user could not use, while the thing that WOULD
         * unblock them was not offered at all. Every Dolphin Wallet starts
         * empty, so that dead end was the state every user actually saw.
         *
         * Each branch offers what is genuinely available — deposit when short,
         * register when funded, and neither when the fee could not be read,
         * because an action Dolphin cannot price is one it must not put a
         * button behind (AGENTS.md §5).
         */}
        {isUnregistered && (
          <div className="wallet-note__action">
            {fee === null ? (
              <p className="wallet-inline-error">
                The fee could not be read, so Dolphin will not offer an action it
                cannot price. Re-check to try again.
              </p>
            ) : !canAffordFee ? (
              <button className="wallet-btn wallet-btn--ghost" onClick={onDeposit} type="button">
                Deposit to enable
              </button>
            ) : (
              <button
                className="wallet-btn wallet-btn--accent"
                disabled={state.kind === "registering" || wallet.isBusy}
                onClick={() => {
                  setState({ kind: "registering" });
                  void wallet.registerWallet().then(
                    () => setState({ kind: "idle" }),
                    (cause: unknown) =>
                      setState({
                        kind: "error",
                        message: toUserMessage(cause, "That could not be completed. Try again."),
                      }),
                  );
                }}
                type="button"
              >
                {/*
                 * The fee is exact because it was read from the chain. Gas is
                 * named but NOT quantified — Dolphin has not measured it and
                 * will not print a plausible guess beside a real figure.
                 */}
                {state.kind === "registering"
                  ? "Confirm with passkey…"
                  : `Enable — ${formatBnb(fee)} BNB + gas`}
              </button>
            )}

            {state.kind === "error" && <p className="wallet-error-banner">{state.message}</p>}
          </div>
        )}
      </div>

      <button
        className="wallet-note__recheck"
        disabled={wallet.isCheckingRecoverability}
        onClick={() => wallet.refreshRecoverability()}
        type="button"
      >
        {wallet.isCheckingRecoverability ? "Checking…" : "Re-check"}
      </button>
    </div>
  );
}

/* ═══════════════ hero ═══════════════ */

/**
 * Total, network, currency, actions — the screen's entry point and the only
 * raised surface on the page.
 *
 * The action row renders in every state at the same size, so the hero does not
 * reflow as accounts connect. That steadiness is most of what separates a
 * wallet that feels solid from one that feels like it is still loading.
 */
function WalletHero({
  onReceive,
  price,
  receiveTarget,
}: {
  onReceive: () => void;
  price: BnbPriceState;
  receiveTarget: string | null;
}) {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const currency = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setDisplayCurrency);
  const hidden = useAppStore((s) => s.hideBalances);
  const toggleHidden = useAppStore((s) => s.toggleHideBalances);

  const identityAddress = identity.isConnected ? identity.address : null;

  /*
   * chainId is PINNED to BNB Smart Chain, and that is a correctness fix rather
   * than tidying. This read used to inherit whatever chain the connector
   * happened to be on while the row beneath it was hard-coded to say "BNB
   * Smart Chain" — so a visitor whose MetaMask sat on Ethereum saw their ETH
   * balance rendered in full and labelled BNB. A real number attached to the
   * wrong asset is the same defect as a fabricated one.
   *
   * Pinning also shares a react-query key with the identity card's read, so
   * the two resolve from one request rather than two.
   */
  const identityBalance = useBalance({
    address: identityAddress as `0x${string}` | undefined,
    chainId: ALTANA_CHAIN_ID,
    query: { enabled: Boolean(identityAddress) },
  });

  const total = summariseTotal({
    identityAddress,
    identityWei: identityBalance.data?.value ?? null,
    identityLoading: identityBalance.isLoading,
    dolphinAddress: dolphin.status === "connected" ? dolphin.address : null,
    dolphinWei: dolphin.balanceWei,
    dolphinLoading: dolphin.status === "loading" || dolphin.isReadingBalance,
    dolphinErrored: Boolean(dolphin.balanceError),
  });

  /*
   * A non-"ready" hero renders WORDS, not a figure — and this took two goes.
   *
   * First attempt printed "0", a fabricated balance: with nothing connected
   * the hero said "0 BNB" directly above "No account connected yet", and the
   * louder of two contradicting lines was the wrong one.
   *
   * Second attempt printed "—", which typechecks as honest and renders as a
   * redaction: an em-dash at hero size is a 60px horizontal bar that reads as
   * a loading skeleton. Only a screenshot tells you that.
   */
  const placeholder =
    total.kind === "reading"
      ? "Reading…"
      : total.kind === "partial"
        ? "Unavailable"
        : "No balance yet";

  /*
   * NO RATE, NO ORACLE NAME, NO "Chainlink" (removed 2026-09-12).
   *
   * A previous version of this line read "2 accounts · at $736.53/BNB,
   * Chainlink". The reasoning was that provenance makes a wrong figure
   * checkable — which is true, and beside the point. The user opened a wallet
   * to see what they have. Someone who wants the BNB rate will look it up
   * somewhere built for that; showing it here taxes everyone else to reassure
   * nobody who asked.
   *
   * THE GENERAL RULE, which applies past this line: sourcing is a property of
   * the CODE, not of the copy. Dolphin's guarantee is that it refuses to print
   * a number it could not read — see renderAmount above and use-token-usd.ts —
   * and that guarantee holds whether or not the screen brags about it.
   * Explaining where a figure came from is engineering talking to itself.
   */
  const caption =
    total.kind === "ready"
      ? `${total.accounts} ${total.accounts === 1 ? "account" : "accounts"} · ${ALTANA_NETWORK_LABEL}`
      : total.kind === "reading"
        ? "Checking accounts…"
        : total.kind === "partial"
          ? "One balance could not be read — see the accounts below."
          : "Connect an account to see a balance.";

  const amount =
    total.kind === "ready" ? renderAmount(total.wei, currency, price, hidden) : null;

  return (
    <section aria-labelledby="wallet-total-heading" className="wallet-hero">
      <div className="wallet-hero__head">
        <p className="eyebrow" id="wallet-total-heading">Total balance</p>
        {/*
         * The network as a chip. It was 0.7rem grey text floating between
         * sections. Which chain an address is good for decides whether sending
         * to it loses the money; it should not be the smallest thing here.
         */}
        <span className="wnet">
          <span aria-hidden="true" className="wnet__dot" />
          <BnbLogo size={13} />
          {ALTANA_NETWORK_LABEL}
        </span>
      </div>

      {/* The readout: sunk into the surface, like a display window. */}
      <div className="wallet-readout">
        {amount ? (
          <p className="wallet-readout__figure">
            {amount.figure}
            {amount.unit && <span className="wallet-readout__unit">{amount.unit}</span>}
          </p>
        ) : (
          /* No unit either — "Unavailable BNB" denominates a quantity that
             does not exist. */
          <p className="wallet-readout__placeholder">{placeholder}</p>
        )}

        <div className="wallet-readout__controls">
          <CurrencySwitch currency={currency} onChange={setCurrency} price={price} />
          {total.kind === "ready" && (
            <button
              aria-label={hidden ? "Show balances" : "Hide balances"}
              aria-pressed={hidden}
              className="wallet-eye"
              onClick={toggleHidden}
              type="button"
            >
              {/* Icon only. A label reading "Hide" beside an eye is explaining
                  a light switch. */}
              <CategoryGlyph
                color="currentColor"
                name={hidden ? "eye-off" : "eye"}
                size={17}
                strokeWidth={1.8}
              />
            </button>
          )}
        </div>
      </div>

      {/* aria-live so a total arriving after the page does is announced.
          "polite" — a balance settling must not interrupt a screen reader. */}
      <p aria-live="polite" className="wallet-hero__caption">{caption}</p>

      <div className="wallet-hero__actions">
        <QuickAction
          disabled={receiveTarget === null}
          glyph="receive"
          label="Receive"
          onClick={onReceive}
        />
        {receiveTarget ? (
          <QuickAction
            glyph="external"
            href={`https://bscscan.com/address/${receiveTarget}`}
            label="BscScan"
          />
        ) : (
          <QuickAction disabled glyph="external" label="BscScan" />
        )}
        <QuickAction
          disabled={total.kind === "reading"}
          glyph="refresh"
          label="Refresh"
          onClick={() => {
            void identityBalance.refetch();
            void dolphin.refreshBalance();
          }}
        />
      </div>
    </section>
  );
}

/* ─────────────── account cards ─────────────── */

/**
 * The truncated address, as a button that opens the receive sheet.
 *
 * A truncated address is not an address, it is a label for one — so it is not
 * a thing to copy, it is a thing to open. This is the only address affordance
 * on a card, and the sheet behind it is the only place a full string exists.
 */
function AddressChip({ address, onOpen }: { address: string; onOpen: () => void }) {
  return (
    <button className="wcard__addr" onClick={onOpen} title="Show address and QR" type="button">
      <code>{truncateAddress(address)}</code>
      <CategoryGlyph color="currentColor" name="receive" size={11} strokeWidth={2} />
    </button>
  );
}

/** One balance line on a card, in the chosen currency or as a stated absence. */
function CardAmount({
  amount,
  loading,
}: {
  amount: { figure: string; unit: string | null } | null;
  loading: boolean;
}) {
  if (!amount) {
    return (
      <p className="wcard__amount wcard__amount--muted">{loading ? "…" : "Unavailable"}</p>
    );
  }
  return (
    <p className="wcard__amount">
      {amount.figure}
      {amount.unit && <span className="wcard__amount-unit">{amount.unit}</span>}
    </p>
  );
}

function IdentityWalletCard({
  onReceive,
  price,
}: {
  onReceive: (address: string) => void;
  price: BnbPriceState;
}) {
  const identity = useWallet();
  const currency = useAppStore((s) => s.displayCurrency);
  const hidden = useAppStore((s) => s.hideBalances);
  const { data, isLoading } = useBalance({
    address: identity.address as `0x${string}` | undefined,
    // Same pin, same reason, and the same query key as the hero's read.
    chainId: ALTANA_CHAIN_ID,
    query: { enabled: Boolean(identity.isConnected && identity.address) },
  });

  /*
   * The empty state is a CARD, not an absence. It occupies the same slot at
   * the same FIXED height as the connected card, so the shape of this screen
   * never changes with connection state — cards do not grow into the row or
   * drop below one another as wallets come and go.
   */
  if (!identity.isConnected || !identity.address) {
    return (
      <div aria-label="Identity wallet" className="wcard wcard--empty">
        <p className="wcard__eyebrow">Your wallet</p>
        <p className="wcard__title">Not connected</p>
        <p className="wcard__sub">Remembers your hires. Reads the public address only.</p>
        <div className="wcard__foot">
          <WalletConnectButton connectLabel="Connect" />
        </div>
      </div>
    );
  }

  const address = identity.address;

  return (
    <div aria-label="Identity wallet" className="wcard">
      <div className="wcard__head">
        <WalletAvatar address={address} className="wcard__avatar" kind="human" size={34} />
        <div className="wcard__head-text">
          <p className="wcard__eyebrow">Your wallet</p>
          <AddressChip address={address} onOpen={() => onReceive(address)} />
        </div>
      </div>

      <CardAmount
        amount={data ? renderAmount(data.value, currency, price, hidden) : null}
        loading={isLoading}
      />
      <p className="wcard__sub">Signs in · hire records</p>

      {/*
       * Disconnect lives HERE, on the card for the account it disconnects. It
       * used to be a separate full-width band under the cards, restating the
       * card six inches above it. Still WalletConnectButton rather than a local
       * button, for the reason that component's own note gives: it owns the
       * two-step confirm, and a second path here would be one click where the
       * other is two.
       */}
      <div className="wcard__foot">
        <WalletConnectButton connectLabel="Connect" />
      </div>
    </div>
  );
}

function AgentWalletCard({
  onReceive,
  price,
}: {
  onReceive: (address: string) => void;
  price: BnbPriceState;
}) {
  const wallet = useAltanaWallet();
  const currency = useAppStore((s) => s.displayCurrency);
  const hidden = useAppStore((s) => s.hideBalances);

  // No wallet on this device: an invitation, not an empty box. Creation stays
  // an explicit user action — nothing here creates one as a side effect.
  if (wallet.status !== "connected" || !wallet.address) {
    const blocked = wallet.status === "unsupported";
    return (
      <div aria-label="Agent payments wallet" className="wcard wcard--agent wcard--empty">
        <p className="wcard__eyebrow">Agent payments</p>
        <p className="wcard__title">{blocked ? "Unavailable here" : "Not set up"}</p>
        <p className="wcard__sub">
          {blocked
            ? wallet.unsupportedReason ?? "This browser cannot hold a passkey wallet."
            : "Pays the agents you hire. Optional."}
        </p>
        {wallet.error && <p className="wallet-inline-error">{wallet.error}</p>}
        {!blocked && (
          <div className="wcard__foot">
            {/*
             * Ghost, not accent, and that is hierarchy rather than a downgrade.
             * Both empty cards sit side by side and only one is the path a new
             * visitor needs — connecting an address is what makes hiring work.
             * This wallet is genuinely optional and says so. Two solid buttons
             * competing across the row would flatten that into "pick one".
             */}
            <button
              className="wallet-btn wallet-btn--ghost"
              disabled={wallet.isBusy}
              onClick={() => void wallet.createWallet()}
              type="button"
            >
              {wallet.isBusy ? "Waiting for passkey…" : "Create with passkey"}
            </button>
            <button
              className="wcard__link"
              disabled={wallet.isBusy}
              onClick={() => void wallet.recoverWallet()}
              type="button"
            >
              Recover an existing one
            </button>
          </div>
        )}
      </div>
    );
  }

  const address = wallet.address;
  const readable = !wallet.balanceError && wallet.balanceWei !== null;

  return (
    <div aria-label="Agent payments wallet" className="wcard wcard--agent">
      <div className="wcard__head">
        <WalletAvatar address={address} className="wcard__avatar" kind="bot" size={34} />
        <div className="wcard__head-text">
          {/*
           * "Agent payments", not "agent spending" or "for agents". The old
           * wording read as though this account holds what an agent EARNS. It
           * does not, and no code path would put earnings here — a paid hire
           * sends to the agent's own registered ERC-8004 wallet, which
           * convex/agentPayments.ts verifies the payee against. This balance is
           * outbound only.
           */}
          <p className="wcard__eyebrow">Agent payments</p>
          <AddressChip address={address} onOpen={() => onReceive(address)} />
        </div>
        <span className="wcard__badge" title="Secured by a passkey on this device">
          <CategoryGlyph color="currentColor" name="shield" size={11} strokeWidth={2} />
        </span>
      </div>

      <CardAmount
        amount={readable ? renderAmount(wallet.balanceWei!, currency, price, hidden) : null}
        loading={wallet.isReadingBalance}
      />
      <p className="wcard__sub">Pays your hires</p>

      {/*
       * No "Deposit" button here. It opened the same sheet as the hero's
       * Receive and as the address chip above it — three controls, one
       * destination. The chip is the one that belongs to this account.
       */}
    </div>
  );
}

/* ─────────────── device access ─────────────── */

function DeviceAccessSection() {
  const wallet = useAltanaWallet();
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="Device access" className="wallet-danger">
      <div>
        <p className="wallet-danger__title">Remove from this device</p>
        <p className="wallet-danger__sub">Local record only. On-chain access is unchanged.</p>
      </div>
      {confirming ? (
        <div className="wallet-danger__confirm">
          <button
            className="wallet-btn wallet-btn--ghost"
            onClick={() => setConfirming(false)}
            type="button"
          >
            Keep
          </button>
          <button
            className="wallet-btn wallet-btn--danger"
            onClick={() => { wallet.forgetWallet(); setConfirming(false); }}
            type="button"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          className="wallet-danger__trigger"
          onClick={() => setConfirming(true)}
          type="button"
        >
          Remove
        </button>
      )}
    </section>
  );
}

/* ─────────────── permissions ─────────────── */

/*
 * Gated off by FEATURE_SESSION_EXECUTION (see altana-policy.ts for the full
 * reasoning). The flag removes this from the rendered tree entirely rather
 * than disabling controls inside it, while keeping the markup type-checked and
 * one flag away from returning.
 *
 * Why it is off: a granted session's signing key never reaches an agent and
 * nothing in this app can execute with one, so this listed permissions no
 * party could exercise — and the Grant button that fed it charged real BNB in
 * gas to create them.
 */
function PermissionsSection() {
  const wallet = useAltanaWallet();
  const active = (wallet.sessions ?? []).filter((s) => s.status === "active");
  const past = (wallet.sessions ?? []).filter((s) => s.status !== "active");

  return (
    <section aria-labelledby="permissions-heading" className="wallet-section">
      <div className="wallet-section__header">
        <h2 className="wallet-section__title" id="permissions-heading">Permissions</h2>
        {!wallet.sessionsUnavailable && wallet.sessions !== undefined && (
          <span className="wallet-count-badge">{active.length} active</span>
        )}
      </div>

      {wallet.sessionsUnavailable ? (
        <StatePanel
          body="Backend not configured. New grants are refused."
          compact
          state="unavailable"
          title="Permissions unavailable"
        />
      ) : wallet.sessions === undefined ? (
        <StatePanel body="Reading records…" compact state="syncing" title="Checking" />
      ) : active.length === 0 ? (
        <div className="wallet-empty-permissions">
          <span className="wallet-empty-permissions__icon">
            <CategoryGlyph color="currentColor" name="shield" size={16} strokeWidth={2} />
          </span>
          <div>
            <p className="wallet-empty-permissions__title">No active permissions</p>
            <p className="wallet-empty-permissions__sub">
              Read-only hires get no spending authority.
            </p>
          </div>
        </div>
      ) : (
        <ul className="wallet-sessions-list">
          {active.map((session) => (
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

      {past.length > 0 && (
        <details className="wallet-past-sessions">
          <summary>{past.length} inactive</summary>
          <ul className="wallet-past-sessions__list">
            {past.map((session) => (
              <li className="wallet-past-sessions__row" key={session.sessionPublicKey}>
                <div>
                  <p className="wallet-past-sessions__name">{session.agentName}</p>
                  <p className="wallet-past-sessions__meta">
                    {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
                  </p>
                </div>
                <span className="wallet-past-sessions__status">{session.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ─────────────── public export ─────────────── */

/**
 * ---------------------------------------------------------------------------
 * ONE dashboard, not two render paths.
 * ---------------------------------------------------------------------------
 * This used to branch on `wallet.status` alone, and that status describes only
 * the Dolphin wallet — so someone could connect MetaMask and see no trace of
 * it, because the screen was still showing "create a Dolphin Wallet". Two
 * independent accounts, one gating the other's visibility for no reason.
 *
 * There were then two whole render paths, which is how the fund banner, the
 * refresh row and the device control each drifted to a slightly different
 * condition from the card they belonged to. Now every section decides for
 * itself whether it has anything to say, and nothing moves when a wallet is
 * created — the sections were always going to be in that order.
 *
 * VISIBILITY only. createPasskeyWallet is untouched and remains a separate,
 * explicit, user-initiated action.
 */
export function AltanaWalletPanel() {
  const wallet = useAltanaWallet();
  const identity = useWallet();
  const price = useBnbPrice();
  const hidden = useAppStore((s) => s.hideBalances);
  const [receiving, setReceiving] = useState<string | null>(null);

  if (wallet.status === "loading") {
    return (
      <div className="wallet-loading">
        <StatePanel
          body="Checking this browser for a Dolphin Wallet credential."
          state="syncing"
          title="Checking device"
        />
      </div>
    );
  }

  const dolphinAddress = wallet.status === "connected" ? wallet.address : null;
  const identityAddress = identity.isConnected ? identity.address : null;

  /*
   * Which account the hero's Receive opens. The Dolphin Wallet wins when it
   * exists, because that is the one this screen can ask you to fund — the
   * identity wallet is the user's own MetaMask and they already have a full
   * interface for it.
   */
  const heroTarget = dolphinAddress ?? identityAddress;

  return (
    <div className="wallet-dashboard">
      <WalletHero
        onReceive={() => setReceiving(heroTarget)}
        price={price}
        receiveTarget={heroTarget}
      />

      <section aria-label="Accounts" className="wallet-accounts">
        <AgentWalletCard onReceive={setReceiving} price={price} />
        <IdentityWalletCard onReceive={setReceiving} price={price} />
      </section>

      {dolphinAddress && (
        <RecoverabilityPanel onDeposit={() => setReceiving(dolphinAddress)} />
      )}

      {wallet.error && <p className="wallet-error-banner">{wallet.error}</p>}

      <AgentActivity hidden={hidden} />

      {FEATURE_SESSION_EXECUTION && <PermissionsSection />}

      {dolphinAddress && <DeviceAccessSection />}

      {receiving && (
        <ReceiveSheet
          address={receiving}
          label={
            receiving.toLowerCase() === dolphinAddress?.toLowerCase()
              ? "Agent payments"
              : "Your wallet"
          }
          onClose={() => setReceiving(null)}
        />
      )}
    </div>
  );
}
