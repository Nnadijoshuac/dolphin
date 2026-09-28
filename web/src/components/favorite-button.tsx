"use client";

import { useFavorites } from "@/hooks/use-favorites";

/**
 * The star. Renders nothing without a connected wallet - see useFavorites.
 *
 * It is always a SIBLING of a card's link, never inside it: a button inside an
 * <a> is invalid HTML, and a press would open the agent as well as star it.
 * Callers position it over the card.
 */
export function FavoriteButton({
  agentKey,
  agentName,
  className = "",
  size = 18,
}: {
  agentKey: string;
  agentName: string;
  className?: string;
  size?: number;
}) {
  const favorites = useFavorites();
  if (!favorites.visible) return null;

  const active = favorites.isFavorite(agentKey);

  return (
    <button
      aria-label={active ? `Remove ${agentName} from favorites` : `Add ${agentName} to favorites`}
      aria-pressed={active}
      className={`interactive inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper-strong transition-colors hover:border-line-strong disabled:opacity-60 ${
        active ? "text-accent-ink" : "text-muted hover:text-ink"
      } ${className}`}
      disabled={favorites.isSigningIn}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void favorites.toggle(agentKey);
      }}
      title={active ? "Favorited" : "Favorite"}
      type="button"
    >
      <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
        <path
          d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      </svg>
    </button>
  );
}
