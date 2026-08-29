"use client";

import Link from "next/link";

import { BnbLogo } from "@/components/brand-mark";
import { StatePanel } from "@/components/state-panel";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

const connectionFacts = [
  {
    title: "Reads one public address",
    body: "Dolphin uses it to associate real backend hire records with this wallet.",
  },
  {
    title: "Requests no wallet authority",
    body: "A read-only hire creates no signature, spending approval, or session key.",
  },
  {
    title: "Sends no transaction",
    body: "The current hire flow writes a Dolphin subscription record, not an onchain execution.",
  },
] as const;

export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="site-frame py-12 sm:py-16 lg:py-20">
      <header className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
        <div className="reveal-one">
          <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent-ink)]">
            WALLET CONNECTION
          </p>
          <h1 className="text-balance mt-4 max-w-2xl text-5xl font-black leading-[0.92] tracking-[-0.065em] text-[var(--ink)] sm:text-7xl">
            Connect with clarity.
          </h1>
        </div>
        <p className="reveal-two max-w-xl text-base leading-7 text-[var(--muted)] lg:justify-self-end">
          Dolphin connects to an injected browser wallet on BNB Smart Chain.
          The current hire flow reads its public address and nothing more.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <section
          aria-labelledby="connection-heading"
          className="rounded-[18px] bg-[var(--dark-card)] p-7 text-white shadow-[var(--shadow-floating)] sm:p-9"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.14em] text-white/45">
                CURRENT CONNECTION
              </p>
              <h2
                className="mt-3 text-2xl font-black tracking-[-0.045em]"
                id="connection-heading"
              >
                {wallet.isConnected ? "Wallet connected" : "No wallet connected"}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-white/60">
              <BnbLogo size={18} />
              BNB Chain
            </div>
          </div>

          {wallet.isConnected && wallet.address ? (
            <dl className="mt-8 border-b border-white/12">
              <div className="border-t border-white/12 py-4">
                <dt className="text-xs text-white/45">Public address</dt>
                <dd className="mt-2 break-all font-mono text-xs font-bold leading-5 text-white">
                  {wallet.address}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-5 border-t border-white/12 py-4">
                <dt className="text-xs text-white/45">Network</dt>
                <dd className="text-right text-sm font-bold">
                  BNB Smart Chain / 56
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-7 border-y border-white/12 py-5">
              <p className="text-sm font-bold text-white">
                {wallet.isAvailable
                  ? "Ready for your browser wallet"
                  : "No injected wallet detected"}
              </p>
              <p className="mt-2 text-xs leading-5 text-white/54">
                {wallet.unavailableReason ??
                  "Connecting will ask the wallet to expose its public address."}
              </p>
            </div>
          )}

          <div className="mt-7">
            <WalletConnectButton />
          </div>

          {wallet.isConnected && (
            <Link
              className="mt-5 inline-flex text-xs font-bold text-[#e9b949]"
              href="/my-agents"
            >
              View this wallet&apos;s agents
            </Link>
          )}
        </section>

        <section aria-labelledby="connection-facts-heading" className="py-3">
          <p className="text-sm font-semibold text-[var(--accent-ink)]">
            Know the boundary
          </p>
          <h2
            className="text-balance mt-3 max-w-xl text-3xl font-black leading-[1] tracking-[-0.05em] text-[var(--ink)] sm:text-4xl"
            id="connection-facts-heading"
          >
            What connecting does, exactly.
          </h2>

          <div className="mt-8 border-b border-[var(--line)]">
            {connectionFacts.map((fact, index) => (
              <article
                className="grid gap-3 border-t border-[var(--line)] py-6 sm:grid-cols-[3rem_1fr]"
                key={fact.title}
              >
                <span className="font-mono text-xs text-[var(--faint)]">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold text-[var(--ink)]">
                    {fact.title}
                  </h3>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
                    {fact.body}
                  </p>
                </div>
              </article>
            ))}
          </div>

          {!wallet.isAvailable && !wallet.isConnected && (
            <div className="mt-8">
              <StatePanel
                body="Install an EIP-1193 browser wallet such as MetaMask, then reload this page. Dolphin will never ask for a private key."
                compact
                state="unavailable"
                title="Browser wallet required"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
