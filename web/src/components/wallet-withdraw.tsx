"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { DOLPHIN_CONTRACTS } from "@/constants/agents";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import {
  maxNativeWithdrawal,
  parseWithdrawAmount,
  withdrawRefusal,
  type WithdrawAsset,
} from "@/wallet/withdraw-policy";

/**
 * The Dolphin Wallet's $U balance and the way out. (2026-09-26)
 *
 * Money reached this wallet (deposits, swaps, escrow refunds) and could only
 * leave it to pay an agent, and its $U balance was shown nowhere. This shows
 * the $U balance, read live, and withdraws $U or BNB to the person's own
 * connected wallet only. See wallet/withdraw-policy.ts for why there is no
 * address field.
 */

const U_TOKEN = DOLPHIN_CONTRACTS.find((contract) => contract.label === "Payment token (U)")!.address;

type Choice = "U" | "BNB";
type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; transactionHash: string | null }
  | { kind: "error"; message: string };

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function WalletWithdraw() {
  const dolphin = useAltanaWallet();
  const identity = useWallet();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("U");
  const [amountText, setAmountText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;
  const ownAddress = identity.isConnected ? identity.address : null;

  const uBalance = useQuery({
    queryKey: ["dolphin-token-balance", dolphinAddress, U_TOKEN],
    queryFn: () => dolphin.readTokenBalance(U_TOKEN),
    enabled: Boolean(dolphinAddress),
    staleTime: 15_000,
  });

  if (!dolphinAddress) return null;

  const u = uBalance.data ?? null;
  const asset: WithdrawAsset =
    choice === "BNB"
      ? { kind: "native", symbol: "BNB", decimals: 18 }
      : { kind: "token", token: U_TOKEN, symbol: u?.symbol ?? "U", decimals: u?.decimals ?? 18 };

  const uText = uBalance.isError
    ? "U balance unavailable"
    : u
      ? `${formatTokenAmount(u.raw, u.decimals)} ${u.symbol}`
      : "Reading U…";

  const amountRaw = parseWithdrawAmount(amountText, asset.decimals);
  const availableForChoice = choice === "U" ? u?.raw ?? null : dolphin.balanceWei;
  const refusal = withdrawRefusal({
    amountRaw,
    available: availableForChoice,
    from: dolphinAddress,
    to: ownAddress,
    symbol: asset.symbol,
  });

  const fillMax = async () => {
    try {
      if (choice === "U") {
        if (u) setAmountText(formatTokenAmount(u.raw, u.decimals, u.decimals));
        return;
      }
      if (dolphin.balanceWei === null) return;
      const reserve = await dolphin.readWithdrawReserveWei();
      setAmountText(formatTokenAmount(maxNativeWithdrawal(dolphin.balanceWei, reserve), 18, 18));
    } catch (cause) {
      setStatus({ kind: "error", message: toUserMessage(cause, "Could not work out the maximum. Try again.") });
    }
  };

  const send = async () => {
    if (refusal || amountRaw === null || !ownAddress) return;
    setStatus({ kind: "sending" });
    try {
      const result = await dolphin.withdraw({ asset, amountRaw, to: ownAddress as `0x${string}` });
      setStatus({ kind: "sent", transactionHash: result.transactionHash });
      setAmountText("");
      void queryClient.invalidateQueries({ queryKey: ["dolphin-token-balance", dolphinAddress] });
    } catch (cause) {
      setStatus({ kind: "error", message: toUserMessage(cause, "That withdrawal could not be sent. Try again.") });
    }
  };

  return (
    <div className="mt-3 border-t border-line/70 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-ink">{uText}</p>
        {!open ? (
          <button
            className="text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
            onClick={() => {
              setOpen(true);
              setStatus({ kind: "idle" });
            }}
            type="button"
          >
            Withdraw
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          <div aria-label="What to withdraw" className="flex gap-1.5" role="radiogroup">
            {(["U", "BNB"] as const).map((option) => (
              <button
                aria-checked={choice === option}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  choice === option
                    ? "border-ink bg-ink text-canvas"
                    : "border-line text-ink-soft hover:text-ink"
                }`}
                key={option}
                onClick={() => {
                  setChoice(option);
                  setAmountText("");
                  setStatus({ kind: "idle" });
                }}
                role="radio"
                type="button"
              >
                <span className={choice === option ? "text-canvas" : undefined}>{option}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              aria-label={`Amount of ${asset.symbol} to withdraw`}
              className="min-h-10 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-sm tabular-nums text-ink"
              inputMode="decimal"
              onChange={(event) => {
                setAmountText(event.target.value);
                if (status.kind !== "sending") setStatus({ kind: "idle" });
              }}
              placeholder={`0.0 ${asset.symbol}`}
              value={amountText}
            />
            <button
              className="shrink-0 text-xs font-semibold text-muted hover:text-ink"
              onClick={() => void fillMax()}
              type="button"
            >
              Max
            </button>
          </div>

          <p className="text-xs text-muted">
            {ownAddress ? (
              <>To your wallet <span className="font-mono">{short(ownAddress)}</span></>
            ) : (
              <>
                Withdrawals go to your own wallet.{" "}
                <button
                  className="font-semibold text-ink underline underline-offset-2"
                  onClick={() => void identity.connect()}
                  type="button"
                >
                  Connect it
                </button>
              </>
            )}
            {choice === "BNB" ? " · Max keeps a little BNB back for gas." : null}
          </p>

          {status.kind === "error" ? <p className="wallet-inline-error">{status.message}</p> : null}
          {status.kind === "sent" ? (
            <p className="text-xs text-success">
              Sent.{" "}
              {status.transactionHash ? (
                <a
                  className="underline underline-offset-2"
                  href={`https://bscscan.com/tx/${status.transactionHash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View on BscScan ↗
                </a>
              ) : (
                "It will appear in your wallet shortly."
              )}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              className="wallet-btn"
              disabled={Boolean(refusal) || status.kind === "sending" || dolphin.isBusy}
              onClick={() => void send()}
              type="button"
            >
              {status.kind === "sending" ? "Confirm with passkey…" : `Withdraw ${asset.symbol}`}
            </button>
            <button
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={() => {
                setOpen(false);
                setAmountText("");
                setStatus({ kind: "idle" });
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
          {refusal && amountText.trim().length > 0 && ownAddress ? (
            <p className="text-xs text-muted">{refusal}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
