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
      <header className="site-header sticky top-0 z-50 border-b border-[#ECE8DE] bg-[#FBF9F4]/90 backdrop-blur-xl transition-colors">
        <div className="site-frame flex h-20 items-center justify-between gap-6">
          {/* Logo & Brand Identity */}
          <Link
            aria-label="Dolphin home"
            className="pressable-scale flex shrink-0 items-center gap-3.5 no-underline"
            href="/"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ECE8DE] bg-white shadow-sm">
              <BrandMark size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[17px] font-black tracking-tight text-[#111214]">
                  Dolphin
                </span>
                <span className="rounded-md border border-[#F3E3A6] bg-[#FEF5D6] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#946B00]">
                  ERC-8004
                </span>
              </div>
              <p className="text-[11px] font-medium text-[#6E706B]">
                AI Agent Marketplace on BNB Chain
              </p>
            </div>
          </Link>

          {/* Desktop Nav Links (Warm Gold/Amber Active State - No Black Pill) */}
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1.5 rounded-full border border-[#ECE8DE] bg-white/90 p-1.5 shadow-sm md:flex"
          >
            {navigation.map((item) => {
              const isActive = isActiveRoute(pathname, item.path);
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`pressable-scale flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold no-underline transition-all ${
                    isActive
                      ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00] shadow-sm"
                      : "border border-transparent text-[#6E706B] hover:bg-[#F5F3EB] hover:text-[#111214]"
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
          <div className="flex items-center gap-3">
            {/* Live Network Indicator */}
            <div className="hidden items-center gap-2 rounded-full border border-[#ECE8DE] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#303236] shadow-sm lg:flex">
              <BnbLogo size={16} />
              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#111214]">
                <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                BSC Mainnet
              </span>
            </div>

            {/* Quick Wallet CTA */}
            {wallet.isConnected && wallet.address ? (
              <Link
                className="pressable-scale flex items-center gap-2 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-4 py-2 text-xs font-bold text-[#946B00] no-underline shadow-sm hover:bg-[#FDEBB5]"
                href="/wallet"
              >
                <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                <span className="font-mono">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </span>
              </Link>
            ) : (
              <button
                className="pressable-scale flex items-center gap-2 rounded-full bg-[#F5B300] px-4 py-2 text-xs font-extrabold text-[#111214] shadow-sm hover:bg-[#E2A500]"
                onClick={() => wallet.connect()}
                type="button"
              >
                <CategoryGlyph color="#111214" name="shield" size={13} strokeWidth={2.5} />
                Connect Wallet
              </button>
            )}

            {/* Mobile Hamburger Toggle */}
            <button
              aria-label="Toggle navigation menu"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#ECE8DE] bg-white text-[#111214] md:hidden shadow-sm"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              type="button"
            >
              <CategoryGlyph name={isMobileMenuOpen ? "close" : "menu"} size={18} />
            </button>
          </div>
        </div>

        {/* Mobile Expandable Nav */}
        {isMobileMenuOpen && (
          <nav
            aria-label="Mobile menu"
            className="site-frame border-t border-[#ECE8DE] bg-[#FBF9F4] py-4 md:hidden"
          >
            <div className="grid gap-2">
              {navigation.map((item) => {
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold no-underline ${
                      isActive
                        ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00]"
                        : "bg-white text-[#6E706B] border border-[#ECE8DE]"
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
        )}
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
                Discover, compare, and hire verifiable AI agents on BNB Smart Chain under ERC-8004. Real on-chain data, live protocol integrations, and zero fake metrics.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-3 py-1 text-xs font-semibold text-[#303236]">
                  <BnbLogo size={14} />
                  <span>BNB Chain Official</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-[#BFE0CC] bg-[#DCEFE4] px-3 py-1 text-xs font-bold text-[#1C6A44]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1C6A44]" />
                  <span>100% Non-Custodial</span>
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
                <li>
                  <Link className="hover:text-[#111214] hover:underline" href="/search?category=monitoring">
                    Monitoring & Alerts
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

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[#ECE8DE] pt-8 sm:flex-row text-xs text-[#A5A79F]">
            <p>© 2026 Dolphin. Built for the BNB Chain Smart Money Era Hackathon.</p>
            <p>Fail-closed live data • On-chain verified • No fabricated metrics</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
