import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/app-frame";
import { AppProviders } from "@/providers/app-providers";

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
  title: {
    default: "Dolphin — AI agents on BNB Chain",
    template: "%s | Dolphin",
  },
  description:
    "Discover, understand, and hire ERC-8004 AI agents on BNB Chain with inspectable data and clear session controls.",
  keywords: [
    "ERC-8004",
    "BNB Chain",
    "AI agents",
    "Agent Marketplace",
    "DeFi Autonomous Agents",
    "Venus Protocol",
    "PancakeSwap",
  ],
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
      </body>
    </html>
  );
}
