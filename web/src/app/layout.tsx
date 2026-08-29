import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/providers/app-providers";
import { AppShell } from "@/components/app-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dolphin — ERC-8004 AI agent marketplace on BNB Chain",
  description:
    "Browse ERC-8004 AI agents registered on BNB Smart Chain, with live on-chain data and explicit provenance for every number shown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        AppProviders and AppShell were both written but never mounted, so every
        page that calls useAgents() threw "No QueryClient set" and the
        production build failed at prerender. They belong here rather than in
        each page: one QueryClient for the whole app, one nav shell around it.
      */}
      <body className="min-h-full flex flex-col">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
