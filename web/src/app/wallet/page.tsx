"use client";

import { StatePanel } from "@/components/state-panel";
import { Surface } from "@/components/surface";
import { SectionHeading } from "@/components/section-heading";
import { colors } from "@/constants/theme";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * The wallet surface. AppShell has always had a Wallet tab and there was no
 * route behind it, so the link 404'd - visible in the browser as a failed
 * prefetch on every page load.
 */
export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="py-6 pb-24">
      <h1
        className="text-2xl md:text-3xl font-black tracking-tight"
        style={{ color: colors.ink }}
      >
        Wallet
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: colors.muted }}>
        Connect a browser wallet to hire agents on BNB Smart Chain.
      </p>

      <div className="mt-6 max-w-md">
        <WalletConnectButton />
      </div>

      <div className="mt-8">
        <SectionHeading title="Connection" />
        <Surface>
          {wallet.isConnected && wallet.address ? (
            <dl className="space-y-4">
              <div>
                <dt
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: colors.muted }}
                >
                  Address
                </dt>
                <dd
                  className="mt-1 break-all font-mono text-[13px]"
                  style={{ color: colors.ink }}
                >
                  {wallet.address}
                </dd>
              </div>
              <div>
                <dt
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: colors.muted }}
                >
                  Network
                </dt>
                <dd className="mt-1 text-[13px]" style={{ color: colors.ink }}>
                  BNB Smart Chain · 56
                </dd>
              </div>
            </dl>
          ) : (
            <StatePanel
              title={wallet.isAvailable ? "Not connected" : "No wallet detected"}
              body={
                wallet.unavailableReason ??
                "Dolphin never asks for a private key and never requests a signature for a read-only hire."
              }
              state="unavailable"
              compact
            />
          )}
        </Surface>
      </div>

      {/*
        Stated plainly rather than implied. A hire on Dolphin is a read-only
        subscription record in Convex - no signature, no spend cap, no
        transaction - and saying so here is the same claim the price policy
        makes in convex/lib/agentCatalog.ts. Overstating it would be the exact
        kind of unearned assertion AGENTS.md SS5 rules out.
      */}
      <div className="mt-8">
        <SectionHeading title="What connecting does" />
        <Surface>
          <ul
            className="list-disc space-y-2 pl-5 text-[14px] leading-6"
            style={{ color: colors.ink }}
          >
            <li>Reads your public address so a hire can be recorded against it.</li>
            <li>Requests no signature, no spending approval and no session key.</li>
            <li>Sends no transaction — a Dolphin hire is a read-only subscription record.</li>
          </ul>
        </Surface>
      </div>
    </div>
  );
}
