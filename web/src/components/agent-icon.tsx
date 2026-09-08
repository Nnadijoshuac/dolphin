/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useSyncExternalStore } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { readCacheStable, writeCache } from "@/lib/local-cache";
import type { AgentCategory } from "@/types/agent";

/**
 * How long a publisher icon URL is remembered as broken.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, 2026-09-08
 * ---------------------------------------------------------------------------
 * Publisher icons are served by `api.8004scan.io/api/v1/media/agents/...`,
 * which 307s to an immutable blob. The blob itself is
 * `Cache-Control: public, max-age=31536000, immutable` - once fetched, the
 * browser never asks again, and that half works beautifully.
 *
 * The REDIRECT is `max-age=300`, and it returns HTTP 500
 * (`{"code":"DATABASE_ERROR"}`) on a large fraction of requests - three of four
 * consecutive attempts on one agent during measurement. So every five minutes
 * the browser must traverse a hop that frequently fails, for each of the ~29
 * agents on a page that publish an icon. That is the flicker between real icons
 * and generated ones, and a chunk of the slowness.
 *
 * Remembering a failure for five minutes - the redirect's OWN max-age - means a
 * page that has already discovered a broken icon paints the generated avatar
 * immediately instead of spending a request and a timeout rediscovering it.
 *
 * DELIBERATELY SHORT. This endpoint is flaky, not dead: a longer TTL would turn
 * a transient 500 into an agent whose real icon is hidden for the rest of the
 * day. Five minutes is long enough to spare a page-load's worth of retries and
 * short enough that recovery is automatic.
 */
const ICON_FAILURE_TTL_MS = 5 * 60 * 1000;

/** One entry per failed URL, so two agents cannot mask each other's icon. */
function iconFailureKey(url: string): string {
  return `icon.failed.${url}`;
}

/**
 * Module scope so its identity is stable across renders. Nothing pushes updates
 * into this store - a failure is recorded by this component's own onError and
 * read back on the next render - so the unsubscribe is a no-op.
 */
const ICON_STORE_NEVER_CHANGES = () => () => {};

const categoryBgColors: Record<AgentCategory, { bg: string; border: string; glyphColor: string }> = {
  rebalancing: { bg: "#FEF5D6", border: "#F3E3A6", glyphColor: "#946B00" },
  "grid-trading": { bg: "#DDE9F8", border: "#C6D8EE", glyphColor: "#295C92" },
  "health-factor": { bg: "#DCEFE4", border: "#BFE0CC", glyphColor: "#1C6A44" },
  yield: { bg: "#E9E1F4", border: "#D8CAE8", glyphColor: "#65478A" },
  monitoring: { bg: "#F5F3EB", border: "#ECE8DE", glyphColor: "#303236" },
  trading: { bg: "#F7DFD8", border: "#EFCDC2", glyphColor: "#964C3C" },
};

/**
 * The generated tier: a deterministic DiceBear avatar for an agent that
 * published no icon of its own.
 *
 * NOTHING IS STORED. This is a URL built from the seed the backend already
 * sends, rendered as a plain remote image. The previous pipeline generated the
 * same avatar server-side and wrote the SVG bytes into Convex file storage - a
 * redundant write of a pure function of the seed, repeated per agent.
 * `convex/schema.ts` says `iconUrl` is "a URL, NEVER a blob, and never a stored
 * DiceBear render"; this is the client half of that contract.
 *
 * MIRRORED BY HAND in src/components/agent-icon.tsx (the Expo app). Same style,
 * same seeding rule, so one agent renders the same face on both products. Edit
 * both in one change.
 *
 * A plain `<img>`, not `next/image`, for the reason WalletAvatar gives: these
 * are remote SVGs, which Next's optimizer passes through untouched anyway, so
 * `<Image>` would buy nothing and cost a `remotePatterns` entry for a
 * decorative graphic. No npm dependency either - it is a URL.
 */
const DICEBEAR_STYLE = "bottts-neutral";

function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(seed)}`;
}

type AgentIconProps = {
  category: AgentCategory;
  size?: number;
  uri?: string | null;
  /**
   * `agent.iconSeed` - the backend sends it on every agent precisely so this
   * fallback can exist without the client knowing that a tokenId happens to be
   * the seed. Omitted only where a call site genuinely has no agent resolved,
   * in which case the category mark is still drawn.
   */
  seed?: string | null;
};

export function AgentIcon({ category, size = 48, uri, seed }: AgentIconProps) {
  const config = categoryBgColors[category] ?? categoryBgColors.monitoring;
  const dimensions = { width: size, height: size, flexShrink: 0 };

  const generated = seed ? dicebearUrl(seed) : null;

  /*
   * Whether this browser has recently watched `uri` fail.
   *
   * Read through useSyncExternalStore with a null server snapshot, for the same
   * reason useCachedQuery does: this component renders on the server too, and
   * reading localStorage during the first client render would disagree with the
   * HTML Next sent.
   *
   * The consequence is that a hard page load still attempts the publisher URL
   * once, and the memory applies from the following render. That is the right
   * way round - a recovered endpoint gets a fresh chance on every page load
   * rather than being written off for the whole TTL.
   */
  const getBroken = useCallback(
    () => (uri ? readCacheStable<true>(iconFailureKey(uri), ICON_FAILURE_TTL_MS) === true : false),
    [uri],
  );

  const knownBroken = useSyncExternalStore(ICON_STORE_NEVER_CHANGES, getBroken, () => false);

  // Publisher icon first, the generated one when there is none or when the
  // publisher's has just failed. Only ONE image is requested per agent: the
  // generated tier is not preloaded behind a working publisher icon, which on a
  // full catalog page would be a wasted request per row.
  const src = uri && !knownBroken ? uri : generated;

  return (
    <div
      aria-hidden="true"
      className="relative flex items-center justify-center overflow-hidden rounded-[14px] border"
      style={{
        ...dimensions,
        backgroundColor: config.bg,
        borderColor: config.border,
      }}
    >
      {/* Drawn underneath, so it is what shows when every image tier fails. */}
      <CategoryGlyph
        color={config.glyphColor}
        name={category}
        size={size * 0.44}
        strokeWidth={2}
      />
      {src ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            /*
             * Fall through one tier at a time. `iconUrl` is now whatever URL the
             * publisher registered rather than bytes Dolphin cached, so a 404
             * here is expected rather than exceptional - it should land on the
             * generated avatar, and only then on the category mark below.
             */
            const image = event.currentTarget;
            if (generated && image.src !== generated) {
              // Remember it, so the rest of this session - and the next few
              // minutes of loads - skip straight to the avatar instead of
              // paying for this request again on every render.
              if (uri) writeCache(iconFailureKey(uri), true);
              image.src = generated;
              return;
            }
            image.style.display = "none";
          }}
          src={src}
        />
      ) : null}
    </div>
  );
}
