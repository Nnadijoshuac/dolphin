"use client";

/**
 * WALLET HISTORY - every movement of the Dolphin Wallet, read from the chain
 * (owner, 2026-10-02: "every add, every remove, every spend and gain").
 *
 * Agent activity only knew what Dolphin did; money added from outside, the
 * network fees and the one-time setup never appeared. convex/walletHistory.ts
 * reads the wallet's transfers from the chain and names each transaction.
 * Amounts are what moved, in the token that moved; the network fee is shown
 * under the line it paid for, never mixed into the amount.
 */

import { useQuery } from "@tanstack/react-query";
import { useAction } from "convex/react";
import { useState } from "react";
import { formatUnits } from "viem";

import { CategoryGlyph } from "@/components/category-glyph";
import { walletHistoryApi, type WalletHistoryEntry } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import { useAltanaWallet } from "@/wallet/altana-provider";

const PAGE = 10;

/** "0.05", "0.0000647": small amounts keep four significant digits. */
function amount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const text = formatUnits(value, decimals);
  if (!text.startsWith("0.")) return Number(text).toLocaleString("en", { maximumFractionDigits: 4 });
  const fraction = text.slice(2);
  const zeros = fraction.length - fraction.replace(/^0+/, "").length;
  if (zeros > 9) return "<0.000000001";
  return `0.${fraction.slice(0, zeros + 4).replace(/0+$/, "")}`;
}

const GLYPH: Record<WalletHistoryEntry["kind"], "arrow-down" | "arrow-up" | "dollar" | "refresh" | "shield" | "layers"> = {
  deposit: "arrow-down",
  refund: "arrow-down",
  payment: "dollar",
  swap: "refresh",
  withdraw: "arrow-up",
  setup: "shield",
  fee: "layers",
  other: "layers",
};

function day(ms: number): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

type Move = WalletHistoryEntry["movements"][number];

/** Below 0.000000001 of a token: real, but too small to print as a number. */
function isDust(m: Move): boolean {
  return BigInt(m.amountRaw) * BigInt(1_000_000_000) < BigInt(10) ** BigInt(m.decimals);
}

/**
 * The amounts a row shows (owner, 2026-10-02: "-<0.000000001 BNB +<0.000000001 U"
 * read as broken). Those were real: a job priced at 1 wei of U, and the top-up
 * of that 1 wei when the next hire came up short. Dust beside a real amount
 * is dropped; a row that moved only dust shows one plain "under" line.
 */
function rowAmounts(entry: WalletHistoryEntry): { lines: string[]; tiny: boolean } {
  // One line per token: change handed back in the same transaction (the router
  // returning unspent BNB at setup) is netted, not printed as a second line.
  const net = new Map<string, Move>();
  for (const m of entry.movements) {
    const signed = (m.direction === "in" ? BigInt(1) : BigInt(-1)) * BigInt(m.amountRaw);
    const prev = net.get(m.symbol);
    const total = (prev ? (prev.direction === "in" ? BigInt(1) : BigInt(-1)) * BigInt(prev.amountRaw) : BigInt(0)) + signed;
    net.set(m.symbol, { ...m, direction: total < BigInt(0) ? "out" : "in", amountRaw: (total < BigInt(0) ? -total : total).toString() });
  }
  const real = [...net.values()].filter((m) => BigInt(m.amountRaw) > BigInt(0) && !isDust(m));
  if (real.length) {
    return { lines: real.map((m) => `${m.direction === "in" ? "+" : "−"}${amount(m.amountRaw, m.decimals)} ${m.symbol}`), tiny: false };
  }
  if (!entry.movements.length) return { lines: [], tiny: false };
  // What the row is about: what came in for a swap or refund, what went out otherwise.
  const pick = entry.movements.find((m) => m.direction === (entry.kind === "payment" || entry.kind === "withdraw" ? "out" : "in")) ?? entry.movements[0];
  return { lines: [`under 0.000000001 ${pick.symbol}`], tiny: true };
}

function Row({ entry, hidden }: { entry: WalletHistoryEntry; hidden: boolean }) {
  const moves = rowAmounts(entry);
  const fee = BigInt(entry.feeWei) > BigInt(0) ? `fee ${amount(entry.feeWei, 18)} BNB` : null;
  return (
    <a className="wallet-activity-row interactive" href={`https://bscscan.com/tx/${entry.hash}`} rel="noreferrer" target="_blank">
      <span
        aria-hidden="true"
        className="wallet-activity-icon grid h-11 w-11 place-items-center bg-paper-muted text-ink"
      >
        <CategoryGlyph color="currentColor" name={GLYPH[entry.kind]} size={18} strokeWidth={1.8} />
      </span>
      <div>
        <h3>{entry.title}</h3>
        <p>{[day(entry.at), fee].filter(Boolean).join(" · ")}</p>
      </div>
      {moves.lines.length ? (
        <strong
          className={`wallet-activity-amounts${moves.tiny ? " text-muted" : entry.movements.every((m) => m.direction === "in") ? " text-success" : ""}`}
        >
          {hidden ? "...." : moves.lines.map((line) => <span key={line}>{line}</span>)}
        </strong>
      ) : null}
    </a>
  );
}

export function WalletHistory({ hidden = false }: { hidden?: boolean }) {
  if (!convexClient) return null;
  return <WalletHistoryContent hidden={hidden} />;
}

function WalletHistoryContent({ hidden }: { hidden: boolean }) {
  const wallet = useAltanaWallet();
  const address = wallet.status === "connected" ? wallet.address : null;
  const read = useAction(walletHistoryApi.walletHistory.forWallet);
  const history = useQuery({
    queryKey: ["wallet-history", address],
    enabled: Boolean(address),
    queryFn: () => read({ address: address! }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const [shown, setShown] = useState(PAGE);

  const data = history.data;
  const entries = data && data.status === "ok" ? data.entries : [];

  return (
    <section className="wallet-activity" id="history">
      <header>
        <div>
          <p className="eyebrow">Dolphin Wallet</p>
          <h2>Wallet history</h2>
        </div>
        {address ? (
          <a href={`https://bscscan.com/address/${address}`} rel="noreferrer" target="_blank">
            BscScan ↗
          </a>
        ) : null}
      </header>

      {!address ? (
        <p className="py-6 text-center text-[0.8rem] text-muted">Set up your Dolphin Wallet to see its history.</p>
      ) : history.isPending ? (
        <div aria-busy="true" className="space-y-2 py-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="skeleton h-12 rounded-xl" key={i} />
          ))}
        </div>
      ) : history.isError || (data && data.status !== "ok") ? (
        <p className="py-6 text-center text-[0.8rem] text-muted">
          History can&apos;t be read right now. Everything is on BscScan in the meantime.
        </p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-[0.8rem] text-muted">Nothing yet. Money you add and spend will show here.</p>
      ) : (
        <>
          <div className="wallet-activity-list">
            {entries.slice(0, shown).map((entry) => (
              <Row entry={entry} hidden={hidden} key={entry.hash} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 text-[0.74rem] text-muted">
            <span>
              {data && data.status === "ok" && data.hiddenTokens > 0
                ? `${data.hiddenTokens} unknown token ${data.hiddenTokens === 1 ? "transfer" : "transfers"} hidden`
                : ""}
            </span>
            {entries.length > shown ? (
              <button className="font-semibold text-ink hover:underline" onClick={() => setShown(shown + PAGE)} type="button">
                Show more
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
