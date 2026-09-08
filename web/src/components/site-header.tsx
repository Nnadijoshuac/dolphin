"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { BnbBadge, BnbLogo, BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
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
  { path: "/wallet", label: "Wallet", icon: "wallet" as const },
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
  const mobileNav = useRef<HTMLElement>(null);
  const isTabPage = navigation.some((item) => item.path === pathname);
  const activeIndex = navigation.findIndex((item) => isActiveRoute(pathname, item.path));

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const editing = document.activeElement?.matches("input, textarea, [contenteditable='true']");
      const keyboardOpen = editing && window.innerHeight - viewport.height > 120;
      mobileNav.current?.toggleAttribute("data-keyboard-open", Boolean(keyboardOpen));
    };
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  return (
    <>
      <header className="desktop-site-header sticky top-0 z-50 border-b border-line bg-canvas/92 backdrop-blur-xl">
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

      {pathname === "/" ? (
        <header className="mobile-brand-header">
          <Link href="/" aria-label="Dolphin home">
            <BrandMark size={38} />
            <div><strong>Dolphin</strong><p>ERC-8004 AI agent marketplace</p><BnbBadge /></div>
          </Link>
        </header>
      ) : null}

      {isTabPage ? (
        <nav
          aria-label="Mobile navigation"
          className="mobile-tab-bar"
          ref={mobileNav}
        >
          <div className="mobile-sculpted-nav">
            {/* The exact 3-lobed metaball SVG background with continuous curvature & deep obsidian pearl material */}
            <svg
              aria-hidden="true"
              className="mobile-sculpted-nav__bg"
              fill="none"
              shapeRendering="geometricPrecision"
              viewBox="0 0 350 64"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Deep pitch-black obsidian pearl base */}
                <linearGradient id="pearl-base" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0a0a0c" />
                  <stop offset="25%" stopColor="#040405" />
                  <stop offset="75%" stopColor="#000000" />
                  <stop offset="100%" stopColor="#060608" />
                </linearGradient>

                {/* Subtle rim highlight */}
                <linearGradient id="pearl-rim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.16)" />
                  <stop offset="20%" stopColor="rgba(255, 231, 255, 0.08)" />
                  <stop offset="80%" stopColor="rgba(0, 0, 0, 0.8)" />
                  <stop offset="100%" stopColor="rgba(255, 231, 255, 0.1)" />
                </linearGradient>

                {/* Delicate specular gloss sheen */}
                <linearGradient id="pearl-gloss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.1)" />
                  <stop offset="35%" stopColor="rgba(255, 231, 255, 0.03)" />
                  <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
                </linearGradient>
              </defs>

              {/* Base Pearl Body */}
              <path
                d="M 27,5 L 120,5 C 133.00,5.00 144.44,21.59 149.61,14.23 A 31.0 31.0 0 0 1 200.39 14.23 C 205.56,21.59 217.00,5.00 230.00,5.00 L 323,5 C 338,5 348,16 348,32 C 348,48 338,59 323,59 L 230.00,59 C 217.00,59.00 205.56,42.41 200.39,49.77 A 31.0 31.0 0 0 1 149.61 49.77 C 144.44,42.41 133.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
                fill="url(#pearl-base)"
                stroke="url(#pearl-rim)"
                strokeWidth="1.2"
              />

              {/* Specular gloss sheen overlay on upper half */}
              <path
                d="M 27,5 L 120,5 C 133.00,5.00 144.44,21.59 149.61,14.23 A 31.0 31.0 0 0 1 200.39 14.23 C 205.56,21.59 217.00,5.00 230.00,5.00 L 323,5 C 338,5 348,16 348,32 C 348,48 338,59 323,59 L 230.00,59 C 217.00,59.00 205.56,42.41 200.39,49.77 A 31.0 31.0 0 0 1 149.61 49.77 C 144.44,42.41 133.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
                fill="url(#pearl-gloss)"
                opacity="0.4"
              />
            </svg>

            {/* Sliding Nano Jelly Pill — percentage-based so it scales with container */}
            {activeIndex !== -1 && (
              <div
                className="mobile-sculpted-nav__jelly-pill"
                style={{
                  left: `calc(${activeIndex * 20 + 10}% - 24px)`,
                }}
              >
                <div
                  className="mobile-sculpted-nav__jelly-inner"
                  key={activeIndex}
                />
              </div>
            )}

            {/* Relative 5-Slot Navigation Track */}
            <div className="mobile-sculpted-nav__track">
              {navigation.map((item) => {
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    className="mobile-sculpted-nav__slot"
                    href={item.path}
                    key={item.path}
                  >
                    <span
                      className={`mobile-sculpted-nav__bubble ${
                        isActive ? "mobile-sculpted-nav__bubble--active" : ""
                      }`}
                    >
                      {item.path === "/dolphin" ? (
                        <BrandMark
                          color={isActive ? "#080808" : "#FFE7FF"}
                          size={26}
                        />
                      ) : (
                        <CategoryGlyph
                          color={isActive ? "#080808" : "#FFE7FF"}
                          name={item.icon}
                          size={21}
                          strokeWidth={isActive ? 2.3 : 1.9}
                        />
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      ) : null}
      {pathname.startsWith("/manage/") && <MobileStackHeader title="Manage agent" fallback="/my-agents" />}
    </>
  );
}
