"use client";

import Image from "next/image";
import Link from "next/link";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="relative flex min-h-[calc(100vh-160px)] items-center justify-center py-12 sm:py-20">
      <ConstellationBg opacity={0.45} />

      <div className="site-frame relative z-10 mx-auto flex w-full max-w-[540px] flex-col items-center text-center">
        {/* Floating 3D Wallet Graphic */}
        <div className="relative mb-6 flex h-60 w-60 items-center justify-center">
          {/* Subtle Ambient Gold Glow */}
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.22)_0%,transparent_70%)] blur-2xl" />

          <div className="float-gentle relative h-52 w-52">
            <Image
              alt="Dolphin Wallet"
              className="object-contain drop-shadow-[0_20px_40px_rgba(245,179,0,0.2)]"
              fill
              priority
              src="/wallet.png"
            />
          </div>
        </div>

        {/* Headline & Psychology Prompt */}
        <div className="reveal-one px-4">
          <h1 className="text-balance text-3xl font-black tracking-tight text-[#111214] sm:text-4xl">
            {wallet.isConnected
              ? "Wallet Connected"
              : "Connect to Hire and Manage"}
          </h1>
          <p className="mt-3 text-pretty text-sm leading-relaxed text-[#6E706B] sm:text-base">
            {wallet.isConnected
              ? "Your address is active on BNB Smart Chain. Manage your agent subscriptions and review session controls."
              : "Your address unlocks registry search, hiring, and non-custodial session controls."}
          </p>
        </div>

        {/* Connected Card or Connect Button */}
        <div className="reveal-two mt-8 w-full max-w-[420px] px-4">
          {wallet.isConnected && wallet.address ? (
            <div className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#F3F0E8] pb-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#1C6A44]" />
                  <span className="text-xs font-bold text-[#1C6A44]">
                    BSC Mainnet (56)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#6E706B]">
                  <BnbLogo size={15} />
                  <span>BNB Chain</span>
                </div>
              </div>

              <div className="py-4">
                <span className="block text-[10px] font-black uppercase tracking-wider text-[#A5A79F]">
                  PUBLIC ADDRESS
                </span>
                <span className="mt-1 block break-all font-mono text-sm font-bold text-[#111214]">
                  {wallet.address}
                </span>
              </div>

              <div className="space-y-3 pt-2">
                <Link
                  className="pressable-scale flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-sm font-black text-[#111214] no-underline shadow-sm hover:bg-[#E2A500]"
                  href="/my-agents"
                >
                  <CategoryGlyph color="#111214" name="bot" size={16} strokeWidth={2.4} />
                  View My Hired Agents
                </Link>

                <button
                  className="pressable-scale flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] px-5 text-xs font-bold text-[#6E706B] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C]"
                  onClick={() => wallet.disconnect()}
                  type="button"
                >
                  Disconnect Wallet
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="w-full">
                <WalletConnectButton connectLabel="Connect Wallet" />
              </div>

              <div className="flex items-center justify-center gap-4 text-xs font-semibold text-[#A5A79F]">
                <span className="flex items-center gap-1.5">
                  <CategoryGlyph color="#1C6A44" name="shield" size={13} strokeWidth={2.5} />
                  100% Non-Custodial
                </span>
                <span>•</span>
                <span>Zero Key Access</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
