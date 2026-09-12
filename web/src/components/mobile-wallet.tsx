"use client";

import Link from "next/link";
import { useState } from "react";
import { useBalance } from "wagmi";

import { AgentActivity } from "@/components/agent-activity";
import { CategoryGlyph } from "@/components/category-glyph";
import { LiquidationAlertPanel } from "@/components/liquidation-alert-panel";
import { OptionalFeature } from "@/components/optional-feature";
import { ReceiveSheet } from "@/components/receive-sheet";
import { WalletAvatar } from "@/components/wallet-avatar";
import { useBnbPrice } from "@/hooks/use-bnb-price";
import { useAppStore, type DisplayCurrency } from "@/store/use-app-store";
import { ALTANA_CHAIN_ID, formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatUsdFromWei, type BnbPrice } from "@/wallet/bnb-price";
import { useWallet, WalletConnectButton } from "@/wallet/wallet-provider";
import { summariseTotal } from "@/wallet/wallet-total";

/* ═══════════════════════════════════════════════════════════════════════════
   THE PHONE WALLET
   ═══════════════════════════════════════════════════════════════════════════

   Brought onto the desktop screen's material system on 2026-09-12, and it is
   worth recording which way that borrowing went.

   THE PHONE WAS RIGHT FIRST. It already had the single total, the glyph action
   row, the hide toggle and the account cards while the desktop screen was
   still showing two competing balances and no title. What it did NOT have was
   depth, a currency choice, a QR, or a receive surface — so what it gets here
   is the newer half of the desktop work, not a redesign of what it got right.

   Everything shared is genuinely shared rather than re-implemented:
   summariseTotal decides the total on both, the same store holds the currency
   and hide preferences, and ReceiveSheet is the same component. Two wallet
   screens that disagree about what you own would be worse than either being
   wrong alone.

   WHAT THE PHONE DOES DIFFERENTLY, on purpose:
     - one column, cards stacked
     - 44px minimum touch targets on everything pressable
     - the action row is circular keys, which is the phone idiom, rather than
       the desktop's labelled pills
   ═══════════════════════════════════════════════════════════════════════════ */

const HIDDEN = "••••";

function renderAmount(
  wei: bigint,
  currency: DisplayCurrency,
  price: BnbPrice | null,
  hidden: boolean,
): { figure: string; unit: string | null } {
  if (hidden) return { figure: HIDDEN, unit: null };
  if (currency === "USD" && price) {
    return { figure: formatUsdFromWei(wei, price), unit: null };
  }
  return { figure: formatBnb(wei), unit: "BNB" };
}

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function MobileWallet() {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const priceState = useBnbPrice();
  const currency = useAppStore((s) => s.displayCurrency);
  const setCurrency = useAppStore((s) => s.setDisplayCurrency);
  const hidden = useAppStore((s) => s.hideBalances);
  const toggleHidden = useAppStore((s) => s.toggleHideBalances);
  const [receiving, setReceiving] = useState<string | null>(null);

  const identityAddress = identity.isConnected ? identity.address : null;
  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;

  /*
   * chainId pinned, same correctness fix as the desktop card: an unpinned read
   * returns whatever chain the connector sits on, while the label says BNB.
   * Pinning also shares one react-query key with the desktop hero's read.
   */
  const balance = useBalance({
    address: identityAddress as `0x${string}` | undefined,
    chainId: ALTANA_CHAIN_ID,
    query: { enabled: Boolean(identityAddress) },
  });

  // The SAME rule as the desktop hero. A partial sum is a wrong total, not a
  // small one, so it is never printed. See wallet/wallet-total.ts.
  const total = summariseTotal({
    identityAddress,
    identityWei: balance.data?.value ?? null,
    identityLoading: balance.isLoading,
    dolphinAddress,
    dolphinWei: dolphin.balanceWei,
    dolphinLoading: dolphin.status === "loading" || dolphin.isReadingBalance,
    dolphinErrored: Boolean(dolphin.balanceError),
  });

  const price = priceState.status === "ready" ? priceState.price : null;
  const usdReady = price !== null;
  const amount =
    total.kind === "ready" ? renderAmount(total.wei, currency, price, hidden) : null;

  const placeholder =
    total.kind === "reading"
      ? "Reading…"
      : total.kind === "partial"
        ? "Unavailable"
        : "No balance yet";

  const note =
    total.kind === "ready"
      ? `${total.accounts} ${total.accounts === 1 ? "account" : "accounts"} on BNB`
      : total.kind === "reading"
        ? "Checking accounts…"
        : total.kind === "partial"
          ? "One balance could not be read"
          : "Connect an account to see a balance";

  const receiveTarget = dolphinAddress ?? identityAddress;

  return (
    <div className="mobile-wallet">
      <header className="mobile-wallet-topbar">
        <Link aria-label="Account details" className="mobile-circle overflow-hidden" href="/account">
          {identityAddress ? (
            <WalletAvatar address={identityAddress} kind="human" radius={19} size={38} />
          ) : (
            <CategoryGlyph name="wallet" size={20} />
          )}
        </Link>
        <Link aria-label="Wallet and security details" className="mobile-circle" href="/account#security">
          <CategoryGlyph name="info" size={20} />
        </Link>
      </header>

      <section aria-label="Wallet overview" className="mobile-wallet-total">
        {/* The readout, sunk into the page like a display window. */}
        <div className="mobile-readout">
          {amount ? (
            <p className="mobile-wallet-amount">
              {amount.figure}
              {amount.unit && <span>{amount.unit}</span>}
            </p>
          ) : (
            /* A word, not a mark, and well below the figure's size. An
               em-dash at this scale is a bar that reads as a skeleton. */
            <p className="mobile-wallet-placeholder">{placeholder}</p>
          )}

          <div className="mobile-readout__controls">
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
                onClick={() => setCurrency("BNB")}
                type="button"
              >
                BNB
              </button>
              {/* Disabled rather than hidden while no price is readable:
                  hiding it leaves someone wondering whether the feature
                  exists, disabling it says the price does not. */}
              <button
                aria-pressed={currency === "USD" && usdReady}
                className="wallet-switch__opt"
                disabled={!usdReady}
                onClick={() => setCurrency("USD")}
                type="button"
              >
                USD
              </button>
            </div>

            {total.kind === "ready" && (
              <button
                aria-label={hidden ? "Show balances" : "Hide balances"}
                aria-pressed={hidden}
                className="wallet-eye"
                onClick={toggleHidden}
                type="button"
              >
                {/* Icon, not the word "Hide". A label beside an eye is
                    explaining a light switch. */}
                <CategoryGlyph
                  color="currentColor"
                  name={hidden ? "eye-off" : "eye"}
                  size={18}
                  strokeWidth={1.8}
                />
              </button>
            )}
          </div>
        </div>

        <p className="mobile-wallet-note">{note}</p>

        {receiveTarget ? (
          <div className="mobile-wallet-actions">
            {/*
             * Receive OPENS THE SHEET now. It used to write the address to the
             * clipboard and set a notice string — no address shown, no QR, and
             * a rejected clipboard write looked identical to success.
             */}
            <button onClick={() => setReceiving(receiveTarget)} type="button">
              <span><CategoryGlyph name="receive" size={23} /></span>
              Receive
            </button>
            <a
              href={`https://bscscan.com/address/${receiveTarget}`}
              rel="noreferrer"
              target="_blank"
            >
              <span><CategoryGlyph name="external" size={23} /></span>
              BscScan
            </a>
            <button
              onClick={() => {
                void balance.refetch();
                dolphin.refreshBalance();
              }}
              type="button"
            >
              <span><CategoryGlyph name="refresh" size={23} /></span>
              Refresh
            </button>
          </div>
        ) : (
          <div className="mobile-wallet-connect">
            <WalletConnectButton connectLabel="Connect wallet" />
          </div>
        )}
      </section>

      <div className="mobile-wallet-accounts">
        <Link className="mobile-account-card" href="/account">
          <header>
            {identityAddress ? (
              <WalletAvatar address={identityAddress} kind="human" radius={18} size={36} />
            ) : (
              <span className="mobile-account-card__icon">
                <CategoryGlyph name="wallet" size={18} />
              </span>
            )}
            <div>
              <h2>Your wallet</h2>
              <p>Signs in · hire records</p>
            </div>
            <CategoryGlyph name="chevron-right" size={16} />
          </header>
          <strong>
            {identityAddress
              ? balance.data
                ? renderAmount(balance.data.value, currency, price, hidden).figure
                : balance.isLoading
                  ? "…"
                  : "Unavailable"
              : "Not connected"}
          </strong>
          <p>{identityAddress ? truncate(identityAddress) : "Connect to view balance"}</p>
        </Link>

        <Link className="mobile-account-card mobile-account-card--agent" href="/account">
          <header>
            {dolphinAddress ? (
              <WalletAvatar address={dolphinAddress} kind="bot" radius={18} size={36} />
            ) : (
              <span className="mobile-account-card__icon">
                <CategoryGlyph name="bot" size={18} />
              </span>
            )}
            <div>
              <h2>Agent payments</h2>
              <p>Pays your hires</p>
            </div>
            <CategoryGlyph name="chevron-right" size={16} />
          </header>
          <strong>
            {dolphinAddress
              ? dolphin.balanceWei !== null && !dolphin.balanceError
                ? renderAmount(dolphin.balanceWei, currency, price, hidden).figure
                : dolphin.isReadingBalance
                  ? "…"
                  : "Unavailable"
              : dolphin.status === "loading"
                ? "…"
                : dolphin.status === "unsupported"
                  ? "Unavailable"
                  : "Not set up"}
          </strong>
          <p>
            {dolphinAddress
              ? truncate(dolphinAddress)
              : dolphin.status === "loading"
                ? "Checking this device"
                : dolphin.status === "unsupported"
                  ? dolphin.unsupportedReason
                  : "Set up in Account"}
          </p>
        </Link>
      </div>

      <AgentActivity hidden={hidden} maxRows={4} mobile />

      {/*
        * Liquidation alerts, on the phone too.
        *
        * This is the surface where the feature matters MOST, not least - the
        * whole premise is being told about a position while you are away from
        * a desk, and a phone is where that message arrives. Shipping it
        * desktop-only would have made the one screen that cannot watch
        * anything the only one that can ask to be told.
        *
        * Same boundary as the desktop wallet: an opt-in panel querying
        * functions a deployment may not have yet must not be able to take the
        * route down. See components/optional-feature.tsx.
        */}
      <OptionalFeature label="Liquidation alerts (mobile)">
        <LiquidationAlertPanel />
      </OptionalFeature>

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
