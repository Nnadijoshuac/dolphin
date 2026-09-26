"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatUnits, parseUnits, type PublicClient } from "viem";

import type { TradeTicket as TradeTicketData } from "@/convex/api";
import { bscPublicClient } from "@/services/chain";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import {
  TRADE_SLIPPAGE_BPS,
  describeRoute,
  minimumOut,
  quoteTrade,
} from "@/wallet/pancakeswap-trade";

/**
 * THE TRADE TICKET under a chat answer. (2026-09-26)
 *
 * The chat recognised a trade (convex/trade.ts) and stored what does not move:
 * the tokens, the amount, and what the safety agent said. Everything that
 * moves is read here, live:
 *
 * - the PancakeSwap quote, every 15 s, shown with its age;
 * - the Dolphin Wallet's balance of what is being sold.
 *
 * Sign re-quotes inside the wallet and refuses if the fresh price would pay
 * less than the minimum shown here. No USD figures: nothing on this card has
 * read a dollar price, so it does not print one (AGENTS.md §5).
 */

const QUOTE_REFRESH_MS = 15_000;

function secondsAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * 18.172882236573356408 reads as 18.172882. Below 1, four significant digits:
 * the first real trade (0.05 U -> BNB, 2026-09-26) showed "about 0.000064" and
 * "at least 0.000064", identical at six decimals when they were 0.0000647 and
 * 0.0000640, so the slippage line said nothing.
 */
function amount(raw: bigint, decimals: number): string {
  const text = formatUnits(raw, decimals);
  if (raw === BigInt(0) || !text.startsWith("0.")) return formatTokenAmount(raw, decimals);
  const fraction = text.slice(2);
  const leadingZeros = fraction.length - fraction.replace(/^0+/, "").length;
  return `0.${fraction.slice(0, leadingZeros + 4).replace(/0+$/, "")}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[0.74rem] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[0.86rem] text-ink">{children}</span>
    </div>
  );
}

export function TradeTicket({ ticket }: { ticket: TradeTicketData }) {
  const wallet = useAltanaWallet();
  const [now, setNow] = useState(() => Date.now());
  const [acknowledged, setAcknowledged] = useState(false);
  const [signing, setSigning] = useState(false);
  const [result, setResult] = useState<{ hash: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const amountInRaw = (() => {
    try {
      return parseUnits(ticket.amountIn, ticket.tokenIn.decimals);
    } catch {
      return null;
    }
  })();

  const quote = useQuery({
    queryKey: ["trade-quote", ticket.tokenIn.address, ticket.tokenOut.address, ticket.amountIn],
    enabled: amountInRaw !== null && result === null,
    queryFn: async () => {
      const routes = await quoteTrade({
        publicClient: bscPublicClient as unknown as PublicClient,
        tokenIn: ticket.tokenIn,
        tokenOut: ticket.tokenOut,
        amountInRaw: amountInRaw as bigint,
      });
      return routes[0] ?? null;
    },
    refetchInterval: QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const hasWallet = wallet.status === "connected" && wallet.address;
  const holding = useQuery({
    queryKey: ["trade-holding", wallet.address, ticket.tokenIn.address],
    enabled: Boolean(hasWallet),
    queryFn: async () =>
      ticket.tokenIn.address === null
        ? (wallet.balanceWei ?? null)
        : (await wallet.readTokenBalance(ticket.tokenIn.address)).raw,
    refetchInterval: 30_000,
  });

  const route = quote.data ?? null;
  const minOut = route ? minimumOut(route.amountOutRaw) : null;
  const short =
    amountInRaw !== null && typeof holding.data === "bigint" ? holding.data < amountInRaw : false;

  const safety = ticket.safety;
  const noGo = safety?.verdict === "no-go";
  const risky = !ticket.tokenOut.verified || !ticket.tokenIn.verified;
  /* An unlisted token with a failed or missing check needs an explicit yes. */
  const needsAcknowledgement = risky && (noGo || !safety || safety.unavailable !== null);

  const canSign =
    Boolean(hasWallet) &&
    route !== null &&
    minOut !== null &&
    amountInRaw !== null &&
    !short &&
    !signing &&
    !wallet.isBusy &&
    (!needsAcknowledgement || acknowledged);

  const sign = async () => {
    if (!route || minOut === null || amountInRaw === null) return;
    setSigning(true);
    setFailure(null);
    try {
      const done = await wallet.trade({
        tokenIn: ticket.tokenIn,
        tokenOut: ticket.tokenOut,
        amountInRaw,
        minimumOutRaw: minOut,
      });
      setResult({ hash: done.transactionHash });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSigning(false);
    }
  };

  return (
    <section
      aria-label={`Trade ${ticket.amountIn} ${ticket.tokenIn.symbol} for ${ticket.tokenOut.symbol}`}
      className="rounded-2xl border border-line/80 bg-paper px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">Trade</p>
        <p className="text-[0.7rem] text-faint">PancakeSwap · BNB Chain</p>
      </div>

      <p className="mt-1.5 text-[1.05rem] font-semibold text-ink">
        {ticket.amountIn} {ticket.tokenIn.symbol} → {ticket.tokenOut.symbol}
      </p>

      <div className="mt-2 border-t border-line/60 pt-1.5">
        <Row label="You get about">
          {quote.isLoading ? (
            <span className="text-faint">Quoting…</span>
          ) : route ? (
            <>
              {amount(route.amountOutRaw, ticket.tokenOut.decimals)} {ticket.tokenOut.symbol}
            </>
          ) : quote.isError ? (
            <span className="text-faint">Quote unavailable. Retrying…</span>
          ) : (
            <span className="text-faint">No PancakeSwap pool can take this trade</span>
          )}
        </Row>
        {route && minOut !== null ? (
          <>
            <Row label={`At least (${TRADE_SLIPPAGE_BPS / 100}% slippage)`}>
              {amount(minOut, ticket.tokenOut.decimals)} {ticket.tokenOut.symbol}
            </Row>
            <Row label="Route">{describeRoute(route)}</Row>
            <Row label="Quoted">{secondsAgo(quote.dataUpdatedAt, now)}</Row>
          </>
        ) : null}
        <Row label="From">
          {hasWallet ? (
            <>
              Dolphin Wallet
              {typeof holding.data === "bigint" ? (
                <span className="text-muted">
                  {" "}· holds {amount(holding.data, ticket.tokenIn.decimals)} {ticket.tokenIn.symbol}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-faint">No Dolphin Wallet on this device</span>
          )}
        </Row>
      </div>

      {/* What Dolphin itself knows about the token, separate from the agent's opinion. */}
      <div className="mt-2 space-y-2 border-t border-line/60 pt-2.5">
        {[ticket.tokenIn, ticket.tokenOut]
          .filter((token) => token.address !== null)
          .map((token) =>
            token.verified ? (
              <p className="text-[0.76rem] text-ink-soft" key={token.address}>
                <span className="font-semibold text-ink">{token.symbol}</span> is on Dolphin&rsquo;s verified token list.
              </p>
            ) : (
              <p className="text-[0.76rem] text-ink-soft" key={token.address}>
                <span className="font-semibold text-danger">{token.symbol}</span> is not on Dolphin&rsquo;s verified
                list. Anyone can name a token anything; check the address{" "}
                <a
                  className="font-mono underline"
                  href={`https://bscscan.com/token/${token.address}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {shortAddress(token.address as string)}
                </a>
                .
              </p>
            ),
          )}

        {safety ? (
          <div
            className={`rounded-xl px-3 py-2 ${
              safety.unavailable ? "bg-paper-muted" : noGo ? "bg-danger-soft" : "bg-paper-muted"
            }`}
          >
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted">
              {safety.agentName} on {safety.symbol} · {secondsAgo(safety.checkedAt, now)}
            </p>
            {safety.unavailable ? (
              <p className="mt-1 text-[0.8rem] text-ink-soft">{safety.unavailable}</p>
            ) : (
              <>
                <p className={`mt-1 text-[0.82rem] ${noGo ? "text-danger" : "text-ink"}`}>
                  {safety.headline ?? safety.verdict}
                </p>
                {safety.reason ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.72rem] text-muted">Why</summary>
                    <p className="mt-1 text-[0.76rem] leading-relaxed text-ink-soft">{safety.reason}</p>
                  </details>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="mt-3 rounded-xl bg-success/10 px-3 py-2.5">
          <p className="text-[0.84rem] font-semibold text-ink">Trade sent.</p>
          {result.hash ? (
            <a
              className="text-[0.78rem] underline"
              href={`https://bscscan.com/tx/${result.hash}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              View it on BscScan ↗
            </a>
          ) : (
            <p className="text-[0.78rem] text-muted">The wallet did not report a transaction hash.</p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {needsAcknowledgement ? (
            <label className="mb-2 flex items-start gap-2 text-[0.76rem] text-ink-soft">
              <input
                checked={acknowledged}
                className="mt-0.5"
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              I&rsquo;ve checked this token myself and want to trade it anyway.
            </label>
          ) : null}
          {hasWallet ? (
            <button
              className="flex h-10 w-full items-center justify-center rounded-xl bg-ink px-4 text-[13.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
              disabled={!canSign}
              onClick={() => void sign()}
              type="button"
            >
              <span className="text-canvas">
                {signing ? "Waiting for your passkey…" : short ? `Not enough ${ticket.tokenIn.symbol}` : "Sign and trade"}
              </span>
            </button>
          ) : (
            <Link
              className="flex h-10 w-full items-center justify-center rounded-xl bg-ink px-4 text-[13.5px] font-semibold no-underline"
              href="/wallet"
            >
              <span className="text-canvas">Set up your Dolphin Wallet to trade</span>
            </Link>
          )}
          {failure ? <p className="mt-2 text-[0.78rem] text-danger">{failure}</p> : null}
          <p className="mt-2 text-[0.7rem] leading-relaxed text-muted">
            Signed with your passkey from your Dolphin Wallet. Dolphin never holds your key, and the price is checked
            again when you sign.
          </p>
        </div>
      )}
    </section>
  );
}
