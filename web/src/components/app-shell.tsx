"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CategoryGlyph } from "@/components/category-glyph";
import { BrandMark } from "@/components/brand-mark";
import { colors } from "@/constants/theme";
import type { GlyphName } from "@/components/category-glyph";

// Only routes that exist. "My Agents" was listed here with no page behind it,
// so Next prefetched /my-agents on every render and got a 404, and clicking it
// took the user to the not-found page. It comes back when the route does.
const tabs: { path: string; label: string; icon: GlyphName }[] = [
  { path: "/", label: "Discover", icon: "discover" },
  { path: "/search", label: "Search", icon: "search" },
  { path: "/wallet", label: "Wallet", icon: "wallet" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ backgroundColor: colors.canvas }}>
      {/* Desktop Sidebar (lg+) */}
      <aside
        className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:p-6 sticky top-0 h-screen"
        style={{ borderColor: colors.line, backgroundColor: colors.surface }}
      >
        {/* Branding */}
        <div className="flex items-center gap-2.5 mb-10">
          <BrandMark size={28} />
          <div>
            <p className="text-[15px] font-black uppercase tracking-[1.5px]" style={{ color: colors.ink }}>
              DOLPHIN
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[1px]" style={{ color: colors.muted }}>
              ERC-8004 AI AGENT MARKETPLACE
            </p>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => {
            const isActive =
              tab.path === "/"
                ? pathname === "/" || pathname === ""
                : pathname.startsWith(tab.path);

            return (
              <Link
                key={tab.path}
                href={tab.path}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-semibold no-underline transition-all duration-200"
                style={{
                  backgroundColor: isActive ? colors.goldSoft : "transparent",
                  color: isActive ? colors.goldDark : colors.muted,
                }}
              >
                <CategoryGlyph
                  name={tab.icon}
                  size={20}
                  color={isActive ? colors.goldDark : colors.muted}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom info */}
        <div className="mt-auto pt-6">
          <div
            className="rounded-xl border p-3"
            style={{ borderColor: colors.line, backgroundColor: colors.surfaceSubtle }}
          >
            <p className="text-[11px] font-bold" style={{ color: colors.ink }}>BNB Smart Chain</p>
            <p className="mt-0.5 text-[10px]" style={{ color: colors.muted }}>
              ERC-8004 registry · Chain 56
            </p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 pb-24 lg:pb-0">
        <div className="mx-auto w-full max-w-3xl px-5 lg:px-8">
          {children}
        </div>
      </main>

      {/* Mobile Floating Island Tab Bar (< lg) */}
      <nav
        className="fixed bottom-5 left-10 right-10 z-50 flex items-center justify-around rounded-full border border-black/10 bg-white/85 backdrop-blur-xl shadow-2xl lg:hidden py-2 px-2 max-w-sm mx-auto"
        style={{
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
        }}
      >
        {tabs.map((tab) => {
          const isActive =
            tab.path === "/"
              ? pathname === "/" || pathname === ""
              : pathname.startsWith(tab.path);

          return (
            <Link
              key={tab.path}
              href={tab.path}
              className="flex flex-col items-center gap-0.5 no-underline py-1 px-3 rounded-full transition-all"
            >
              <CategoryGlyph
                name={tab.icon}
                size={20}
                color={isActive ? colors.goldDark : "#8C8E88"}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span
                className="text-[10px] font-bold"
                style={{ color: isActive ? colors.goldDark : "#8C8E88" }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
