"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBalance } from "wagmi";

import { WalletHistory } from "@/components/wallet-history";
import {
  AssetLogo,
  U_TOKEN,
  WithdrawDialog,
  useDolphinUBalance,
  type WalletAsset,
} from "@/components/wallet-withdraw";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ReceiveSheet } from "@/components/receive-sheet";
import { StatePanel } from "@/components/state-panel";
import { WalletAvatar } from "@/components/wallet-avatar";
import { autotradeApi, myAgentsApi, type AgentSessionRow } from "@/convex/api";
import { HoldButton } from "@/components/hold-button";
import { LiquidationAlertPanel } from "@/components/liquidation-alert-panel";
import { OptionalFeature } from "@/components/optional-feature";
import { toast } from "@/store/use-toast-store";
import { useWalletSession } from "@/wallet/wallet-session";
import { useBnbPrice, type BnbPriceState } from "@/hooks/use-bnb-price";
import { useWalletHoldings } from "@/hooks/use-wallet-holdings";
import { TokenList } from "@/components/wallet-token-list";
import { useNow } from "@/hooks/use-now";
import { useWalletErrorToasts } from "@/hooks/use-wallet-error-toasts";
import { usePaymentRates } from "@/hooks/use-payment-rates";
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
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { formatUsd } from "@/wallet/token-usd";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
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
export function CurrencySwitch({
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
  const [state, setState] = useState<{ kind: "idle" } | { kind: "registering" }>({ kind: "idle" });

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
                  // A failure is reported by the provider and shown as a toast.
                  void wallet.registerWallet().finally(() => setState({ kind: "idle" }));
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

/* ═══════════════ history and assets ═══════════════ */

type AssetsView = "dolphin" | "connected" | "both";

/**
 * WALLET HISTORY | ASSETS, as on the phone (owner, 2026-10-03: "there should also be a button for
 * assets" on desktop). Assets lists every token held - USDT included - in the Dolphin Wallet, the
 * connected wallet, or both, with each one's value.
 */
function HistoryAndAssets({ dolphinAddress, identityAddress, hidden }: { dolphinAddress: string | null; identityAddress: string | null; hidden: boolean }) {
  const [tab, setTab] = useState<"history" | "assets">("history");
  const [which, setWhich] = useState<AssetsView>("dolphin");
  const currency = useAppStore((s) => s.displayCurrency);
  const view: AssetsView = which === "dolphin" && !dolphinAddress ? "connected" : which === "connected" && !identityAddress ? "dolphin" : which;
  const addresses = useMemo(
    () => (view === "dolphin" ? [dolphinAddress] : view === "connected" ? [identityAddress] : [dolphinAddress, identityAddress]).filter((address): address is string => Boolean(address)),
    [view, dolphinAddress, identityAddress],
  );
  const { holdings, rates, isError } = useWalletHoldings(addresses, currency, hidden);
  const choices = [
    ...(dolphinAddress ? [{ key: "dolphin" as const, label: "Dolphin Wallet" }] : []),
    ...(identityAddress ? [{ key: "connected" as const, label: "Connected wallet" }] : []),
    ...(dolphinAddress && identityAddress ? [{ key: "both" as const, label: "Both" }] : []),
  ];
  return (
    <section className="wallet-tabs">
      <div aria-label="Wallet details" className="wallet-tabs__bar" role="tablist">
        {(["history", "assets"] as const).map((key) => (
          <button aria-selected={tab === key} className="pw-tab" key={key} onClick={() => setTab(key)} role="tab" type="button">
            {key === "history" ? "Wallet history" : "Assets"}
          </button>
        ))}
        {tab === "assets" && choices.length > 1 ? (
          <div aria-label="Which wallet" className="wallet-tabs__which" role="radiogroup">
            {choices.map((choice) => (
              <button aria-checked={view === choice.key} key={choice.key} onClick={() => setWhich(choice.key)} role="radio" type="button">
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div role="tabpanel">
        {tab === "history" ? (
          <WalletHistory hidden={hidden} />
        ) : addresses.length === 0 ? (
          <p className="pw-empty">Set up your Dolphin Wallet or connect a wallet to see what it holds.</p>
        ) : !holdings ? (
          isError ? (
            <p className="pw-empty">Balances can&apos;t be read right now.</p>
          ) : (
            <div aria-busy="true" className="space-y-2 py-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div className="skeleton h-12 rounded-xl" key={i} />
              ))}
            </div>
          )
        ) : (
          <TokenList hidden={hidden} holdings={holdings} rates={rates} />
        )}
      </div>
    </section>
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
  price,
  receiveTarget,
}: {
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
      ? total.accounts === 1
        ? "In your wallet"
        : `Across your ${total.accounts} wallets`
      : total.kind === "reading"
        ? "Checking accounts…"
        : total.kind === "partial"
          ? "One balance could not be read — see the accounts below."
          : "Connect an account to see a balance.";

  /*
   * THE FIGURE IS EVERYTHING HELD, not the BNB line (owner, 2026-10-03: 4 USDT in the Dolphin
   * Wallet, the phone said $5.15, this said about $1). Computed by the same hook as the phone
   * screen; summariseTotal still says how many wallets were read and whether one failed.
   */
  const dolphinHeld = dolphin.status === "connected" ? dolphin.address : null;
  const heldAddresses = useMemo(() => [dolphinHeld, identityAddress ?? null].filter((address): address is string => Boolean(address)), [dolphinHeld, identityAddress]);
  const held = useWalletHoldings(heldAddresses, currency, hidden);
  const amount = total.kind === "ready" && typeof held.headline === "object" ? held.headline : null;

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
        {/* Add funds lives on the Dolphin Wallet card now (2026-10-02). */}
        {receiveTarget ? (
          <QuickAction
            glyph="external"
            href={`https://bscscan.com/address/${receiveTarget}`}
            label="BscScan"
          />
        ) : (
          <QuickAction disabled glyph="external" label="BscScan" />
        )}
        {/* No Refresh (removed 2026-09-26): the Dolphin balance re-reads every
            60 seconds and the identity balance on focus, so the button
            repeated what already happens. */}
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
        <p className="wcard__eyebrow">Connected wallet</p>
        <p className="wcard__title">Not connected</p>
        <p className="wcard__sub">Signs you in. Dolphin never spends from it.</p>
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
          <p className="wcard__eyebrow">Connected wallet</p>
          <AddressChip address={address} onOpen={() => onReceive(address)} />
        </div>
      </div>

      <CardAmount
        amount={data ? renderAmount(data.value, currency, price, hidden) : null}
        loading={isLoading}
      />
      <p className="wcard__sub">Signs you in · never spends</p>

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

type CardFigure = { figure: string; unit: string | null };

/**
 * WHICH ASSET THE DOLPHIN WALLET CARD SHOWS (owner, 2026-10-02: "make it a
 * drop down... chevron down"). The old badge flipped BNB/U on tap with nothing
 * saying it could; the chevron says it, and the open menu shows both balances,
 * which is what the Holdings box used to repeat.
 */
function AssetMenu({
  asset,
  onPick,
  options,
}: {
  asset: WalletAsset;
  onPick: (asset: WalletAsset) => void;
  options: { asset: WalletAsset; amount: CardFigure | null; loading: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Closing removes the focused option, so focus goes back to the trigger
  // rather than dropping to <body> (review, 2026-10-02).
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      className="asset-menu"
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      ref={box}
    >
      <button
        aria-controls="asset-menu-list"
        aria-expanded={open}
        aria-label={`Showing ${asset}. Choose an asset`}
        className="asset-menu__trigger interactive"
        onClick={() => setOpen(!open)}
        ref={trigger}
        type="button"
      >
        <AssetLogo asset={asset} size={16} />
        <span>{asset}</span>
        <span aria-hidden="true" className={`asset-menu__chevron${open ? " asset-menu__chevron--open" : ""}`}>
          <CategoryGlyph color="currentColor" name="chevron-right" size={12} strokeWidth={2} />
        </span>
      </button>
      {open ? (
        <ul aria-label="Assets" className="asset-menu__list" id="asset-menu-list">
          {options.map((option) => (
            <li key={option.asset}>
              <button
                aria-pressed={option.asset === asset}
                className="asset-menu__item"
                onClick={() => {
                  onPick(option.asset);
                  close(true);
                }}
                type="button"
              >
                <AssetLogo asset={option.asset} size={20} />
                <span className="asset-menu__name">{option.asset}</span>
                <span className="asset-menu__amount">
                  {option.amount
                    ? `${option.amount.figure}${option.amount.unit ? ` ${option.amount.unit}` : ""}`
                    : option.loading
                      ? "…"
                      : "Unavailable"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
  const [asset, setAsset] = useState<WalletAsset>("BNB");
  const [withdrawing, setWithdrawing] = useState(false);
  const uBalance = useDolphinUBalance();
  const uRates = usePaymentRates([{ token: U_TOKEN, decimals: uBalance.data?.decimals ?? 18 }]);

  // No wallet on this device: an invitation, not an empty box. Creation stays
  // an explicit user action — nothing here creates one as a side effect.
  if (wallet.status !== "connected" || !wallet.address) {
    const blocked = wallet.status === "unsupported";
    return (
      <div aria-label="Agent payments wallet" className="wcard wcard--agent wcard--empty">
        <p className="wcard__eyebrow">Dolphin Wallet</p>
        <p className="wcard__title">{blocked ? "Unavailable here" : "Not set up"}</p>
        <p className="wcard__sub">
          {blocked
            ? wallet.unsupportedReason ?? "This browser cannot hold a passkey wallet."
            : "Pays for the agents you hire, and your agents' trades - only within limits you set. Secured by your passkey."}
        </p>
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

  /*
   * The card shows ONE asset at a time, picked from the dropdown in its
   * corner (owner, 2026-09-26; a dropdown since 2026-10-02, which lists both
   * balances, so the separate Holdings box went). BNB follows the BNB/USD setting as before;
   * U shows in U, or in dollars when USD is chosen and a U rate is readable.
   * An unreadable U balance reads "Unavailable", never 0 (AGENTS.md §5).
   */
  const u = uBalance.data ?? null;
  const uRate = uRates.get(U_TOKEN.toLowerCase()) ?? null;
  const uAmount: CardFigure | null = u
    ? hidden
      ? { figure: HIDDEN, unit: null }
      : currency === "USD" && uRate
        ? { figure: formatUsd(u.raw, u.decimals, uRate), unit: null }
        : { figure: formatTokenAmount(u.raw, u.decimals), unit: u.symbol }
    : null;
  const bnbAmount = readable ? renderAmount(wallet.balanceWei!, currency, price, hidden) : null;

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
          <p className="wcard__eyebrow">Dolphin Wallet</p>
          <AddressChip address={address} onOpen={() => onReceive(address)} />
        </div>
        <AssetMenu
          asset={asset}
          onPick={setAsset}
          options={[
            { asset: "BNB", amount: bnbAmount, loading: wallet.isReadingBalance },
            { asset: "U", amount: uAmount, loading: uBalance.isLoading },
          ]}
        />
      </div>

      {asset === "BNB" ? (
        <CardAmount amount={bnbAmount} loading={wallet.isReadingBalance} />
      ) : (
        <CardAmount amount={uAmount} loading={uBalance.isLoading} />
      )}
      <p className="wcard__sub">Pays your hires and trades</p>

      {/*
       * ADD FUNDS AND WITHDRAW, ON THE WALLET THEY MOVE MONEY IN AND OUT OF
       * (owner, 2026-10-02: "how would somebody understand the add on the
       * total balance is for the Dolphin Wallet?"). Add funds used to sit on
       * the total at the top of the page, which counts both wallets.
       */}
      <div className="wcard__foot">
        <div className="wcard__actions">
          <button className="wallet-btn wallet-btn--ink" onClick={() => onReceive(address)} type="button">
            Add funds
          </button>
          <button
            className="wallet-btn wallet-btn--ghost"
            disabled={wallet.isBusy}
            onClick={() => setWithdrawing(true)}
            type="button"
          >
            Withdraw
          </button>
        </div>
      </div>
      {withdrawing ? (
        <WithdrawDialog initialAsset={asset} onClose={() => setWithdrawing(false)} />
      ) : null}

      {/*
       * No "Deposit" button here. It opened the same sheet as the hero's
       * Receive and as the address chip above it — three controls, one
       * destination. The chip is the one that belongs to this account.
       */}
    </div>
  );
}

/* ─────────────── what your agents can spend (2026-09-29) ─────────────── */

/**
 * THE TRUST QUESTION, ANSWERED WHERE THE MONEY IS. Which of your agents may
 * trade on their own, with what, until when - and a Stop on each. The
 * campaign brief: "spend caps and a revoke path must work, not just be
 * described". Read from convex/myAgents.ts (session-gated); Stop is the same
 * autotrade.stop the builder's card uses, and deletes the key at once.
 *
 * Hires are not listed because they cannot spend on their own: every paid hire
 * is approved with the passkey, one job at a time.
 */
export function AgentSpendingSection() {
  const identity = useWallet();
  const session = useWalletSession();
  const built = useQuery(myAgentsApi.myAgents.built, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  const stop = useMutation(autotradeApi.autotrade.stop);
  const [stopping, setStopping] = useState<string | null>(null);
  const trading = (built ?? []).filter((agent) => agent.trading?.status === "active" && agent.conversationKey);

  return (
    <section aria-labelledby="spending-heading" className="wallet-block">
      <h2 className="wallet-block__title" id="spending-heading">
        What your agents can spend
      </h2>
      {!identity.isConnected || !identity.address ? (
        <p className="wallet-block__empty">Connect your wallet to see which agents can spend.</p>
      ) : !session.sessionToken ? (
        <div className="wallet-block__empty">
          <p>Sign in to see which of your agents can trade on their own.</p>
          <button className="manage-btn manage-btn--quiet mt-3 !min-h-9" onClick={() => void session.signIn(identity.address!)} type="button">
            Sign in
          </button>
        </div>
      ) : built === undefined ? (
        <div aria-hidden="true" className="skeleton h-16 rounded-xl" />
      ) : trading.length === 0 ? (
        <p className="wallet-block__empty">Nothing can spend on its own. Hires ask for your passkey each time.</p>
      ) : (
        <ul className="spenders">
          {trading.map((agent) => (
            <li className="spenders__row" key={agent.conversationKey!}>
              <div className="min-w-0 flex-1">
                <p className="spenders__name">
                  <span aria-hidden="true" className="spenders__dot" />
                  {agent.name}
                </p>
                <p className="spenders__meta">
                  Trades on its own until{" "}
                  {new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(agent.trading!.expiresAt))}
                  {agent.trading!.spends.length ? ` · can spend ${agent.trading!.spends.join(", ")}` : ""}
                </p>
              </div>
              <button
                className="manage-btn manage-btn--danger-quiet !min-h-8 !px-3 !text-[0.78rem]"
                disabled={stopping === agent.conversationKey}
                onClick={() => {
                  const key = agent.conversationKey!;
                  setStopping(key);
                  stop({ sessionToken: session.sessionToken!, conversationKey: key }).then(
                    () => {
                      setStopping(null);
                      toast.success(`${agent.name} can no longer trade on its own.`);
                    },
                    () => {
                      setStopping(null);
                      toast.error("That could not be stopped. Try again.");
                    },
                  );
                }}
                type="button"
              >
                {stopping === agent.conversationKey ? "Stopping..." : "Stop"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {trading.length > 0 ? (
        <p className="wallet-block__note">Stop takes effect at once. To also revoke it on-chain, open the agent in the builder.</p>
      ) : null}
    </section>
  );
}

/* ─────────────── device access ─────────────── */

export function DeviceAccessSection() {
  const wallet = useAltanaWallet();

  /*
   * HOLD TO REMOVE (owner, 2026-09-29: anything irreversible gets the same
   * deliberate hold as Cancel hire). Removing forgets this device's passkey
   * reference; without a recovery it can lock the person out of the wallet.
   */
  return (
    <section aria-label="Device access" className="wallet-danger">
      <div>
        <p className="wallet-danger__title">Remove from this device</p>
        <p className="wallet-danger__sub">Local record only. On-chain access is unchanged.</p>
      </div>
      <HoldButton
        backgroundColor="var(--paper)"
        className="manage-hold"
        doneLabel="Removed"
        fillColor="#c9362b"
        fillTextColor="#ffffff"
        holdTime={1600}
        onHold={() => wallet.forgetWallet()}
        radius={11}
        resetAfter={0}
        size="sm"
        textColor="var(--hold-danger)"
      >
        Hold to remove
      </HoldButton>
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
export function PermissionsSection() {
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
  // Wallet failures as toasts, not red text in the page (2026-09-26).
  useWalletErrorToasts();

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

  const receiveSheet = receiving ? (
    <ReceiveSheet
      address={receiving}
      label={receiving.toLowerCase() === dolphinAddress?.toLowerCase() ? "Dolphin Wallet" : "Connected wallet"}
      onClose={() => setReceiving(null)}
    />
  ) : null;

  return (
    /*
     * THE LAYOUT (2026-09-29, owner: "what would our user want to look for?").
     * Left, what you have: the total and its actions, every holding, what
     * happened. Right, your wallets in plain words and what may spend from
     * them, with a Stop on each. Alerts and device access last.
     */
    <div className="wallet-dashboard wallet-v2">
      <div className="wallet-v2__main">
        <WalletHero
          price={price}
          receiveTarget={heroTarget}
        />
        {/* Every movement of the Dolphin Wallet, from the chain (2026-10-02), and every asset held (2026-10-03). */}
        <HistoryAndAssets dolphinAddress={dolphinAddress} hidden={hidden} identityAddress={identityAddress ?? null} />
        <OptionalFeature label="Liquidation alerts">
          <LiquidationAlertPanel />
        </OptionalFeature>
      </div>

      <aside aria-label="Your wallets" className="wallet-v2__side">
        <AgentWalletCard onReceive={setReceiving} price={price} />
        <IdentityWalletCard onReceive={setReceiving} price={price} />

        {/* Only when there is something to act on (2026-09-26): a green
            "recoverable" note on every visit is reassurance nobody asked for. */}
        {dolphinAddress && wallet.recoverability !== "registered" && (
          <RecoverabilityPanel onDeposit={() => setReceiving(dolphinAddress)} />
        )}

        <AgentSpendingSection />
        {FEATURE_SESSION_EXECUTION && <PermissionsSection />}
        {dolphinAddress && <DeviceAccessSection />}
      </aside>

      {receiveSheet}
    </div>
  );
}
