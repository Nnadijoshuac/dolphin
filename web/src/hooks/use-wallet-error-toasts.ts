"use client";

import { useEffect } from "react";

import { toast } from "@/store/use-toast-store";
import { useAltanaWallet } from "@/wallet/altana-provider";

/**
 * Shows the Dolphin Wallet's errors as toasts. (2026-09-26)
 *
 * The provider records the last failure as `error` (create, recover, register,
 * refund, withdraw, pay). The desktop wallet printed it inline in red; the
 * phone wallet printed it nowhere, so a failed action there gave no feedback
 * at all. Both layouts call this instead. It fires on each NEW message: the
 * provider clears `error` at the start of every action, so a repeat of the
 * same failure is a change and toasts again.
 */
export function useWalletErrorToasts() {
  const { error } = useAltanaWallet();
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
}
