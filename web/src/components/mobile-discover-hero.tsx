"use client";

/**
 * The phone's heading over the agent list. Until 2026-10-14 this also held a purple-wave promo rail and the
 * menu button; the homepage story (components/home-story.tsx) now tells newcomers what Dolphin is, the rail
 * was off the gold-dolphin art direction, and the menu button moved to the top bar (site-header.tsx).
 */
export function MobileDiscoverHero() {
  return (
    <div className="mobile-discover-hero">
      <div className="mobile-discover-heading">
        <h2>Agents for hire</h2>
      </div>
    </div>
  );
}
