"use client";

import { useQuery } from "convex/react";

import { walletActivityApi, type WalletActivityEntry } from "@/convex/api";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * The wallet's transactions, each linked to BscScan. (2026-09-26)
 *
 * Only transactions Dolphin sent AND verified on the chain before recording
 * them: escrow payments, escrow refunds, and ratings published to the ERC-8004
 * Reputation Registry (convex/walletActivity.ts). A free hire is not a
 * transaction, so it is not here.
 *
 * Anything else, swaps, transfers, and whatever the wallet did outside
 * Dolphin, is covered by the "full history" links at the bottom, which open
 * the address on BscScan and are complete by construction. The panel says so
 * rather than implying its list is everything.
 */

const BSCSCAN = "https://bscscan.com";

function shortHash(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function describe(entry: WalletActivityEntry): { title: string; amount: string | null } {
  const amount =
    entry.amountRaw !== null && entry.tokenDecimals !== null
      ? `${formatTokenAmount(entry.amountRaw, entry.tokenDecimals)} ${entry.tokenSymbol ?? ""}`.trim()
      : null;
  switch (entry.kind) {
    case "payment":
      return { title: `Paid ${entry.agentName}`, amount: amount ? `−${amount}` : null };
    case "refund":
      return { title: `Refund from ${entry.agentName}`, amount: amount ? `+${amount}` : null };
    case "rating":
      return { title: `Rated ${entry.agentName} on-chain`, amount: null };
  }
}

export function WalletTransactions() {
  const altana = useAltanaWallet();
  const identity = useWallet();
  const altanaAddress = altana.address;
  const identityAddress = identity.address ?? null;

  const entries = useQuery(
    walletActivityApi.walletActivity.forWallets,
    altanaAddress || identityAddress
      ? { altanaWalletAddress: altanaAddress, identityWalletAddress: identityAddress }
      : "skip",
  );

  if (!altanaAddress && !identityAddress) return null;

  return (
    <section aria-labelledby="transactions-heading" className="surface-raised mt-6 p-6">
      <h2 className="section-title" id="transactions-heading">
        Transactions
      </h2>

      {entries === undefined ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          None yet. Payments, refunds and ratings you make through Dolphin appear here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line/60">
          {entries.map((entry) => {
            const { title, amount } = describe(entry);
            return (
              <li
                className="flex items-center justify-between gap-4 py-3"
                key={`${entry.kind}:${entry.transactionHash}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {entry.jobId ? `Job #${entry.jobId} · ` : ""}
                    {when(entry.at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {amount ? (
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        entry.kind === "refund" ? "text-success" : "text-ink"
                      }`}
                    >
                      {amount}
                    </p>
                  ) : null}
                  <a
                    className="mt-0.5 inline-block text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
                    href={`${BSCSCAN}/tx/${entry.transactionHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {shortHash(entry.transactionHash)} ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-line/60 pt-3 text-xs leading-relaxed text-muted">
        Full history, including swaps and anything done outside Dolphin:{" "}
        {altanaAddress ? (
          <a
            className="underline decoration-line-strong underline-offset-2 hover:text-ink"
            href={`${BSCSCAN}/address/${altanaAddress}#tokentxns`}
            rel="noreferrer"
            target="_blank"
          >
            Dolphin Wallet ↗
          </a>
        ) : null}
        {altanaAddress && identityAddress ? " · " : null}
        {identityAddress ? (
          <a
            className="underline decoration-line-strong underline-offset-2 hover:text-ink"
            href={`${BSCSCAN}/address/${identityAddress}`}
            rel="noreferrer"
            target="_blank"
          >
            Connected wallet ↗
          </a>
        ) : null}
      </p>
    </section>
  );
}
