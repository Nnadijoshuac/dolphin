"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";

import { QrCode } from "@/components/qr-code";
import { agentWalletApi, walletActionsApi, type AgentWalletHolding } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * THE AGENT'S OWN WALLET (convex/agentWallet.ts): where to send it money,
 * what it holds (read live, on open and on Refresh - never polled), what it
 * did, and a way to take everything back. Withdrawals go only to the wallet
 * building the agent, so the controls are shown only to that wallet.
 */

function errorText(cause: unknown, fallback: string): string {
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : toUserMessage(cause, fallback);
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function amountText(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n >= 1 ? n.toLocaleString("en", { maximumFractionDigits: 4 }) : n.toPrecision(4);
}

function usdText(value: number | null): string | null {
  if (value === null) return null;
  return value >= 1 ? `$${value.toLocaleString("en", { maximumFractionDigits: 2 })}` : `$${value.toFixed(2)}`;
}

type Reading = { holdings: AgentWalletHolding[]; checkedAt: number } | "loading" | "error";

export function AgentWalletPanel({ conversationKey }: { conversationKey: string }) {
  const wallet = useQuery(agentWalletApi.agentWallet.forDraft, { conversationKey });
  const readBalances = useAction(agentWalletApi.agentWallet.balances);
  const withdraw = useAction(agentWalletApi.agentWallet.withdraw);
  const session = useWalletSession();
  const connected = useWallet();
  const activity = useQuery(
    walletActionsApi.walletActions.forWallet,
    wallet ? { altanaWalletAddress: wallet.address } : "skip",
  );
  const [reading, setReading] = useState<Reading>("loading");
  const [version, setVersion] = useState(0);
  const [showQr, setShowQr] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const address = wallet?.address ?? null;
  useEffect(() => {
    if (!address) return;
    let live = true;
    readBalances({ conversationKey })
      .then((result) => {
        if (live) setReading(result ? { holdings: result.holdings, checkedAt: result.checkedAt } : "error");
      })
      .catch(() => {
        if (live) setReading("error");
      });
    return () => {
      live = false;
    };
  }, [address, conversationKey, readBalances, version]);

  if (wallet === undefined) return <p className="mt-3 text-[0.74rem] text-muted">Loading the wallet…</p>;
  if (wallet === null) return null;

  const isOwner = Boolean(connected.address && connected.address.toLowerCase() === wallet.ownerAddress.toLowerCase());
  const refresh = () => {
    setReading("loading");
    setVersion((n) => n + 1);
  };

  const sendHome = async (symbol: string) => {
    setSending(symbol);
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      const result = await withdraw({ sessionToken, conversationKey, symbol, amount: "all" });
      toast.success(result.text);
      setConfirming(null);
      refresh();
    } catch (cause) {
      toast.error(errorText(cause, "The withdrawal was not sent."));
    } finally {
      setSending(null);
    }
  };

  const total =
    typeof reading === "object" && reading.holdings.length > 0 && reading.holdings.every((row) => row.usd !== null)
      ? reading.holdings.reduce((sum, row) => sum + (row.usd ?? 0), 0)
      : null;

  return (
    <div className="agent-wallet mt-3">
      <div className="agent-wallet__address">
        <div className="min-w-0 flex-1">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted">Send funds to</p>
          <p className="truncate font-mono text-[0.78rem] text-ink" title={wallet.address}>
            {wallet.address}
          </p>
        </div>
        <button
          className="agent-wallet__chip"
          onClick={() => {
            void navigator.clipboard.writeText(wallet.address).then(() => toast.success("Address copied."));
          }}
          type="button"
        >
          Copy
        </button>
        <button className="agent-wallet__chip" onClick={() => setShowQr((open) => !open)} type="button">
          {showQr ? "Hide" : "QR"}
        </button>
      </div>
      {showQr ? (
        <div className="mt-2 grid place-items-center rounded-xl bg-white p-3">
          <QrCode size={132} value={wallet.address} />
        </div>
      ) : null}
      <p className="mt-2 text-[0.68rem] leading-snug text-muted">
        BNB Chain only. Keep a little BNB in it for gas. Dolphin holds this wallet&apos;s key, so keep in it only what
        you would let the agent trade.
      </p>

      <div className="mt-3 flex items-baseline gap-2">
        <p className="flex-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted">Holds</p>
        {total !== null ? <p className="text-[0.84rem] font-semibold text-ink">{usdText(total)}</p> : null}
        <button className="!text-[0.7rem] font-semibold text-muted hover:text-ink" onClick={refresh} type="button">
          Refresh
        </button>
      </div>
      {reading === "loading" ? (
        <p className="mt-1.5 text-[0.74rem] text-muted">Reading the chain…</p>
      ) : reading === "error" ? (
        <p className="mt-1.5 text-[0.74rem] text-muted">The balance could not be read right now. Refresh to try again.</p>
      ) : reading.holdings.length === 0 ? (
        <p className="mt-1.5 text-[0.74rem] leading-snug text-muted">Empty. Send BNB, or a token the agent trades, to the address above.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {reading.holdings.map((row) => (
            <li className="agent-wallet__row" key={row.symbol}>
              <span className="w-14 shrink-0 text-[0.78rem] font-semibold text-ink">{row.symbol}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[0.76rem] text-ink-soft">{amountText(row.amount)}</span>
              {usdText(row.usd) ? <span className="shrink-0 text-[0.72rem] text-muted">{usdText(row.usd)}</span> : null}
              {isOwner ? (
                confirming === row.symbol ? (
                  <button
                    className="agent-wallet__chip agent-wallet__chip--strong"
                    disabled={sending !== null}
                    onClick={() => void sendHome(row.symbol)}
                    type="button"
                  >
                    {sending === row.symbol ? "Sending…" : `Send all to ${short(wallet.ownerAddress)}`}
                  </button>
                ) : (
                  <button className="agent-wallet__chip" disabled={sending !== null} onClick={() => setConfirming(row.symbol)} type="button">
                    Withdraw
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {activity && activity.length > 0 ? (
        <>
          <p className="mt-3 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted">Activity</p>
          <ul className="mt-1.5 space-y-1">
            {activity.slice(0, 6).map((row) => (
              <li className="agent-wallet__row" key={row.transactionHash}>
                <a
                  className="min-w-0 flex-1 truncate text-[0.74rem] text-ink no-underline hover:underline"
                  href={`https://bscscan.com/tx/${row.transactionHash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {row.kind === "withdraw" ? "Withdrew" : row.sent.length && row.received.length ? "Traded" : "Sent"}{" "}
                  {row.sent.map((m) => `${m.amountRaw ? amountText(formatUnits(BigInt(m.amountRaw), m.decimals)) : ""} ${m.symbol}`.trim()).join(" + ")}
                  {row.received.length
                    ? ` → ${row.received.map((m) => `${m.amountRaw ? amountText(formatUnits(BigInt(m.amountRaw), m.decimals)) : ""} ${m.symbol}`.trim()).join(" + ")}`
                    : ""}
                </a>
                <span className="shrink-0 text-[0.68rem] text-muted">
                  {new Date(row.executedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
