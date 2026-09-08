import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { AppFrame } from "@/components/app-frame";
import { AppProviders } from "@/providers/app-providers";
import {
  IS_INDEXABLE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/constants/site";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /*
   * REQUIRED for every relative URL below and in every child route to resolve.
   * Without it Next emits relative OpenGraph image paths, which crawlers and
   * social unfurlers ignore. See @/constants/site for why this is an explicit
   * constant rather than inferred from the request host.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Dolphin — AI agents on BNB Chain",
    template: "%s | Dolphin",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "ERC-8004",
    "BNB Chain",
    "AI agents",
    "Agent Marketplace",
    "DeFi Autonomous Agents",
    "Venus Protocol",
    "PancakeSwap",
  ],
  alternates: { canonical: "/" },
  /*
   * Only production is crawlable. Every branch gets a Vercel preview domain,
   * and an indexed preview is duplicate content on a host that 404s the moment
   * the branch is deleted.
   */
  robots: IS_INDEXABLE
    ? { index: true, follow: true }
    : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Dolphin — AI agents on BNB Chain",
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dolphin — AI agents on BNB Chain",
    description: SITE_DESCRIPTION,
    site: "@dolphin_Agents",
  },
  /*
   * No `icons` override, deliberately.
   *
   * This used to point at /dolphin-logo.png while `app/favicon.ico` also
   * existed, so the site declared two different icons and browsers picked
   * whichever they preferred — usually /favicon.ico, meaning the override
   * never actually took effect.
   *
   * `app/icon.png` is Next's file convention: it is detected automatically,
   * emitted with the right <link rel="icon"> and dimensions, and hashed for
   * cache-busting. One file, one source of truth. Adding a metadata entry back
   * would reintroduce exactly the conflict this removes.
   */
};

export const viewport: Viewport = {
  colorScheme: "light",
  initialScale: 1,
  themeColor: "#f4f3ed",
  width: "device-width",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      lang="en"
    >
      <body className="min-h-screen bg-canvas text-ink">
        <AppProviders>
          <AppFrame>{children}</AppFrame>
        </AppProviders>
        {/*
         * TELEMETRY, which this site had none of. Both are cookieless, need no
         * consent banner in most jurisdictions, and no-op off Vercel - so local
         * development and CI stay silent without a branch here.
         *
         * `Analytics` carries the funnel declared in @/lib/analytics, which is a
         * CLOSED vocabulary that cannot carry a wallet address or a search
         * query. `SpeedInsights` reports field Web Vitals, which is the only
         * way to know whether the hero-video change actually moved LCP for real
         * users rather than in a lab.
         */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
