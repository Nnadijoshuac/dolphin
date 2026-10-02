"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { WalletAvatar } from "@/components/wallet-avatar";
import { SET_AND_QUEST_URL } from "@/constants/site";
import { useAppStore } from "@/store/use-app-store";
import { ALTANA_NETWORK_LABEL, formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * THE PHONE'S NAVIGATION — a menu button and a full-screen menu.
 *
 * ===========================================================================
 * WHAT THIS REPLACED
 * ===========================================================================
 * A five-slot bottom tab bar ("mobile-sculpted-nav"): a hand-drawn SVG cage
 * with four gradients, a sliding jelly pill, a raised centre orb and a
 * visualViewport listener to hide it when the keyboard opened. It reserved
 * ~120px of permanent bottom padding on every page, competed with the phone's
 * own home indicator, and pinned the product to exactly five destinations.
 *
 * A full-screen menu holds as many destinations as the product grows to and costs one
 * tap. It also has room for a line of explanation per item, which five icons
 * with one word each never did.
 *
 * ===========================================================================
 * WHY THE BUTTON AND THE MENU ARE SEPARATE EXPORTS
 * ===========================================================================
 * Every mobile screen already has its own header row — Discover's title line,
 * the wallet's avatar strip, the search field. Adding a second global bar on
 * top of those would stack two pieces of chrome above every page.
 *
 * So the MENU mounts once, in AppFrame, and the BUTTON is dropped into the
 * header each screen already has. They talk over a CustomEvent rather than
 * through a store or a context: the only state is "open", nothing needs to
 * read it, and a provider wrapping the whole tree to carry one boolean would
 * be more machinery than the problem.
 * ===========================================================================
 */

const OPEN_EVENT = "dolphin:mobile-menu-open";

const DESTINATIONS: ReadonlyArray<{
  path: string;
  label: string;
  /** "brand" is the Dolphin mark itself; it had the same sparkle as Set and Quest. */
  icon: GlyphName | "brand";
  hint: string;
}> = [
  { path: "/", label: "Discover", icon: "discover", hint: "Browse the live catalog" },
  { path: "/search", label: "Search", icon: "search", hint: "Find an agent by skill" },
  { path: "/dolphin", label: "Dolphin", icon: "brand", hint: "Ask about any agent" },
  { path: "/my-agents", label: "My agents", icon: "agents", hint: "Hires and saved setups" },
  { path: "/wallet", label: "Wallet", icon: "wallet", hint: "Balances, history, assets" },
];

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * WHO YOU ARE, FIRST (2026-10-02, owner: the menu "is an eyesore"). The old
 * menu's only account control was a full-width Connect button stranded at the
 * bottom. This card names the Dolphin Wallet with its balance and the
 * connected wallet, and is where Connect lives when nothing is connected.
 */
function AccountCard({ onNavigate }: { onNavigate: () => void }) {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const hidden = useAppStore((s) => s.hideBalances);
  const identityAddress = identity.isConnected ? identity.address ?? null : null;
  const dolphinAddress = dolphin.status === "connected" ? dolphin.address : null;
  const balance =
    dolphin.balanceWei !== null && !dolphin.balanceError
      ? hidden
        ? "••••"
        : `${formatBnb(dolphin.balanceWei)} BNB`
      : dolphin.isReadingBalance
        ? "Reading…"
        : "Unavailable";

  return (
    <section aria-label="Your account" className="mm-account">
      <Link className="mm-account__main" href="/wallet" onClick={onNavigate}>
        {dolphinAddress ? (
          <WalletAvatar address={dolphinAddress} kind="bot" radius={12} size={42} />
        ) : (
          <span className="mm-tile"><CategoryGlyph color="currentColor" name="bot" size={20} /></span>
        )}
        <span className="mm-account__text">
          <span className="mm-account__name">Dolphin Wallet</span>
          <span className="mm-account__value">
            {dolphinAddress ? balance : dolphin.status === "unsupported" ? "Not available on this browser" : "Not set up yet"}
          </span>
        </span>
        <CategoryGlyph color="currentColor" name="chevron-right" size={16} strokeWidth={2} />
      </Link>
      <div className="mm-account__foot">
        {identityAddress ? (
          <>
            <WalletAvatar address={identityAddress} kind="human" radius={8} size={24} />
            <span className="mm-account__addr">{short(identityAddress)}</span>
            <span className="mm-account__status">
              <span aria-hidden="true" className="mm-dot" />
              Connected
            </span>
          </>
        ) : (
          <WalletConnectButton connectLabel="Connect wallet" />
        )}
      </div>
    </section>
  );
}

function isActiveRoute(pathname: string, path: string) {
  if (path === "/") return pathname === "/" || pathname.startsWith("/agent/");
  return pathname.startsWith(path);
}

/**
 * The trigger. Rendered inside whichever header a mobile screen already has,
 * so it inherits that row's alignment instead of introducing another one.
 */
export function MobileMenuButton({ className = "mobile-circle" }: { className?: string }) {
  return (
    <button
      aria-controls="mobile-menu"
      aria-haspopup="dialog"
      aria-label="Open menu"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      type="button"
    >
      <CategoryGlyph color="currentColor" name="menu" size={20} strokeWidth={2} />
    </button>
  );
}

/**
 * The menu. Mounted once.
 *
 * Native <dialog> for the same four reasons as everywhere else in this
 * codebase: Escape-to-close, focus containment, an inert background and the
 * top layer, all of which hand-built drawers get wrong. The only thing added
 * is closing on navigation — a menu that survives the route change it caused
 * leaves the user looking at a new page through a menu they cannot click past,
 * because <dialog> has made that page inert.
 */
export function MobileNavDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | null>(null);

  function closeMenu() {
    const element = dialog.current;
    if (!element?.open || element.dataset.closing === "true") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.close();
      return;
    }

    element.dataset.closing = "true";
    closeTimer.current = window.setTimeout(() => element.close(), 360);
  }

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-label="Menu"
      className="mobile-menu"
      id="mobile-menu"
      onCancel={(event) => {
        event.preventDefault();
        closeMenu();
      }}
      onClick={(event) => {
        // The <dialog> element is itself the backdrop's hit target, so a click
        // whose target IS the dialog came from outside the panel within it.
        if (event.target === dialog.current) closeMenu();
      }}
      onClose={() => {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
        if (dialog.current) delete dialog.current.dataset.closing;
        setOpen(false);
      }}
      ref={dialog}
    >
      <div className="mobile-menu__panel">
        <div className="mm-head">
          <Link aria-label="Dolphin home" className="mm-brand" href="/" onClick={closeMenu}>
            <BrandMark size={26} />
            <span>Dolphin</span>
          </Link>
          <button aria-label="Close menu" className="mm-close" onClick={closeMenu} type="button">
            <CategoryGlyph color="currentColor" name="close" size={18} strokeWidth={2} />
          </button>
        </div>

        <AccountCard onNavigate={closeMenu} />

        {/* The campaign, as a banner rather than a gold row between two rules. */}
        <Link
          aria-current={pathname.startsWith(SET_AND_QUEST_URL) ? "page" : undefined}
          className="mm-quest"
          href={SET_AND_QUEST_URL}
          onClick={closeMenu}
        >
          <span aria-hidden="true" className="mm-quest__icon">
            <CategoryGlyph color="currentColor" name="sparkle" size={20} strokeWidth={2} />
          </span>
          <span className="mm-quest__text">
            <span className="mm-quest__title">Set and Quest</span>
            <span className="mm-quest__hint">Your campaign progress</span>
          </span>
          <CategoryGlyph color="currentColor" name="chevron-right" size={16} strokeWidth={2} />
        </Link>

        <nav aria-label="Primary">
          <p className="mm-label">Menu</p>
          <ul className="mm-list">
            {DESTINATIONS.map((item) => {
              const active = isActiveRoute(pathname, item.path);
              return (
                <li key={item.path}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`mm-item${active ? " mm-item--active" : ""}`}
                    href={item.path}
                    /*
                     * Closed on the CLICK, not on a pathname effect. Watching
                     * the route and calling setState in an effect is rejected
                     * outright by this repo's react-hooks rules, and it was
                     * the worse design anyway: the click is the actual event,
                     * and reacting to its downstream consequence means the
                     * drawer is briefly open over the page it just opened.
                     */
                    onClick={closeMenu}
                  >
                    <span aria-hidden="true" className="mm-tile">
                      {item.icon === "brand" ? (
                        <BrandMark size={20} />
                      ) : (
                        <CategoryGlyph color="currentColor" name={item.icon} size={19} strokeWidth={active ? 2.1 : 1.8} />
                      )}
                    </span>
                    <span className="mm-item__text">
                      <span className="mm-item__label">{item.label}</span>
                      <span className="mm-item__hint">{item.hint}</span>
                    </span>
                    <CategoryGlyph color="currentColor" name="chevron-right" size={15} strokeWidth={2} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <p className="mm-foot">
          <span aria-hidden="true" className="mm-dot" />
          {ALTANA_NETWORK_LABEL} · Mainnet
        </p>
      </div>
    </dialog>
  );
}
