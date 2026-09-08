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
  const TAB_X_POSITIONS = [6, 76, 150, 224, 294] as const;
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
            {/* The exact 3-lobed metaball SVG background with continuous curvature & pearl material */}
            <svg
              aria-hidden="true"
              className="mobile-sculpted-nav__bg"
              fill="none"
              shapeRendering="geometricPrecision"
              viewBox="0 0 348 64"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Pearl base: deep obsidian with metallic/pearl luster */}
                <linearGradient id="pearl-base" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1c1b22" />
                  <stop offset="25%" stopColor="#0a0a0c" />
                  <stop offset="75%" stopColor="#050506" />
                  <stop offset="100%" stopColor="#141318" />
                </linearGradient>

                {/* Pearl rim: luminous top highlight, soft bottom reflection */}
                <linearGradient id="pearl-rim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
                  <stop offset="20%" stopColor="rgba(255, 231, 255, 0.22)" />
                  <stop offset="80%" stopColor="rgba(0, 0, 0, 0.5)" />
                  <stop offset="100%" stopColor="rgba(255, 231, 255, 0.28)" />
                </linearGradient>

                {/* Upper dome specular gloss sheen */}
                <linearGradient id="pearl-gloss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.28)" />
                  <stop offset="40%" stopColor="rgba(255, 231, 255, 0.08)" />
                  <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
                </linearGradient>
              </defs>

              {/* Base Pearl Body */}
              <path
                d="M 27,5 L 120,5 C 132.00,5.00 143.44,21.59 148.61,14.22 A 31.0 31.0 0 0 1 199.39 14.22 C 204.56,21.59 216.00,5.00 228.00,5.00 L 321,5 C 336,5 346,16 346,32 C 346,48 336,59 321,59 L 228.00,59 C 216.00,59.00 204.56,42.41 199.39,49.78 A 31.0 31.0 0 0 1 148.61 49.78 C 143.44,42.41 132.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
                fill="url(#pearl-base)"
                stroke="url(#pearl-rim)"
                strokeWidth="1.2"
              />

              {/* Specular gloss sheen overlay on upper half */}
              <path
                d="M 27,5 L 120,5 C 132.00,5.00 143.44,21.59 148.61,14.22 A 31.0 31.0 0 0 1 199.39 14.22 C 204.56,21.59 216.00,5.00 228.00,5.00 L 321,5 C 336,5 346,16 346,32 C 346,48 336,59 321,59 L 228.00,59 C 216.00,59.00 204.56,42.41 199.39,49.78 A 31.0 31.0 0 0 1 148.61 49.78 C 143.44,42.41 132.00,59.00 120.00,59.00 L 27,59 C 12,59 2,48 2,32 C 2,16 12,5 27,5 Z"
                fill="url(#pearl-gloss)"
                opacity="0.8"
              />
            </svg>

            {/* Sliding Nano Jelly Pill */}
            {activeIndex !== -1 && (
              <div
                className="mobile-sculpted-nav__jelly-pill"
                style={{
                  transform: `translateX(${TAB_X_POSITIONS[activeIndex]}px)`,
                }}
              >
                <div
                  className="mobile-sculpted-nav__jelly-inner"
                  key={activeIndex}
                />
              </div>
            )}

            {/* Left Lobe: Discover & Search */}
            <div className="mobile-sculpted-nav__lobe mobile-sculpted-nav__lobe--left">
              {navigation.slice(0, 2).map((item) => {
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    className="mobile-sculpted-nav__link"
                    href={item.path}
                    key={item.path}
                  >
                    <span
                      className={`mobile-sculpted-nav__bubble ${
                        isActive ? "mobile-sculpted-nav__bubble--active" : ""
                      }`}
                    >
                      <CategoryGlyph
                        color={isActive ? "#080808" : "#FFE7FF"}
                        name={item.icon}
                        size={21}
                        strokeWidth={isActive ? 2.3 : 1.9}
                      />
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Center Lobe: Dolphin */}
            <div className="mobile-sculpted-nav__lobe mobile-sculpted-nav__lobe--center">
              {(() => {
                const item = navigation[2];
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    className="mobile-sculpted-nav__link mobile-sculpted-nav__link--center"
                    href={item.path}
                  >
                    <span
                      className={`mobile-sculpted-nav__bubble ${
                        isActive ? "mobile-sculpted-nav__bubble--active" : ""
                      }`}
                    >
                      <BrandMark
                        color={isActive ? "#080808" : "#FFE7FF"}
                        size={26}
                      />
                    </span>
                  </Link>
                );
              })()}
            </div>

            {/* Right Lobe: My Agents & Wallet */}
            <div className="mobile-sculpted-nav__lobe mobile-sculpted-nav__lobe--right">
              {navigation.slice(3, 5).map((item) => {
                const isActive = isActiveRoute(pathname, item.path);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    className="mobile-sculpted-nav__link"
                    href={item.path}
                    key={item.path}
                  >
                    <span
                      className={`mobile-sculpted-nav__bubble ${
                        isActive ? "mobile-sculpted-nav__bubble--active" : ""
                      }`}
                    >
                      <CategoryGlyph
                        color={isActive ? "#080808" : "#FFE7FF"}
                        name={item.icon}
                        size={21}
                        strokeWidth={isActive ? 2.3 : 1.9}
                      />
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
