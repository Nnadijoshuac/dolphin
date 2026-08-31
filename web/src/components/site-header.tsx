"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BnbLogo, BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { useWallet } from "@/wallet/wallet-provider";

const navigation = [
  { path: "/", label: "Discover", icon: "sparkle" as const },
  { path: "/search", label: "Search", icon: "search" as const },
  { path: "/my-agents", label: "My agents", icon: "bot" as const },
  { path: "/wallet", label: "Wallet", icon: "shield" as const },
] as const;

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

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-line bg-canvas/92 backdrop-blur-xl">
        <div className="site-frame flex h-[72px] items-center justify-between gap-5">
          <Link
            aria-label="Dolphin home"
            className="interactive flex shrink-0 items-center gap-2.5 no-underline"
            href="/"
          >
            <BrandMark size={31} />
            <span className="text-lg font-semibold tracking-[-0.035em]">Dolphin</span>
          </Link>

          <nav aria-label="Primary navigation" className="hidden h-full items-center md:flex">
            {navigation.map((item) => {
              const isActive = isActiveRoute(pathname, item.path);

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`interactive relative flex h-full items-center px-4 text-sm font-medium no-underline ${
                    isActive ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                  href={item.path}
                  key={item.path}
                >
                  {item.label}
                  {isActive ? (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 bg-accent" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 border-r border-line pr-4 text-xs font-medium text-muted lg:flex">
              <BnbLogo size={15} />
              <span>BNB Chain</span>
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

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="grid h-[68px] grid-cols-4">
          {navigation.map((item) => {
            const isActive = isActiveRoute(pathname, item.path);

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={`interactive relative flex min-w-0 flex-col items-center justify-center gap-1 text-[0.68rem] font-medium no-underline ${
                  isActive ? "text-accent-ink" : "text-muted"
                }`}
                href={item.path}
                key={item.path}
              >
                {isActive ? (
                  <span className="absolute left-1/2 top-0 h-0.5 w-7 -translate-x-1/2 bg-accent" />
                ) : null}
                <CategoryGlyph
                  color="currentColor"
                  name={item.icon}
                  size={19}
                  strokeWidth={isActive ? 2.35 : 2}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
