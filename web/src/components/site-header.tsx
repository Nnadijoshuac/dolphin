"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";


import { BnbLogo, BrandMark } from "@/components/brand-mark";
import { SetAndQuestLink } from "@/components/set-and-quest-link";
import { NETWORK_LABEL } from "@/constants/agents";
import { SET_AND_QUEST_URL } from "@/constants/site";
import { MobileStackHeader } from "@/components/mobile-stack-header";
import { MobileMenuButton } from "@/components/mobile-nav";
import { useMyPlaces } from "@/hooks/use-my-places";
import { useWallet } from "@/wallet/wallet-provider";

// Four destinations and the quest (owner, 2026-10-14: seven items, two called "Dolphin", told a newcomer
// nothing). The builder is the Build button; My agents appears once a wallet is connected.
// PancakeSwap's header pattern (campaign/research/ui-refs-2026-10-13/refs-navs.png; owner, 2026-10-14: "the nav
// bar is a mess... a list in two lines, who does that"): logo and a few short links on the LEFT, one wallet
// button on the RIGHT. Wallet and My agents live in the wallet button's menu; the network is in its tooltip
// and the footer. Every label stays on one line.
const navigation = [
  { path: "/live", label: "Live", icon: "trading" as const },
  { path: "/trade", label: "Traders", icon: "trading" as const },
  { path: "/test", label: "Test", icon: "sparkle" as const },
  { path: "/search", label: "Agents", icon: "search" as const },
  { path: "/dolphin?mode=build&new=1", label: "Build", icon: "sparkle" as const },
  { path: SET_AND_QUEST_URL, label: "Set and Quest", icon: "sparkle" as const, quest: true },
] as const;

type Places = ReturnType<typeof useMyPlaces>;
type SubLink = { href: string; label: string; count?: number };

/*
 * What drops down under each item (owner, 2026-10-17: "this is my agent, so for somebody to get to his agent,
 * you have to type it into the URL"). Only the places you HAVE: with nothing hired, built or started, the item
 * stays a plain link with no menu.
 */
function subLinks(path: string, places: Places): SubLink[] {
  const mine: SubLink[] =
    path === "/trade"
      ? [{ href: "/trade#my-traders", label: "Your traders", count: places.traders }]
      : path === "/search"
        ? [{ href: "/my-agents#mine-hired", label: "Agents you hired", count: places.hired }]
        : path.startsWith("/dolphin")
          ? [{ href: "/my-agents#mine-built", label: "Agents you built", count: places.built }]
          : [];
  const present = mine.filter((link) => (link.count ?? 0) > 0);
  if (present.length === 0) return [];
  const first: Record<string, string> = { "/trade": "All traders", "/search": "Browse agents" };
  return [{ href: path, label: first[path] ?? "New agent" }, ...present];
}

const BRAND_HEADER_PATHS = ["/live", "/test", "/docs", "/setups", "/policies", "/whitepaper"];
const BRAND_HEADER_EXACT = ["/trade"];

function isActiveRoute(pathname: string, path: string) {
  if (path === "/") {
    return pathname === "/" || pathname.startsWith("/agent/");
  }

  return pathname.startsWith(path.split("?")[0]);
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function SiteHeader() {
  const pathname = usePathname();
  const wallet = useWallet();
  const places = useMyPlaces();
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
        {/* Live is a full-width trading screen: the bar lines up with it there (owner, 2026-10-18). */}
        <div
          className={`${pathname.startsWith("/live") ? "mx-auto w-full max-w-[2000px] px-4 sm:px-6 xl:px-10" : "site-frame"} flex h-[68px] items-center gap-8`}
        >
          <Link
            aria-label="Dolphin home"
            className="interactive flex shrink-0 items-center gap-2.5 justify-self-start no-underline"
            href="/"
          >
            <BrandMark size={31} />
            <span className="text-lg font-semibold tracking-[-0.035em]">Dolphin</span>
          </Link>

          <nav aria-label="Primary navigation" className="hidden h-full items-center md:flex">
            {navigation.map((item) => {
              const isActive = isActiveRoute(pathname, item.path);

              if ("quest" in item) {
                return <SetAndQuestLink key={item.path} variant="nav" />;
              }

              const links = subLinks(item.path, places);
              if (links.length > 0) {
                return <NavDropdown active={isActive} key={item.path} label={item.label} links={links} path={item.path} />;
              }

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`interactive relative flex h-full items-center whitespace-nowrap px-3 text-[15px] font-medium no-underline ${
                    isActive ? "text-ink" : "text-ink-soft hover:text-ink"
                  }`}
                  href={item.path}
                  key={item.path}
                  prefetch={false}
                >
                  {item.label}
                  {isActive ? (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center">
            {wallet.isConnected && wallet.address ? (
              <WalletMenu address={wallet.address} />
            ) : (
              <button
                aria-busy={wallet.isConnecting}
                className="interactive inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-sm font-semibold text-[#171813] hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                disabled={wallet.isConnecting}
                onClick={() => void wallet.connect()}
                title={`Dolphin runs on ${NETWORK_LABEL}`}
                type="button"
              >
                {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Phones: every top-level page without its own header gets logo + menu (owner, 2026-10-14: /test and
          /trade had no way to navigate). Trader pages get a back arrow instead. */}
      {pathname === "/" || BRAND_HEADER_EXACT.includes(pathname) || BRAND_HEADER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ? (
        <header className="mobile-brand-header">
          <Link href="/" aria-label="Dolphin home">
            <BrandMark size={38} />
            <div><strong>Dolphin</strong></div>
          </Link>
          <MobileMenuButton />
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
      {pathname.startsWith("/trade/") && <MobileStackHeader title="Trader" fallback="/trade" />}
    </>
  );
}

/** A nav item with a menu: hover or focus opens it, the label still goes to the main page, the chevron toggles it. */
function NavDropdown({ active, label, links, path }: { active: boolean; label: string; links: SubLink[]; path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="relative flex h-full items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} ref={ref}>
      <Link
        aria-current={active ? "page" : undefined}
        className={`interactive relative flex h-full items-center whitespace-nowrap pl-3 text-[15px] font-medium no-underline ${
          active ? "text-ink" : "text-ink-soft hover:text-ink"
        }`}
        href={path}
        prefetch={false}
      >
        {label}
        {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" /> : null}
      </Link>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${label} menu`}
        className="interactive flex h-full items-center pl-1 pr-3 text-ink-soft hover:text-ink"
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        <svg aria-hidden className={open ? "rotate-180" : ""} fill="none" height="14" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="14">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="absolute left-0 top-full w-60 overflow-hidden rounded-2xl border border-line bg-paper py-1.5 shadow-xl" role="menu">
          {links.map((link) => (
            <Link
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-ink no-underline hover:bg-paper-muted"
              href={link.href}
              key={link.href}
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              {link.label}
              {link.count ? <span className="text-xs text-muted">{link.count}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The connected wallet as ONE pill on one line - BNB mark, short address - opening a small menu: the places
 * that belong to you (Uniswap and PancakeSwap keep account pages here, not in the main bar).
 */
function WalletMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="interactive inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-paper px-3.5 text-sm font-semibold hover:bg-paper-strong"
        onClick={() => setOpen((was) => !was)}
        title={`${address} on ${NETWORK_LABEL}`}
        type="button"
      >
        <BnbLogo size={16} />
        <span className="font-mono text-[13px]">{shortAddress(address)}</span>
        <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="14">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden rounded-2xl border border-line bg-paper py-1.5 shadow-xl" role="menu">
          <p className="px-4 pt-2 pb-1 text-xs text-muted">{NETWORK_LABEL}</p>
          {[
            { href: "/wallet", label: "Wallet" },
            { href: "/my-agents", label: "My agents" },
            { href: "/trade#my-traders", label: "My traders" },
          ].map((item) => (
            <Link
              className="block px-4 py-2.5 text-sm font-medium text-ink no-underline hover:bg-paper-muted"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
