"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AgentSpendingSection,
  CurrencySwitch,
  DeviceAccessSection,
  PermissionsSection,
  RecoverabilityPanel,
} from "@/components/altana-wallet-panel";
import { CategoryGlyph } from "@/components/category-glyph";
import { LiquidationAlertPanel } from "@/components/liquidation-alert-panel";
import { MobileMenuButton } from "@/components/mobile-nav";
import { OptionalFeature } from "@/components/optional-feature";
import { ReceiveSheet } from "@/components/receive-sheet";
import { WalletAvatar } from "@/components/wallet-avatar";
import { WalletHistory } from "@/components/wallet-history";
import { AssetLogo, WithdrawDialog } from "@/components/wallet-withdraw";
import { useBnbPrice } from "@/hooks/use-bnb-price";
import { usePaymentRates } from "@/hooks/use-payment-rates";
import { WALLET_TOKENS, useWalletTokens } from "@/hooks/use-wallet-tokens";
import { useWalletErrorToasts } from "@/hooks/use-wallet-error-toasts";
import { useAppStore } from "@/store/use-app-store";
import { FEATURE_SESSION_EXECUTION, formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { formatUsdCents } from "@/wallet/bnb-price";
import { usdCents, WBNB_BSC, type UsdRate } from "@/wallet/token-usd";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/* ═══════════════════════════════════════════════════════════════════════════
   THE PHONE WALLET (rebuilt 2026-10-02, owner's design)

   One account at a time, picked from the name at the top: the Dolphin Wallet,
   the connected wallet, or the total of both. Under it the value of everything
   that account holds, BNB/USD and the eye, then the keys - Add funds and
   Withdraw act on the account picked; on the total, Add funds asks which
   wallet - then Alerts and More (spend limits, BscScan, remove from this
   device) as keys too, so the page ends at the tabs. Two tabs: Wallet history
   and Assets ("assets", not "tokens": BNB is the chain's own coin, not a
   token; owner, 2026-10-02).

   The old phone screen had its own total and its own two account cards; the
   desktop moved on and the phone did not. Everything here that is not layout
   is the desktop's: the same balances, rates, history, receive sheet and
   withdraw dialog.
   ═══════════════════════════════════════════════════════════════════════════ */

type View = "dolphin" | "connected" | "total";
type Tab = "history" | "assets";
type SheetKind = "fund" | "alerts" | "more";

const HIDDEN = "••••";
const VIEW_KEY = "dolphin.wallet.view";
const NAMES: Record<View, string> = { dolphin: "Dolphin Wallet", connected: "Connected wallet", total: "Total balance" };

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readView(): View | null {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return value === "dolphin" || value === "connected" || value === "total" ? value : null;
  } catch {
    return null;
  }
}

function saveView(view: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // A private window: the choice just is not remembered.
  }
}

/** The USD rate for a token, keyed the way usePaymentRates keys it. BNB reads the BNB feed via WBNB. */
function rateKey(address: string | null) {
  return (address ?? WBNB_BSC).toLowerCase();
}

export function MobileWallet() {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const price = useBnbPrice();
  const currency = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setDisplayCurrency);
  const hidden = useAppStore((s) => s.hideBalances);
  const toggleHidden = useAppStore((s) => s.toggleHideBalances);
  useWalletErrorToasts();

  const identityAddress = identity.isConnected ? identity.address ?? null : null;
  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;

  // Lazy read: this screen only mounts on the client, after useMobileLayout decides.
  const [chosen, setChosen] = useState<View | null>(() => (typeof window === "undefined" ? null : readView()));
  const view: View = chosen ?? (dolphinAddress || !identityAddress ? "dolphin" : "connected");
  const pick = (next: View) => {
    setChosen(next);
    saveView(next);
  };

  const [tab, setTab] = useState<Tab>("history");
  const [menuOpen, setMenuOpen] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const viewAddresses = useMemo(() => {
    if (view === "dolphin") return dolphinAddress ? [dolphinAddress] : [];
    if (view === "connected") return identityAddress ? [identityAddress] : [];
    return [dolphinAddress, identityAddress].filter((a): a is string => Boolean(a));
  }, [view, dolphinAddress, identityAddress]);

  const tokens = useWalletTokens(viewAddresses);
  const rates = usePaymentRates(useMemo(() => WALLET_TOKENS.map((t) => ({ token: t.address ?? WBNB_BSC, decimals: t.decimals })), []));

  /* Per token, summed over the wallets in view. */
  const holdings = useMemo(() => {
    if (!tokens.data) return null;
    return WALLET_TOKENS.map((token) => {
      let raw = BigInt(0);
      let read = true;
      for (const address of viewAddresses) {
        const balance = tokens.data.get(address.toLowerCase())?.get(token.symbol);
        if (balance === undefined) read = false;
        else raw += balance;
      }
      return { token, raw, read };
    });
  }, [tokens.data, viewAddresses]);

  /*
   * The headline is the VALUE of everything held, like any wallet - not just
   * the BNB line. It is printed only when every held token has a read rate;
   * a sum missing a token is a wrong total, not a small one (AGENTS.md §5).
   */
  const headline = useMemo((): { figure: string; unit: string | null } | "reading" | "unavailable" => {
    if (!holdings) return tokens.isError ? "unavailable" : "reading";
    if (holdings.some((h) => !h.read)) return "unavailable";
    if (hidden) return { figure: HIDDEN, unit: null };
    const SCALE = BigInt(10) ** BigInt(18);
    const bnbRate = rates.get(rateKey(null));
    // Native BNB counts as itself in BNB; only the OTHER assets need a rate.
    let bnbWei = BigInt(0);
    let otherUsd18 = BigInt(0); // USD with 18 decimals, so nothing rounds to cents early
    for (const h of holdings) {
      if (h.raw === BigInt(0)) continue;
      if (h.token.address === null) {
        bnbWei += h.raw;
        continue;
      }
      const rate = rates.get(rateKey(h.token.address));
      if (!rate) return "reading";
      otherUsd18 += (h.raw * rate.num * SCALE) / (rate.den * BigInt(10) ** BigInt(h.token.decimals));
    }
    if (currency === "USD") {
      if (!bnbRate) return bnbWei === BigInt(0) ? { figure: formatUsdCents(otherUsd18 / BigInt(10) ** BigInt(16)), unit: null } : "reading";
      const bnbUsd18 = (bnbWei * bnbRate.num) / bnbRate.den;
      return { figure: formatUsdCents((bnbUsd18 + otherUsd18) / BigInt(10) ** BigInt(16)), unit: null };
    }
    if (otherUsd18 === BigInt(0)) return { figure: formatBnb(bnbWei), unit: "BNB" };
    if (!bnbRate) return "reading";
    // The other assets expressed in BNB at the same BNB rate the USD side uses.
    return { figure: formatBnb(bnbWei + (otherUsd18 * bnbRate.den) / bnbRate.num), unit: "BNB" };
  }, [holdings, rates, currency, hidden, tokens.isError]);

  const hasAccount = viewAddresses.length > 0;
  const canWithdraw = Boolean(dolphinAddress) && view !== "connected";

  function addFunds() {
    if (view === "total") {
      if (dolphinAddress && identityAddress) setSheet("fund");
      else setReceiving(dolphinAddress ?? identityAddress);
      return;
    }
    setReceiving(viewAddresses[0] ?? null);
  }

  return (
    <div className="mobile-wallet pw">
      <header className="mobile-wallet-topbar">
        <Link aria-label="Account details" className="mobile-circle overflow-hidden" href="/account">
          {identityAddress ? (
            <WalletAvatar address={identityAddress} kind="human" radius={19} size={38} />
          ) : (
            <CategoryGlyph name="wallet" size={20} />
          )}
        </Link>
        <MobileMenuButton />
      </header>

      <section aria-label="Wallet overview" className="pw-head">
        <AccountPicker
          dolphinAddress={dolphinAddress}
          identityAddress={identityAddress}
          onClose={() => setMenuOpen(false)}
          onPick={(next) => {
            pick(next);
            setMenuOpen(false);
          }}
          onToggle={() => setMenuOpen(!menuOpen)}
          open={menuOpen}
          view={view}
        />

        {hasAccount ? (
          typeof headline === "object" ? (
            <p aria-live="polite" className="pw-amount">
              {headline.figure}
              {headline.unit ? <span>{headline.unit}</span> : null}
            </p>
          ) : (
            <p aria-live="polite" className="pw-amount pw-amount--muted">
              {headline === "reading" ? "Reading…" : "Unavailable"}
            </p>
          )
        ) : (
          <p className="pw-amount pw-amount--muted">
            {view === "connected" ? "Not connected" : dolphin.status === "unsupported" ? "Unavailable here" : "Not set up"}
          </p>
        )}

        <div className="pw-controls">
          <CurrencySwitch currency={currency} onChange={setCurrency} price={price} />
          {hasAccount ? (
            <button
              aria-label={hidden ? "Show balances" : "Hide balances"}
              aria-pressed={hidden}
              className="wallet-eye"
              onClick={toggleHidden}
              type="button"
            >
              <CategoryGlyph color="currentColor" name={hidden ? "eye-off" : "eye"} size={18} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>

        {/* What this account needs before it can hold anything. */}
        {hasAccount ? null : view === "connected" || (view === "total" && !dolphinAddress && dolphin.status === "unsupported") ? (
          <div className="pw-setup">
            <WalletConnectButton connectLabel="Connect wallet" />
          </div>
        ) : dolphin.status === "unsupported" ? (
          <p className="pw-note">{dolphin.unsupportedReason ?? "This browser cannot hold a passkey wallet."}</p>
        ) : (
          <div className="pw-setup">
            <p className="pw-note">Pays for the agents you hire. Secured by your passkey.</p>
            <button
              className="wallet-btn wallet-btn--ink"
              disabled={dolphin.isBusy || dolphin.status === "loading"}
              onClick={() => void dolphin.createWallet()}
              type="button"
            >
              {dolphin.isBusy ? "Waiting for passkey…" : "Create with passkey"}
            </button>
            <button className="wcard__link" disabled={dolphin.isBusy} onClick={() => void dolphin.recoverWallet()} type="button">
              Recover an existing one
            </button>
          </div>
        )}

        {/* The keys. Add funds and Withdraw act on the account picked above. */}
        <div className="pw-keys">
          {hasAccount ? (
            <button onClick={addFunds} type="button">
              <span><CategoryGlyph name="arrow-down" size={22} /></span>
              Add funds
            </button>
          ) : null}
          {hasAccount && canWithdraw ? (
            <button disabled={dolphin.isBusy} onClick={() => setWithdrawing(true)} type="button">
              <span><CategoryGlyph name="arrow-up" size={22} /></span>
              Withdraw
            </button>
          ) : null}
          <button onClick={() => setSheet("alerts")} type="button">
            <span><CategoryGlyph name="bell" size={22} /></span>
            Alerts
          </button>
          <button onClick={() => setSheet("more")} type="button">
            <span><CategoryGlyph name="categories" size={22} /></span>
            More
          </button>
        </div>

        {view === "connected" && identityAddress ? (
          <div className="pw-disconnect">
            <WalletConnectButton connectLabel="Connect wallet" />
          </div>
        ) : null}
      </section>

      {dolphinAddress && dolphin.recoverability !== "registered" && view !== "connected" ? (
        <RecoverabilityPanel onDeposit={() => setReceiving(dolphinAddress)} />
      ) : null}

      <div aria-label="Wallet details" className="pw-tabs" role="tablist">
        {(["history", "assets"] as const).map((key) => (
          <button aria-selected={tab === key} className="pw-tab" key={key} onClick={() => setTab(key)} role="tab" type="button">
            {key === "history" ? "Wallet history" : "Assets"}
          </button>
        ))}
      </div>

      <div className="pw-panel" role="tabpanel">
        {tab === "history" ? (
          <WalletHistory addresses={viewAddresses} bare hidden={hidden} />
        ) : !hasAccount ? (
          <p className="pw-empty">{view === "connected" ? "Connect a wallet to see what it holds." : "Set up your Dolphin Wallet to see what it holds."}</p>
        ) : !holdings ? (
          tokens.isError ? (
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

      {sheet === "fund" && dolphinAddress && identityAddress ? (
        <Sheet onClose={() => setSheet(null)} title="Add funds to">
          {[
            { label: "Dolphin Wallet", address: dolphinAddress, kind: "bot" as const },
            { label: "Connected wallet", address: identityAddress, kind: "human" as const },
          ].map((option) => (
            <button
              className="pw-sheet__item"
              key={option.address}
              onClick={() => {
                setSheet(null);
                setReceiving(option.address);
              }}
              type="button"
            >
              <WalletAvatar address={option.address} kind={option.kind} radius={10} size={34} />
              <span>
                <strong>{option.label}</strong>
                <span>{short(option.address)}</span>
              </span>
            </button>
          ))}
        </Sheet>
      ) : null}
      {sheet === "alerts" ? (
        <Sheet onClose={() => setSheet(null)} title="Alerts">
          <OptionalFeature label="Liquidation alerts (mobile)">
            <LiquidationAlertPanel />
          </OptionalFeature>
        </Sheet>
      ) : null}
      {sheet === "more" ? (
        <Sheet onClose={() => setSheet(null)} title="More">
          {viewAddresses.length === 1 ? (
            <a className="pw-sheet__item" href={`https://bscscan.com/address/${viewAddresses[0]}`} rel="noreferrer" target="_blank">
              <span className="pw-sheet__icon"><CategoryGlyph name="external" size={18} /></span>
              <span>
                <strong>View on BscScan</strong>
                <span>{short(viewAddresses[0])}</span>
              </span>
            </a>
          ) : null}
          <AgentSpendingSection />
          {FEATURE_SESSION_EXECUTION && <PermissionsSection />}
          {dolphinAddress ? <DeviceAccessSection /> : null}
        </Sheet>
      ) : null}
      {withdrawing ? <WithdrawDialog initialAsset="U" onClose={() => setWithdrawing(false)} /> : null}
      {receiving ? (
        <ReceiveSheet
          address={receiving}
          label={receiving.toLowerCase() === dolphinAddress?.toLowerCase() ? "Dolphin Wallet" : "Connected wallet"}
          onClose={() => setReceiving(null)}
        />
      ) : null}
    </div>
  );
}

function AccountPicker({
  view,
  open,
  dolphinAddress,
  identityAddress,
  onToggle,
  onPick,
  onClose,
}: {
  view: View;
  open: boolean;
  dolphinAddress: string | null;
  identityAddress: string | null;
  onToggle: () => void;
  onPick: (view: View) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onClose]);

  const address = view === "dolphin" ? dolphinAddress : view === "connected" ? identityAddress : null;
  const options: { view: View; sub: string }[] = [
    { view: "total", sub: "Both wallets together" },
    { view: "dolphin", sub: dolphinAddress ? short(dolphinAddress) : "Not set up" },
    { view: "connected", sub: identityAddress ? short(identityAddress) : "Not connected" },
  ];

  return (
    <div className="pw-picker" ref={box}>
      <button
        aria-controls="pw-picker-list"
        aria-expanded={open}
        className="pw-picker__trigger"
        onClick={onToggle}
        ref={trigger}
        type="button"
      >
        {view === "total" ? (
          <span className="pw-picker__icon"><CategoryGlyph name="layers" size={16} /></span>
        ) : address ? (
          <WalletAvatar address={address} kind={view === "dolphin" ? "bot" : "human"} radius={8} size={28} />
        ) : (
          <span className="pw-picker__icon"><CategoryGlyph name={view === "dolphin" ? "bot" : "wallet"} size={16} /></span>
        )}
        <span className="pw-picker__name">{NAMES[view]}</span>
        <span aria-hidden="true" className={`pw-picker__chevron${open ? " pw-picker__chevron--open" : ""}`}>
          <CategoryGlyph color="currentColor" name="chevron-right" size={14} strokeWidth={2.2} />
        </span>
      </button>
      {address ? <p className="pw-picker__addr">{short(address)}</p> : null}
      {open ? (
        <ul aria-label="Accounts" className="pw-picker__list" id="pw-picker-list">
          {options.map((option) => (
            <li key={option.view}>
              <button
                aria-pressed={option.view === view}
                className="pw-picker__item"
                onClick={() => {
                  onPick(option.view);
                  trigger.current?.focus();
                }}
                type="button"
              >
                <span className="pw-picker__item-name">{NAMES[option.view]}</span>
                <span className={`pw-picker__item-sub${option.sub.startsWith("0x") ? " pw-mono" : ""}`}>{option.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TokenList({
  holdings,
  rates,
  hidden,
}: {
  holdings: { token: (typeof WALLET_TOKENS)[number]; raw: bigint; read: boolean }[];
  rates: ReadonlyMap<string, UsdRate>;
  hidden: boolean;
}) {
  // BNB and U always, so the wallet's two working currencies are never missing; others once held.
  const rows = holdings.filter((h) => h.token.symbol === "BNB" || h.token.symbol === "U" || h.raw > BigInt(0) || !h.read);
  return (
    <ul className="pw-tokens">
      {rows.map(({ token, raw, read }) => {
        const rate = rates.get(rateKey(token.address));
        return (
          <li className="pw-token" key={token.symbol}>
            {token.symbol === "BNB" || token.symbol === "U" ? (
              <AssetLogo asset={token.symbol} size={36} />
            ) : (
              <span aria-hidden="true" className="pw-token__badge">{token.symbol.slice(0, 1)}</span>
            )}
            <span className="pw-token__name">
              <strong>{token.symbol}</strong>
              <span>{!read ? "Unavailable" : hidden ? HIDDEN : formatTokenAmount(raw, token.decimals)}</span>
            </span>
            <span className="pw-token__value">
              {!read || hidden ? "" : rate ? formatUsdCents(usdCents(raw, token.decimals, rate)) : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A bottom sheet: the add-funds chooser, Alerts and More. Esc, the backdrop and Close all close it. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      aria-label={title}
      className="pw-sheet"
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      onClose={onClose}
      ref={ref}
    >
      <div className="pw-sheet__body">
        <div className="pw-sheet__head">
          <p className="pw-sheet__title">{title}</p>
          <button aria-label="Close" className="pw-sheet__close" onClick={() => ref.current?.close()} type="button">
            <CategoryGlyph color="currentColor" name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
