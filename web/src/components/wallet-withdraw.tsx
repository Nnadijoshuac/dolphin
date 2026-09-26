"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { BnbLogo, ULogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
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
 * The Dolphin Wallet's two assets, and the way money leaves it. (2026-09-26)
 *
 * Money reached this wallet (deposits, BNB->U swaps, escrow refunds) and could
 * only leave it to pay an agent, and its $U balance was shown nowhere. The
 * card now switches between BNB and U with the token's own logo (see
 * AgentWalletCard), and Withdraw opens this dialog: amount, Max, Send. The
 * destination is the person's own connected wallet, always; there is no
 * address field. See wallet/withdraw-policy.ts for why.
 */

export type WalletAsset = "BNB" | "U";

export const U_TOKEN = DOLPHIN_CONTRACTS.find((contract) => contract.label === "Payment token (U)")!.address;

export function AssetLogo({ asset, size = 14 }: { asset: WalletAsset; size?: number }) {
  return asset === "U" ? <ULogo size={size} /> : <BnbLogo size={size} />;
}

/** The Dolphin Wallet's live U holding. Unreadable reads as an error, never zero. */
export function useDolphinUBalance() {
  const dolphin = useAltanaWallet();
  const address = dolphin.status === "connected" ? dolphin.address : null;
  return useQuery({
    queryKey: ["dolphin-token-balance", address, U_TOKEN],
    queryFn: () => dolphin.readTokenBalance(U_TOKEN),
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; transactionHash: string | null }
  | { kind: "error"; message: string };

export function WithdrawDialog({
  initialAsset,
  onClose,
}: {
  initialAsset: WalletAsset;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dolphin = useAltanaWallet();
  const identity = useWallet();
  const queryClient = useQueryClient();
  const uBalance = useDolphinUBalance();

  const [assetChoice, setAssetChoice] = useState<WalletAsset>(initialAsset);
  const [amountText, setAmountText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // After showModal, for the reason ReceiveSheet gives: the dialog's own
    // focusing steps would otherwise override an autoFocus prop.
    inputRef.current?.focus();
  }, []);

  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;
  const ownAddress = identity.isConnected ? identity.address : null;
  const u = uBalance.data ?? null;

  const asset: WithdrawAsset =
    assetChoice === "BNB"
      ? { kind: "native", symbol: "BNB", decimals: 18 }
      : { kind: "token", token: U_TOKEN, symbol: u?.symbol ?? "U", decimals: u?.decimals ?? 18 };

  const held = assetChoice === "U" ? u?.raw ?? null : dolphin.balanceWei;
  const heldText =
    held === null
      ? "…"
      : `${formatTokenAmount(held, asset.decimals)} ${asset.symbol}`;

  const amountRaw = parseWithdrawAmount(amountText, asset.decimals);
  const refusal = withdrawRefusal({
    amountRaw,
    available: held,
    from: dolphinAddress,
    to: ownAddress,
    symbol: asset.symbol,
  });

  const fillMax = async () => {
    try {
      if (assetChoice === "U") {
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
      const result = await dolphin.withdraw({
        asset,
        amountRaw,
        to: ownAddress as `0x${string}`,
      });
      setStatus({ kind: "sent", transactionHash: result.transactionHash });
      setAmountText("");
      void queryClient.invalidateQueries({ queryKey: ["dolphin-token-balance", dolphinAddress] });
    } catch (cause) {
      setStatus({ kind: "error", message: toUserMessage(cause, "That withdrawal could not be sent. Try again.") });
    }
  };

  return (
    <dialog
      aria-label={`Withdraw ${asset.symbol}`}
      className="receive-sheet"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      onClose={onClose}
      ref={ref}
    >
      <div className="receive-sheet__panel">
        <header className="receive-sheet__head">
          <p className="receive-sheet__title">Withdraw</p>
          <button
            aria-label="Close"
            className="receive-sheet__close interactive"
            onClick={onClose}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="close" size={15} strokeWidth={2} />
          </button>
        </header>

        {status.kind === "sent" ? (
          <div className="mt-6 text-center">
            <p className="text-base font-semibold text-ink">Sent to your wallet</p>
            {status.transactionHash ? (
              <a
                className="mt-2 inline-block text-sm text-muted underline underline-offset-4 hover:text-ink"
                href={`https://bscscan.com/tx/${status.transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                View on BscScan ↗
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted">It will show in your wallet shortly.</p>
            )}
            <button className="wallet-btn wallet-btn--ghost mt-6" onClick={onClose} type="button">
              Done
            </button>
          </div>
        ) : (
          <>
            <div aria-label="Asset" className="mt-5 flex gap-2" role="radiogroup">
              {(["U", "BNB"] as const).map((option) => (
                <button
                  aria-checked={assetChoice === option}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    assetChoice === option ? "border-ink text-ink" : "border-line text-muted hover:text-ink"
                  }`}
                  key={option}
                  onClick={() => {
                    setAssetChoice(option);
                    setAmountText("");
                    setStatus({ kind: "idle" });
                  }}
                  role="radio"
                  type="button"
                >
                  <AssetLogo asset={option} size={16} />
                  {option}
                </button>
              ))}
            </div>

            <label className="mt-4 block">
              <span className="flex items-baseline justify-between text-xs text-muted">
                <span>Amount</span>
                <span className="tabular-nums">Available {heldText}</span>
              </span>
              <span className="mt-1.5 flex items-center rounded-xl border border-line bg-paper pr-1.5 focus-within:border-ink">
                <input
                  className="min-h-12 w-full min-w-0 bg-transparent px-3 text-lg tabular-nums text-ink outline-none"
                  inputMode="decimal"
                  onChange={(event) => {
                    setAmountText(event.target.value);
                    if (status.kind === "error") setStatus({ kind: "idle" });
                  }}
                  placeholder="0.0"
                  ref={inputRef}
                  value={amountText}
                />
                <button
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-paper-muted"
                  onClick={() => void fillMax()}
                  type="button"
                >
                  Max
                </button>
              </span>
            </label>

            <p className="mt-3 text-xs text-muted">
              {ownAddress ? (
                <>
                  To your wallet <span className="font-mono text-ink">{short(ownAddress)}</span>
                </>
              ) : (
                <>
                  Withdrawals go only to your own wallet.{" "}
                  <button
                    className="font-semibold text-ink underline underline-offset-2"
                    onClick={() => void identity.connect()}
                    type="button"
                  >
                    Connect it
                  </button>
                </>
              )}
            </p>

            {status.kind === "error" ? (
              <p className="wallet-inline-error mt-3">{status.message}</p>
            ) : refusal && amountText.trim().length > 0 && ownAddress ? (
              <p className="mt-3 text-xs text-muted">{refusal}</p>
            ) : null}

            <button
              className="wallet-btn wallet-btn--accent mt-5"
              disabled={Boolean(refusal) || status.kind === "sending" || dolphin.isBusy}
              onClick={() => void send()}
              type="button"
            >
              {status.kind === "sending" ? "Confirm with passkey…" : "Send"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
