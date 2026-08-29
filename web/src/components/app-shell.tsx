"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BnbLogo, BrandMark } from "@/components/brand-mark";

const navigation = [
  { path: "/", label: "Discover" },
  { path: "/search", label: "Search" },
  { path: "/my-agents", label: "My agents" },
  { path: "/wallet", label: "Wallet" },
] as const;

function isActiveRoute(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

function NavigationLinks({ pathname }: { pathname: string }) {
  return navigation.map((item) => {
    const isActive = isActiveRoute(pathname, item.path);

    return (
      <Link
        aria-current={isActive ? "page" : undefined}
        className={`pressable-scale whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold no-underline ${
          isActive
            ? "border-[var(--accent)] text-[var(--ink)]"
            : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
        href={item.path}
        key={item.path}
      >
        {item.label}
      </Link>
    );
  });
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--canvas)]">
      <a
        className="fixed left-5 top-4 z-[60] -translate-y-24 rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-bold text-[var(--canvas)] transition-transform focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>

      {/* Layer scale: header 40, skip link 60. Content stays at the default layer. */}
      <header className="site-header sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--header)] backdrop-blur-2xl">
        <div className="site-frame flex h-[68px] items-center justify-between gap-6">
          <Link
            aria-label="Dolphin home"
            className="pressable-scale flex shrink-0 items-center gap-3 no-underline"
            href="/"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface-elevated)]">
              <BrandMark size={27} />
            </span>
            <span>
              <span className="block text-[15px] font-black tracking-[-0.02em] text-[var(--ink)]">
                Dolphin
              </span>
              <span className="block text-[10px] font-semibold tracking-[0.08em] text-[var(--muted)]">
                AGENT MARKETPLACE
              </span>
            </span>
          </Link>

          <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
            <NavigationLinks pathname={pathname} />
          </nav>

          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--muted)]">
            <BnbLogo size={18} />
            <span className="hidden sm:inline">BNB Chain</span>
          </div>
        </div>

        <nav
          aria-label="Mobile navigation"
          className="site-frame no-scrollbar flex items-center justify-between gap-5 overflow-x-auto md:hidden"
        >
          <NavigationLinks pathname={pathname} />
        </nav>
      </header>

      <main className="min-w-0 flex-1" id="main-content">
        {children}
      </main>

      <footer className="mt-auto border-t border-[var(--line)]">
        <div className="site-frame grid gap-8 py-10 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark size={24} />
              <span className="text-sm font-black text-[var(--ink)]">Dolphin</span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
              Evidence-first discovery for ERC-8004 agents on BNB Smart Chain.
            </p>
          </div>
          <p className="text-xs leading-5 text-[var(--faint)] sm:text-right">
            Live claims keep their source.<br />Missing data stays missing.
          </p>
        </div>
      </footer>
    </div>
  );
}
