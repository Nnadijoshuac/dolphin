import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
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
  icons: {
    icon: "/dolphin-logo.png",
  },
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
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
