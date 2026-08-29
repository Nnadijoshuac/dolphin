"use client";

import Link from "next/link";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { StatePanel } from "@/components/state-panel";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

const connectionFacts = [
  {
    title: "100% Non-Custodial Reads",
    body: "Dolphin reads only your public address to link your on-chain agent subscriptions. Your private keys never leave your device.",
    icon: "shield" as const,
  },
  {
    title: "Altana Scoped Sessions",
    body: "When session execution is granted, limits are enforced strictly by on-chain smart contracts (EIP-7702) with daily spend caps.",
    icon: "bot" as const,
  },
  {
    title: "Zero Secret Exfiltration",
    body: "Dolphin will never ask for a seed phrase, private key, or unscoped custody. Every interaction is transparent and verifiable.",
    icon: "sparkle" as const,
  },
] as const;

export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="relative min-h-screen py-10 sm:py-16">
      <ConstellationBg opacity={0.4} />

      <div className="site-frame">
        {/* Header */}
        <header className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1 text-xs font-bold text-[#946B00]">
            <CategoryGlyph color="#946B00" name="shield" size={13} strokeWidth={2.4} />
            <span>WALLET & PERMISSIONS</span>
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-[#111214] sm:text-5xl lg:text-6xl">
            Wallet & Security Boundary
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#6E706B]">
            Connect your browser wallet to manage agent subscriptions on BNB Smart Chain. Full transparency with zero custodial risk.
          </p>
        </header>

        {/* 2 Column Main Grid */}
        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          {/* Left Column: Wallet Connection Card */}
          <section
            aria-labelledby="connection-heading"
            className="rounded-3xl border border-[#ECE8DE] bg-white p-8 shadow-md sm:p-10"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#F3F0E8] pb-6">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#A5A79F]">
                  CONNECTION STATUS
                </span>
                <h2
                  className="mt-1 text-2xl font-black tracking-tight text-[#111214]"
                  id="connection-heading"
                >
                  {wallet.isConnected ? "Wallet Connected" : "No Wallet Connected"}
                </h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-3 py-1.5 text-xs font-bold text-[#303236]">
                <BnbLogo size={16} />
                <span>BNB Chain</span>
              </div>
            </div>

            {wallet.isConnected && wallet.address ? (
              <dl className="mt-6 divide-y divide-[#F3F0E8] border-b border-[#ECE8DE] text-xs">
                <div className="py-3.5">
                  <dt className="font-semibold text-[#6E706B]">Public Address</dt>
                  <dd className="mt-1 break-all font-mono text-sm font-bold text-[#111214]">
                    {wallet.address}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <dt className="font-semibold text-[#6E706B]">Active Network</dt>
                  <dd className="flex items-center gap-1.5 font-bold text-[#1C6A44]">
                    <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                    BNB Smart Chain (56)
                  </dd>
                </div>
                <div className="flex items-center justify-between py-3.5">
                  <dt className="font-semibold text-[#6E706B]">Security Standard</dt>
                  <dd className="font-bold text-[#946B00]">
                    Non-Custodial / EIP-1193
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="mt-6 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-5">
                <p className="text-sm font-bold text-[#111214]">
                  {wallet.isAvailable
                    ? "Injected Web3 Wallet Detected"
                    : "No Injected Wallet Found"}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#6E706B]">
                  {wallet.unavailableReason ??
                    "Connect your wallet to review your active agents and manage on-chain subscriptions."}
                </p>
              </div>
            )}

            <div className="mt-8">
              <WalletConnectButton />
            </div>

            {wallet.isConnected && (
              <div className="mt-6 text-center">
                <Link
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#946B00] hover:underline"
                  href="/my-agents"
                >
                  <span>View this wallet&apos;s active agents</span>
                  <CategoryGlyph color="#946B00" name="arrow-right" size={12} strokeWidth={2.4} />
                </Link>
              </div>
            )}
          </section>

          {/* Right Column: Security Architecture & Boundary Notes */}
          <section aria-labelledby="connection-facts-heading">
            <div className="rounded-3xl border border-[#ECE8DE] bg-white p-8 shadow-sm sm:p-10">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
                TRANSPARENCY GUARANTEE
              </span>
              <h2
                className="mt-1 text-2xl font-black tracking-tight text-[#111214]"
                id="connection-facts-heading"
              >
                Security & Custody Guardrails
              </h2>

              <div className="mt-8 space-y-6">
                {connectionFacts.map((fact) => (
                  <div
                    className="flex items-start gap-4 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-5"
                    key={fact.title}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F3E3A6] bg-[#FEF5D6]">
                      <CategoryGlyph
                        color="#946B00"
                        name={fact.icon}
                        size={18}
                        strokeWidth={2.4}
                      />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-[#111214]">
                        {fact.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[#6E706B]">
                        {fact.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {!wallet.isAvailable && !wallet.isConnected && (
                <div className="mt-8">
                  <StatePanel
                    body="Install MetaMask, Trust Wallet, or another BSC-compatible browser extension to interact with on-chain agent features."
                    compact
                    state="unavailable"
                    title="Browser Extension Recommended"
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
