"use client";

import Link from "next/link";
import { useState } from "react";
import { useBalance } from "wagmi";

import { AgentActivity } from "@/components/agent-activity";
import { CategoryGlyph } from "@/components/category-glyph";
import { WalletAvatar } from "@/components/wallet-avatar";
import { formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet, WalletConnectButton } from "@/wallet/wallet-provider";

export function MobileWallet() {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState("");
  const identityAddress = identity.isConnected ? identity.address : null;
  const balance = useBalance({
    address: identityAddress as `0x${string}` | undefined,
    chainId: 56,
    query: { enabled: Boolean(identityAddress) },
  });
  // Sum only known accounts, and never present a partial total as complete.
  const count =
    Number(Boolean(identityAddress)) +
    Number(
      Boolean(
        dolphin.address &&
          dolphin.address.toLowerCase() !== identityAddress?.toLowerCase(),
      ),
    );
  const reading =
    dolphin.status === "loading" ||
    (identityAddress && balance.isLoading) ||
    (dolphin.address && dolphin.balanceWei === null && dolphin.isReadingBalance);
  const failed =
    (identityAddress && (balance.isError || !balance.data)) ||
    (dolphin.address && (dolphin.balanceError || dolphin.balanceWei === null));
  const total =
    !reading && !failed && count > 0
      ? (identityAddress ? balance.data!.value : BigInt(0)) +
        (dolphin.address &&
        dolphin.address.toLowerCase() !== identityAddress?.toLowerCase()
          ? dolphin.balanceWei!
          : BigInt(0))
      : null;

  async function receive() {
    if (!identityAddress) return;
    try {
      await navigator.clipboard.writeText(identityAddress);
      setNotice("Wallet address copied");
    } catch {
      setNotice(`Receive at ${identityAddress}`);
    }
  }

  return (
    <div className="mobile-wallet">
      <header className="mobile-wallet-topbar">
        <Link
          aria-label="Account details"
          className="mobile-circle overflow-hidden"
          href="/account"
        >
          {identityAddress ? (
            <WalletAvatar address={identityAddress} kind="human" radius={19} size={38} />
          ) : (
            <CategoryGlyph name="wallet" size={20} />
          )}
        </Link>
        <Link
          aria-label="Wallet and security details"
          className="mobile-circle"
          href="/account#security"
        >
          <CategoryGlyph name="info" size={20} />
        </Link>
      </header>

      <section aria-label="Wallet overview" className="mobile-wallet-total">
        <h1>Total balance</h1>
        <p className="mobile-wallet-amount">
          {hidden ? "****" : total !== null ? formatBnb(total) : reading ? "..." : "-"}
          <span>BNB</span>
        </p>
        {total !== null && (
          <button
            className="mobile-balance-visibility"
            onClick={() => setHidden(!hidden)}
            type="button"
          >
            {hidden ? "Show" : "Hide"}
          </button>
        )}
        <p className="mobile-wallet-note">
          {reading
            ? "Reading balances..."
            : count === 0
              ? "Connect a wallet to see your balance"
              : total === null
                ? "Unable to read the full balance"
                : `Across ${count} ${count === 1 ? "account" : "accounts"} on BNB`}
        </p>
        {identityAddress ? (
          <div className="mobile-wallet-actions">
            <button onClick={() => void receive()} type="button">
              <span>
                <CategoryGlyph name="receive" size={23} />
              </span>
              Receive
            </button>
            <a
              href={`https://bscscan.com/address/${identityAddress}`}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <CategoryGlyph name="external" size={23} />
              </span>
              BscScan
            </a>
            <button
              onClick={() => {
                void balance.refetch();
                dolphin.refreshBalance();
              }}
              type="button"
            >
              <span>
                <CategoryGlyph name="refresh" size={23} />
              </span>
              Refresh
            </button>
          </div>
        ) : (
          <div className="mobile-wallet-connect">
            <WalletConnectButton connectLabel="Connect wallet" />
          </div>
        )}
        {notice && (
          <p className="mobile-wallet-note" role="status">
            {notice}
          </p>
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
              <h2>Identity Wallet</h2>
              <p>MetaMask / Connected</p>
            </div>
            <CategoryGlyph name="chevron-right" size={16} />
          </header>
          <strong>
            {identityAddress
              ? hidden
                ? "****"
                : balance.data
                  ? `${formatBnb(balance.data.value)} BNB`
                  : balance.isLoading
                    ? "..."
                    : "Unavailable"
              : "Not connected"}
          </strong>
          <p>
            {identityAddress
              ? `${identityAddress.slice(0, 8)}...${identityAddress.slice(-6)}`
              : "Connect to view balance"}
          </p>
        </Link>

        <Link className="mobile-account-card" href="/account">
          <header>
            {dolphin.address ? (
              <WalletAvatar address={dolphin.address} kind="bot" radius={18} size={36} />
            ) : (
              <span className="mobile-account-card__icon">
                <CategoryGlyph name="bot" size={18} />
              </span>
            )}
            <div>
              <h2>Dolphin Smart Account</h2>
              <p>Altana Passkey - pays agents you hire</p>
            </div>
            <CategoryGlyph name="chevron-right" size={16} />
          </header>
          <strong>
            {dolphin.address
              ? hidden
                ? "****"
                : dolphin.balanceWei !== null && !dolphin.balanceError
                  ? `${formatBnb(dolphin.balanceWei)} BNB`
                  : dolphin.isReadingBalance
                    ? "..."
                    : "Unavailable"
              : dolphin.status === "loading"
                ? "..."
                : dolphin.status === "unsupported"
                  ? "Unavailable"
                  : "Not set up"}
          </strong>
          <p>
            {dolphin.address
              ? `${dolphin.address.slice(0, 8)}...${dolphin.address.slice(-6)}`
              : dolphin.status === "loading"
                ? "Checking this device"
                : dolphin.status === "unsupported"
                  ? dolphin.unsupportedReason
                  : "Create one in Account details"}
          </p>
        </Link>
      </div>

      <AgentActivity hidden={hidden} maxRows={4} mobile />
    </div>
  );
}
