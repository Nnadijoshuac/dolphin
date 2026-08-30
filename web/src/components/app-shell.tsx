"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { BnbLogo, BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { useWallet } from "@/wallet/wallet-provider";

const navigation = [
  { path: "/", label: "Discover", icon: "sparkle" as const },
  { path: "/search", label: "Search", icon: "search" as const },
  { path: "/my-agents", label: "My Agents", icon: "bot" as const },
  { path: "/wallet", label: "Wallet", icon: "shield" as const },
] as const;

function isActiveRoute(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet = useWallet();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#FBF9F4] text-[#111214]">
      <a
        className="fixed left-5 top-4 z-[70] -translate-y-24 rounded-xl bg-[#111214] px-4 py-2 text-sm font-bold text-[#FBF9F4] transition-transform focus:translate-y-0 shadow-lg"
        href="#main-content"
      >
        Skip to content
      </a>

      {/* Primary Sticky Header */}
      <header className="site-header sticky top-0 z-50 border-b border-[#DDE1DD] bg-[#F8F9F7]/92 backdrop-blur-xl transition-colors">
        <div className="site-frame flex h-20 items-center justify-between gap-2 sm:gap-4">
          {/* Logo & Brand Identity */}
          <Link
            aria-label="Dolphin home"
            className="pressable-scale flex min-w-0 shrink items-center gap-2.5 no-underline sm:gap-3"
            href="/"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#ECE8DE] bg-white shadow-sm sm:h-11 sm:w-11">
              <BrandMark size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[17px] font-black tracking-tight text-[#111214]">
                  Dolphin
                </span>
                <span className="hidden rounded-md border border-[#F3E3A6] bg-[#FEF5D6] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#946B00] sm:inline-flex">
                  ERC-8004
                </span>
              </div>
              <p className="hidden text-[11px] font-medium text-[#6E706B] xl:block">
                AI Agent Marketplace on BNB Chain
              </p>
            </div>
          </Link>

          {/* Desktop navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden h-full items-center gap-7 lg:flex"
          >
            {navigation.map((item) => {
              const isActive = isActiveRoute(pathname, item.path);
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`pressable-scale flex h-full items-center gap-2 border-b-2 px-0.5 text-[13px] font-semibold no-underline transition-colors ${
                    isActive
                      ? "border-[#D9A900] text-[#171A17]"
                      : "border-transparent text-[#646A65] hover:border-[#D7DAD7] hover:text-[#171A17]"
                  }`}
                  href={item.path}
                  key={item.path}
                >
                  <CategoryGlyph
                    color={isActive ? "#946B00" : "currentColor"}
                    name={item.icon}
                    size={14}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right Network & Wallet Connect Button */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Live Network Indicator */}
            <div className="hidden items-center gap-2 text-xs font-semibold text-[#303236] xl:flex">
              <BnbLogo size={16} />
              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#111214]">
                <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                BSC Mainnet
              </span>
            </div>

            {/* Quick Wallet CTA */}
            {wallet.isConnected && wallet.address ? (
              <Link
                aria-label={`Connected wallet ${wallet.address.slice(0, 6)} through ${wallet.address.slice(-4)}`}
                className="pressable-scale flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#E6D58B] bg-[#FFF7D6] px-3 text-xs font-semibold text-[#715600] no-underline hover:bg-[#FBECAE] sm:px-4"
                href="/wallet"
              >
                <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                <span className="hidden font-mono sm:inline">
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </span>
              </Link>
            ) : (
              <button
                aria-label="Connect wallet"
                className="pressable-scale flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-xl bg-[#F4C51A] px-3 text-xs font-semibold text-[#111411] shadow-sm hover:bg-[#EAB914] sm:px-4"
                onClick={() => wallet.connect()}
                type="button"
              >
                <CategoryGlyph color="#111214" name="shield" size={13} strokeWidth={2.5} />
                <span className="hidden sm:inline">Connect Wallet</span>
              </button>
            )}

            {/* Mobile Hamburger Toggle */}
            <button
              aria-controls="mobile-navigation"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#DDE1DD] bg-white text-[#111214] shadow-sm lg:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              type="button"
            >
              <CategoryGlyph name={isMobileMenuOpen ? "close" : "menu"} size={18} />
            </button>
          </div>
        </div>

        {/* Mobile Expandable Nav */}
        {isMobileMenuOpen ? (
          <nav
            aria-label="Mobile menu"
            className="site-frame border-t border-[#ECE8DE] bg-[#FBF9F4] py-3 lg:hidden"
            id="mobile-navigation"
          >
            <div className="grid divide-y divide-[#E0E3E0] border-y border-[#E0E3E0]">
              {navigation.map((item) => {
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-12 items-center gap-3 px-1 text-sm font-semibold no-underline ${
                      isActive
                        ? "text-[#171A17]"
                        : "text-[#656B66]"
                    }`}
                    href={item.path}
                    key={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <CategoryGlyph
                      color={isActive ? "#946B00" : "currentColor"}
                      name={item.icon}
                      size={16}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : null}
      </header>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1" id="main-content">
        {children}
      </main>

      {/* Master Editorial Footer */}
      <footer className="mt-24 border-t border-[#ECE8DE] bg-white">
        <div className="site-frame py-16">
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
            {/* Column 1: Brand & Hackathon Info */}
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#ECE8DE] bg-[#FBF9F4]">
                  <BrandMark size={24} />
                </div>
                <div>
                  <span className="text-base font-black tracking-tight text-[#111214]">
                    Dolphin Marketplace
                  </span>
                  <p className="text-[11px] font-bold text-[#946B00]">
                    BNB Chain Smart Money Era
                  </p>
                </div>
              </div>

              <p className="mt-4 max-w-md text-sm leading-6 text-[#6E706B]">
                Discover, compare, and hire source-labeled AI agents on BNB Smart Chain under ERC-8004. Missing metrics remain explicitly unavailable until a live source proves them.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-3 py-1 text-xs font-semibold text-[#303236]">
                  <BnbLogo size={14} />
                  <span>BNB Chain catalog</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-[#BFE0CC] bg-[#DCEFE4] px-3 py-1 text-xs font-bold text-[#1C6A44]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1C6A44]" />
                  <span>User-approved access</span>
                </div>
              </div>
            </div>

            {/* Column 2: Graded Categories */}
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#111214]">
                Core Agent Categories
              </h3>
              <ul className="mt-4 space-y-2.5 text-sm font-semibold text-[#6E706B]">
                <li>
                  <Link className="hover:text-[#111214] hover:underline" href="/search?category=rebalancing">
                    Rebalancing (PancakeSwap LP)
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[#111214] hover:underline" href="/search?category=grid-trading">
                    Grid Trading (Price Ladders)
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[#111214] hover:underline" href="/search?category=health-factor">
                    Health Factor (Venus Protocol)
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[#111214] hover:underline" href="/search?category=yield">
                    Yield Optimization (Aave / Lista)
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Trust & Verification Standard */}
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#111214]">
                Standards & Protocols
              </h3>
              <ul className="mt-4 space-y-2.5 text-sm font-semibold text-[#6E706B]">
                <li>
                  <a className="hover:text-[#111214] hover:underline" href="https://8004scan.io" rel="noreferrer" target="_blank">
                    ERC-8004 Agent Standard ↗
                  </a>
                </li>
                <li>
                  <a className="hover:text-[#111214] hover:underline" href="https://bscscan.com" rel="noreferrer" target="_blank">
                    BNB Smart Chain Explorer ↗
                  </a>
                </li>
                <li>
                  <a className="hover:text-[#111214] hover:underline" href="https://venus.io" rel="noreferrer" target="_blank">
                    Venus Protocol Verified Reads ↗
                  </a>
                </li>
                <li>
                  <a className="hover:text-[#111214] hover:underline" href="https://pancakeswap.finance" rel="noreferrer" target="_blank">
                    PancakeSwap V3 Positions ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[#ECE8DE] pt-8 text-xs text-[#6C736D] sm:flex-row">
            <p>© 2026 Dolphin. Built for the BNB Chain Smart Money Era Hackathon.</p>
            <p>Missing data stays unavailable • Registry checks run on agent detail</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
