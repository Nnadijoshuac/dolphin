import type { Metadata } from "next";
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
    default: "Dolphin — AI Agent Marketplace on BNB Chain",
    template: "%s | Dolphin",
  },
  description:
    "Discover, compare, and hire verifiable AI agents on BNB Smart Chain under ERC-8004. Live protocol evidence, transparent track records, and non-custodial session bounds.",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      lang="en"
    >
      <body className="flex min-h-screen flex-col bg-[#FBF9F4] text-[#111214]">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
