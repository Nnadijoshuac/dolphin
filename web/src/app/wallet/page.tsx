"use client";

import Link from "next/link";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="site-frame page-shell">
      <header className="grid gap-10 border-b border-line pb-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.7fr)] lg:items-end">
        <div className="page-intro">
          <p className="eyebrow">Wallet & permissions</p>
          <h1 className="display-title mt-5">Your accounts. Your permissions. Nothing hidden.</h1>
          <p className="body-copy mt-6 max-w-[58ch]">
            See the account that can hold funds, every active agent permission,
            and the public address attached to your hire records.
          </p>
        </div>

        <div className="border-l border-line pl-6 sm:pl-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
            Two accounts · two jobs
          </p>
          <dl className="mt-4 border-t border-line text-sm">
            <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-line py-4">
              <dt className="text-xs font-medium text-faint">01</dt>
              <dd>
                <span className="font-semibold text-ink">Dolphin Wallet</span>
                <span className="mt-1 block leading-6 text-muted">
                  A passkey account that can hold BNB and issue scoped agent sessions.
                </span>
              </dd>
            </div>
            <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-line py-4">
              <dt className="text-xs font-medium text-faint">02</dt>
              <dd>
                <span className="font-semibold text-ink">Identity wallet</span>
                <span className="mt-1 block leading-6 text-muted">
                  Its public address identifies your hire records; agents receive no spend access to it.
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="py-12 sm:py-16">
        <AltanaWalletPanel />
      </div>

      <section className="border-t border-line py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
          <header>
            <p className="eyebrow">Identity wallet</p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-ink">
              Browser connection
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Used only to associate hire records with a public address.
            </p>
          </header>

          <div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      wallet.isConnected ? "bg-success" : "bg-faint"
                    }`}
                  />
                  {wallet.isConnected ? "Connected" : "Not connected"}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  Dolphin reads the address for ownership and hire lookups. This
                  flow does not hand an agent a signer or spending permission.
                </p>
              </div>
              {wallet.isConnected ? (
                <button
                  className="interactive shrink-0 text-sm font-medium text-muted underline-offset-4 hover:text-danger hover:underline"
                  onClick={() => void wallet.disconnect()}
                  type="button"
                >
                  Disconnect
                </button>
              ) : null}
            </div>

            {wallet.isConnected && wallet.address ? (
              <>
                <dl className="mt-6 border-y border-line text-sm">
                  <div className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <dt className="text-muted">Public address</dt>
                    <dd className="break-all font-mono text-xs font-medium text-ink">
                      {wallet.address}
                    </dd>
                  </div>
                  <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <dt className="text-muted">Network</dt>
                    <dd className="flex items-center gap-2 font-medium text-ink">
                      <BnbLogo size={15} />
                      BNB Smart Chain · 56
                    </dd>
                  </div>
                </dl>
                <Link
                  className="interactive mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink no-underline hover:bg-canvas"
                  href="/my-agents"
                >
                  View My agents
                  <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
                </Link>
              </>
            ) : (
              <div className="mt-6 max-w-sm">
                <WalletConnectButton connectLabel="Connect identity wallet" />
              </div>
            )}
          </div>
        </div>
      </section>

      <p className="border-t border-line pt-6 text-xs leading-5 text-faint">
        Dolphin never asks for a private key or seed phrase. Removing a local
        wallet does not revoke an on-chain session; use the permission controls above.
      </p>
    </div>
  );
}
