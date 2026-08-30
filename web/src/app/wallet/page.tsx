"use client";

import Link from "next/link";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { StatusBadge } from "@/components/status-badge";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * Two wallets, deliberately shown as two things.
 *
 * The Dolphin Wallet (Altana passkey smart account) is the one that can hold a
 * scoped session. The connected browser wallet is the user's existing account
 * and is only ever used to identify them on a hire record. Altana's SDK ships
 * no injected signer, so one genuinely cannot be built on the other - see
 * src/wallet/altana-policy.ts. Presenting them as a single "your wallet" would
 * be the one misunderstanding on this screen that costs someone money.
 */
export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="relative py-10 sm:py-14">
      <ConstellationBg opacity={0.35} />

      <div className="site-frame relative z-10 mx-auto w-full max-w-[640px]">
        <header className="mb-8 text-center">
          <h1 className="text-balance text-3xl font-black tracking-tight text-[#111214] sm:text-4xl">
            Wallet
          </h1>
          <p className="mx-auto mt-3 max-w-[46ch] text-pretty text-sm leading-relaxed text-[#6E706B]">
            Dolphin uses two separate accounts, and it is worth knowing which is
            which: one identifies you, the other is the only one an agent can
            ever be given permission to spend from.
          </p>
        </header>

        {/* --- 1. The Altana wallet: balances, sessions, funding ---------- */}
        <AltanaWalletPanel />

        {/* --- 2. The connected browser wallet ---------------------------- */}
        <section className="mt-4 rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider text-[#6E706B]">
                Your own wallet
              </span>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#111214]">
                Connected browser wallet
              </h2>
            </div>
            <StatusBadge
              label={wallet.isConnected ? "Connected" : "Not connected"}
              tone={wallet.isConnected ? "live" : "neutral"}
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-[#6E706B]">
            MetaMask, Trust Wallet or any WalletConnect wallet. Dolphin reads
            only its public address, and uses it to remember which agents you
            have hired. It is never asked to sign anything, and no agent is ever
            given permission to spend from it.
          </p>

          {wallet.isConnected && wallet.address ? (
            <>
              <div className="mt-5 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#A5A79F]">
                    Public address
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E706B]">
                    <BnbLogo size={14} />
                    <span>BNB Smart Chain · 56</span>
                  </div>
                </div>
                <p className="mt-1.5 break-all font-mono text-sm font-bold text-[#111214]">
                  {wallet.address}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                <Link
                  className="pressable-scale flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-sm font-black text-[#111214] no-underline shadow-sm hover:bg-[#E2A500]"
                  href="/my-agents"
                >
                  <CategoryGlyph color="#111214" name="bot" size={16} strokeWidth={2.4} />
                  View my hired agents
                </Link>

                <button
                  className="pressable-scale flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] px-5 text-xs font-bold text-[#6E706B] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C]"
                  onClick={() => void wallet.disconnect()}
                  type="button"
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <div className="mt-5">
              <WalletConnectButton connectLabel="Connect wallet" />
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#A5A79F]">
          Dolphin never asks for a private key or a seed phrase, and never takes
          custody of either account.
        </p>
      </div>
    </div>
  );
}
