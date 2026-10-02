"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";


import { BnbBadge, BnbLogo, BrandMark } from "@/components/brand-mark";
import { SetAndQuestLink } from "@/components/set-and-quest-link";
import { NETWORK_LABEL } from "@/constants/agents";
import { SET_AND_QUEST_URL } from "@/constants/site";
import { MobileStackHeader } from "@/components/mobile-stack-header";
import { useWallet } from "@/wallet/wallet-provider";

const navigation = [
  { path: "/", label: "Discover", icon: "discover" as const },
  { path: "/search", label: "Search", icon: "search" as const },
  // Third of five, matching the mobile tab order, where Dolphin is the raised
  // centre action. The centre-orb treatment itself is a tab-bar idiom and does
  // not carry over to a web header - same feature, same backend, different
  // front door. See Agent/DOLPHIN-AGENT-SCOPE.md §6.
  { path: "/dolphin", label: "Dolphin", icon: "sparkle" as const },
  { path: "/my-agents", label: "My Agents", icon: "agents" as const },
  { path: SET_AND_QUEST_URL, label: "Set and Quest", icon: "sparkle" as const, quest: true },
  { path: "/wallet", label: "Wallet", icon: "wallet" as const },
] as const;

const [networkName, networkEnvironment] = NETWORK_LABEL.split(" · ");

function isActiveRoute(pathname: string, path: string) {
  if (path === "/") {
    return pathname === "/" || pathname.startsWith("/agent/");
  }

  return pathname.startsWith(path);
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function SiteHeader() {
  const pathname = usePathname();
  const wallet = useWallet();
  const isDolphinPath = pathname === "/dolphin" || pathname.startsWith("/dolphin/");

  /*
   * The visualViewport listener that lived here is gone with the tab bar. Its
   * only job was toggling `data-keyboard-open` so a floating bottom bar got
   * out of the way of the on-screen keyboard. Nothing floats now.
   */

  if (isDolphinPath) {
    return null;
  }

  return (
    <>
      <header className="desktop-site-header sticky top-0 z-50 border-b border-line bg-canvas/92 backdrop-blur-xl">
        <div className="site-frame grid h-[72px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5">
          <Link
            aria-label="Dolphin home"
            className="interactive flex shrink-0 items-center gap-2.5 justify-self-start no-underline"
            href="/"
          >
            <BrandMark size={31} />
            <span className="text-lg font-semibold tracking-[-0.035em]">Dolphin</span>
          </Link>

          <nav aria-label="Primary navigation" className="hidden h-full items-center justify-self-center md:flex">
            {navigation.map((item) => {
              const isActive = isActiveRoute(pathname, item.path);

              if ("quest" in item) {
                return <SetAndQuestLink key={item.path} variant="nav" />;
              }

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`interactive relative flex h-full items-center whitespace-nowrap px-2 text-sm font-medium no-underline xl:px-4 ${
                    isActive ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                  href={item.path}
                  key={item.path}
                >
                  {item.label}
                  {isActive ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent xl:inset-x-4" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-4 justify-self-end">
            {/* The network, in full. Set and Earn counts "not stated on the page" against a
                marketplace, and "BNB Chain" alone does not say mainnet or testnet. */}
            <div className="hidden items-center gap-2.5 text-muted xl:flex">
              <BnbLogo size={15} />
              <span className="grid gap-0.5 whitespace-nowrap leading-none">
                <strong className="text-[0.68rem] font-semibold text-ink-soft">{networkName}</strong>
                <small className="text-[0.6rem] font-medium text-faint">{networkEnvironment}</small>
              </span>
            </div>

            {wallet.isConnected && wallet.address ? (
              <Link
                className="interactive inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-paper px-3 text-xs font-semibold no-underline hover:bg-paper-strong"
                href="/wallet"
                title={wallet.address}
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
                <span className="font-mono">{shortAddress(wallet.address)}</span>
              </Link>
            ) : (
              <button
                aria-busy={wallet.isConnecting}
                className="interactive min-h-10 rounded-xl bg-accent px-4 text-xs font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                disabled={wallet.isConnecting}
                onClick={() => void wallet.connect()}
                type="button"
              >
                {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      {pathname === "/" ? (
        <header className="mobile-brand-header">
          <Link href="/" aria-label="Dolphin home">
            <BrandMark size={38} />
            <div><strong>Dolphin</strong><p>ERC-8004 AI agent marketplace</p><BnbBadge /></div>
          </Link>
        </header>
      ) : null}

      {/*
       * THE BOTTOM TAB BAR IS GONE (2026-09-12), replaced by the menu drawer
       * in components/mobile-nav.tsx.
       *
       * It was a hand-drawn SVG cage with four gradients, a sliding jelly
       * pill, a raised centre orb and a visualViewport listener to hide itself
       * when the keyboard opened — and it reserved ~120px of permanent bottom
       * padding on every page while pinning the product to exactly five
       * destinations. The drawer costs one tap, holds as many destinations as
       * the product grows to, and gives each a label and a line of
       * explanation, which five one-word icons never did.
       */}
      {pathname.startsWith("/manage/") && <MobileStackHeader title="Manage agent" fallback="/my-agents" />}
    </>
  );
}
