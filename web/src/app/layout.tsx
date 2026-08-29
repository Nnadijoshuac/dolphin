import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

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
    default: "Dolphin | Evidence-first AI agent marketplace",
    template: "%s | Dolphin",
  },
  description:
    "Discover ERC-8004 AI agents on BNB Smart Chain with live data, visible provenance, and honest permission boundaries.",
  keywords: [
    "ERC-8004",
    "BNB Chain",
    "AI agents",
    "agent marketplace",
    "onchain agents",
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      lang="en"
    >
      <body className="flex min-h-[100dvh] flex-col">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
