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

import { useQueries } from "@tanstack/react-query";
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

/**
 * `addresses` picks whose history this is (the phone's wallet switcher,
 * 2026-10-02); left out, it is the Dolphin Wallet's. Several addresses are
 * merged newest first, and a transaction between them appears once.
 */
export function WalletHistory({
  hidden = false,
  addresses,
  bare = false,
}: {
  hidden?: boolean;
  addresses?: readonly string[];
  /** No heading: the phone puts this under its own History tab. */
  bare?: boolean;
}) {
  if (!convexClient) return null;
  return <WalletHistoryContent addresses={addresses} bare={bare} hidden={hidden} />;
}

function WalletHistoryContent({
  hidden,
  addresses,
  bare,
}: {
  hidden: boolean;
  addresses: readonly string[] | undefined;
  bare: boolean;
}) {
  const wallet = useAltanaWallet();
  const dolphin = wallet.status === "connected" ? wallet.address : null;
  const targets = addresses ?? (dolphin ? [dolphin] : []);
  const address = targets[0] ?? null;
  const read = useAction(walletHistoryApi.walletHistory.forWallet);
  const reads = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["wallet-history", target],
      queryFn: () => read({ address: target }),
      staleTime: 60_000,
      refetchInterval: 120_000,
    })),
  });
  const [shown, setShown] = useState(PAGE);

  const history = {
    isPending: reads.some((q) => q.isPending),
    isError: reads.length > 0 && reads.every((q) => q.isError || (q.data && q.data.status !== "ok")),
  };
  // Cheap enough to rebuild each render (two lists of at most 200 rows).
  const byHash = new Map<string, WalletHistoryEntry>();
  let hiddenTokens = 0;
  for (const q of reads) {
    if (q.data?.status !== "ok") continue;
    hiddenTokens += q.data.hiddenTokens;
    for (const entry of q.data.entries) if (!byHash.has(entry.hash)) byHash.set(entry.hash, entry);
  }
  const merged = { entries: [...byHash.values()].sort((a, b) => b.at - a.at), hiddenTokens };
  const data = { status: "ok" as const, hiddenTokens: merged.hiddenTokens };
  const entries = merged.entries;

  return (
    <section className={`wallet-activity${bare ? " wallet-activity--bare" : ""}`} id="history">
      {bare ? null : <header>
        <div>
          <p className="eyebrow">Dolphin Wallet</p>
          <h2>Wallet history</h2>
        </div>
        {address ? (
          <a href={`https://bscscan.com/address/${address}`} rel="noreferrer" target="_blank">
            BscScan ↗
          </a>
        ) : null}
      </header>}

      {!address ? (
        <p className="py-6 text-center text-[0.8rem] text-muted">
          {addresses ? "Connect this wallet to see its history." : "Set up your Dolphin Wallet to see its history."}
        </p>
      ) : history.isPending ? (
        <div aria-busy="true" className="space-y-2 py-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="skeleton h-12 rounded-xl" key={i} />
          ))}
        </div>
      ) : history.isError ? (
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
