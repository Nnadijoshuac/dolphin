"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CensusMarquee } from "@/components/census-marquee";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Routes that own their full viewport height and must not be followed by a
 * footer.
 *
 * The chat is the case this exists for: its composer is pinned to the bottom of
 * the screen and its transcript scrolls inside itself, so a footer underneath
 * either pushes the composer off-screen or leaves marketing links stranded
 * below a text input nobody has finished typing in. An app screen and a
 * document page want different chrome.
 */
const FULL_HEIGHT_ROUTES = ["/dolphin", "/admin"];

export function isDolphinRoute(pathname: string) {
  return pathname === "/dolphin" || pathname.startsWith("/dolphin/");
}

export function isStandaloneRoute(pathname: string) {
  return (
    isDolphinRoute(pathname) ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isFullHeight = FULL_HEIGHT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <div className="app-frame flex min-h-screen flex-col bg-canvas text-ink">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {/*
       * The census ticker rides directly under the navbar on every route that
       * has one, because it is a claim about the whole product rather than
       * about one page.
       *
       * Deliberately NOT on /dolphin or /admin: both are full-height app
       * screens that own their viewport, and a scrolling strip above a pinned
       * chat composer is chrome competing with a workspace.
       *
       * It renders nothing when the numbers cannot be read, so a deployment
       * without Convex looks exactly as it did before rather than reserving a
       * blank band.
       */}
      {isStandaloneRoute(pathname) ? null : (
        <>
          <SiteHeader />
          <CensusMarquee />
        </>
      )}
      <main className="min-w-0 flex-1" id="main-content">
        {children}
      </main>
      {isFullHeight ? null : <SiteFooter />}
    </div>
  );
}

