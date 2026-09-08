"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { useAppStore } from "@/store/use-app-store";

/**
 * The offer of an explanation, for someone who has never seen this before.
 *
 * ===========================================================================
 * WHY AN OFFER AND NOT A REDIRECT
 * ===========================================================================
 * Forcing a first-time visitor through four screens before they can see the
 * catalog would be worse than having no onboarding at all: it puts explanation
 * between a person and the thing they came for, on a site whose whole argument
 * is that you can inspect an agent before committing to anything. So this is a
 * dismissible strip, it appears once, and ignoring it costs nothing.
 *
 * ===========================================================================
 * HYDRATION
 * ===========================================================================
 * `hasCompletedOnboarding` is read from localStorage by zustand/persist, which
 * has not rehydrated during the server render or the first client render. So
 * this renders NOTHING until mounted: the server and first client trees must
 * agree or React throws #418, which has already happened once on this site
 * (see the note in wallet/altana-storage.ts).
 *
 * `useSyncExternalStore` rather than `useState(false)` + `useEffect(setTrue)`.
 * The effect version is what `react-hooks/set-state-in-effect` exists to catch:
 * it is a synchronous setState in an effect body, so it forces a second render
 * pass on every mount of this component. This gets the same "am I on the
 * client" answer from the two snapshot functions, with no state and no extra
 * render - the same pattern wallet/wallet-provider.tsx already uses for wagmi's
 * browser-only account state.
 */

/** The store never changes, so nothing ever needs to be notified. */
function subscribeToNothing() {
  return () => {};
}

export function OnboardingPrompt() {
  const hasCompleted = useAppStore((state) => state.hasCompletedOnboarding);
  const setCompleted = useAppStore((state) => state.setHasCompletedOnboarding);
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  if (!isMounted || hasCompleted) return null;

  return (
    <aside className="site-frame">
      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-paper px-5 py-4">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
        >
          <CategoryGlyph color="currentColor" name="info" size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            New to onchain agents?
          </p>
          <p className="mt-0.5 text-sm leading-6 text-muted">
            Four short screens on what an agent is, what Dolphin checks, and what
            hiring one actually does to your wallet. Nothing here needs it — it
            is just quicker than working it out.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            className="interactive inline-flex min-h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-ink no-underline hover:bg-accent-hover"
            href="/onboarding"
          >
            Read it
          </Link>
          <button
            aria-label="Dismiss the introduction"
            className="interactive min-h-10 rounded-xl px-3 text-sm font-medium text-muted hover:text-ink"
            onClick={() => setCompleted(true)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      </div>
    </aside>
  );
}
