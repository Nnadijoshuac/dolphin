"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { WalletConnectButton } from "@/wallet/wallet-provider";

/**
 * THE PHONE'S NAVIGATION — a menu button and a drawer.
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
 * A drawer holds as many destinations as the product grows to and costs one
 * tap. It also has room for a line of explanation per item, which five icons
 * with one word each never did.
 *
 * ===========================================================================
 * WHY THE BUTTON AND THE DRAWER ARE SEPARATE EXPORTS
 * ===========================================================================
 * Every mobile screen already has its own header row — Discover's title line,
 * the wallet's avatar strip, the search field. Adding a second global bar on
 * top of those would stack two pieces of chrome above every page.
 *
 * So the DRAWER mounts once, in AppFrame, and the BUTTON is dropped into the
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
  icon: GlyphName;
  hint: string;
}> = [
  { path: "/", label: "Discover", icon: "discover", hint: "Browse the live catalog" },
  { path: "/search", label: "Search", icon: "search", hint: "Find an agent by skill" },
  { path: "/dolphin", label: "Dolphin", icon: "sparkle", hint: "Ask about any agent" },
  { path: "/my-agents", label: "My agents", icon: "agents", hint: "Hires and saved setups" },
  { path: "/wallet", label: "Wallet", icon: "wallet", hint: "Balances and access" },
];

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
 * The drawer. Mounted once.
 *
 * Native <dialog> for the same four reasons as everywhere else in this
 * codebase: Escape-to-close, focus containment, an inert background and the
 * top layer, all of which hand-built drawers get wrong. The only thing added
 * is closing on navigation — a drawer that survives the route change it caused
 * leaves the user looking at a new page through a menu they cannot click past,
 * because <dialog> has made that page inert.
 */
export function MobileNavDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
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
      onCancel={() => setOpen(false)}
      onClick={(event) => {
        // The <dialog> element is itself the backdrop's hit target, so a click
        // whose target IS the dialog came from outside the panel within it.
        if (event.target === dialog.current) setOpen(false);
      }}
      onClose={() => setOpen(false)}
      ref={dialog}
    >
      <div className="mobile-menu__panel">
        <div className="mobile-menu__head">
          <span className="mobile-menu__title">Menu</span>
          <button
            aria-label="Close menu"
            className="mobile-menu__close"
            onClick={() => setOpen(false)}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="close" size={18} strokeWidth={2} />
          </button>
        </div>

        <nav aria-label="Primary">
          <ul className="mobile-menu__list">
            {DESTINATIONS.map((item) => {
              const active = isActiveRoute(pathname, item.path);
              return (
                <li key={item.path}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`mobile-menu__item${active ? " mobile-menu__item--active" : ""}`}
                    href={item.path}
                    /*
                     * Closed on the CLICK, not on a pathname effect. Watching
                     * the route and calling setState in an effect is rejected
                     * outright by this repo's react-hooks rules, and it was
                     * the worse design anyway: the click is the actual event,
                     * and reacting to its downstream consequence means the
                     * drawer is briefly open over the page it just opened.
                     */
                    onClick={() => setOpen(false)}
                  >
                    <span aria-hidden="true" className="mobile-menu__icon">
                      <CategoryGlyph
                        color="currentColor"
                        name={item.icon}
                        size={19}
                        strokeWidth={active ? 2.1 : 1.8}
                      />
                    </span>
                    <span className="mobile-menu__text">
                      <span className="mobile-menu__label">{item.label}</span>
                      <span className="mobile-menu__hint">{item.hint}</span>
                    </span>
                    <CategoryGlyph
                      color="currentColor"
                      name="chevron-right"
                      size={15}
                      strokeWidth={2}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/*
         * Connect lives in the drawer because the screens' own header rows
         * have space for a title and one control, and navigation is what
         * people open a menu for. Same WalletConnectButton as everywhere else,
         * so the two-step disconnect confirm comes with it.
         */}
        <div className="mobile-menu__wallet">
          <WalletConnectButton connectLabel="Connect wallet" />
        </div>
      </div>
    </dialog>
  );
}
