/**
 * Icon sourcing for the onboarding pipeline (Task 4).
 *
 * WHY THIS IS DATA WORK AND NOT DECORATION. Dolphin's whole premise is the App
 * Store / Play Store comparison, and a store listing without an icon does not
 * read as a store listing. A grid of identical placeholder tiles undercuts the
 * "official BNB Chain agent marketplace" framing more than almost anything else
 * on the page. So sourcing an icon is part of onboarding an agent, in the same
 * pass that classifies and probes it.
 *
 * THREE TIERS, IN ORDER, EACH ONE HONEST ABOUT WHERE IT CAME FROM:
 *
 *   1. 8004scan's own `image_url` for the agent.
 *   2. The agent's OWN registration file, fetched directly (convex/lib/
 *      registrationFile.ts). Publishers routinely put a logo there that
 *      8004scan's cache never picked up - this is the same fetch Task 2's
 *      cross-check already performs, so tier 2 costs no extra request.
 *   3. A locally generated robot avatar. Not a flat category colour block.
 *
 * NOTHING IS HOTLINKED. Tiers 1 and 2 are fetched ONCE and the bytes are stored
 * in Convex file storage; the app renders Dolphin's own URL. A third-party image
 * host that is slow, rate-limiting, or gone looks worse than no icon at all, and
 * re-fetching an external URL on every render would make that failure mode a
 * permanent property of the page rather than a one-time risk at onboarding.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-09-05): DiceBear `bottts` - a robot, seeded on tokenId,
 * generated in-process. SUPERSEDES the `shapes` decision recorded below.
 * ---------------------------------------------------------------------------
 * THE RULE A GENERATED ICON NOW FOLLOWS: it must depict an ARTIFICIAL SYSTEM,
 * and must never depict a human being. Every listing in this catalog is a
 * machine, and a tile that reads as a person misrepresents what is being hired.
 *
 * WHAT THIS OVERRULES, STATED PLAINLY so the trade is not lost. The previous
 * decision chose the abstract `shapes` style specifically to avoid an
 * illustrated character, reasoning that a geometric pattern reads honestly as
 * "the publisher supplied no icon", whereas a character risks being mistaken
 * for the agent's own chosen mascot - Dolphin inventing an identity for
 * somebody else's agent. That risk is real, and it is now ACCEPTED rather than
 * solved: 482 interchangeable geometric tiles read as a broken catalog, and a
 * robot at least tells a browsing user the true thing about what an agent is.
 * `iconSource` is still stored and still reports `generated-fallback`, so which
 * tier produced any given tile stays answerable.
 *
 * NOT `botttsNeutral`, deliberately: src/components/wallet-avatar.tsx already
 * draws the Dolphin Wallet in that style, and an agent must not look like the
 * same kind of object as an account.
 *
 * UNCHANGED FROM THE ORIGINAL DECISION, and still load-bearing:
 * - Generated with the npm library, NOT DiceBear's hosted HTTP API. That is
 *   what makes tier 3 have no external network dependency at all - strictly
 *   better than the "cache once, don't hotlink" rule the other two tiers follow.
 * - Seeded on `tokenId`, which is immutable, so an agent's fallback icon is the
 *   same on every load forever rather than changing between renders.
 * - Verified against the installed package rather than assumed: @dicebear/core
 *   9.x + @dicebear/collection 9.x (collection peers `@dicebear/core ^9.0.0`
 *   and has no v10 release, so v9 is the current compatible pairing, not a
 *   downgrade). `bottts` is present in the installed collection alongside
 *   `shapes` and reports the same CC0 1.0 licence - both checked in the
 *   installed package, not carried from the old note.
 *
 * REGENERATION IS NOT AUTOMATIC. `ensureCatalogIcons` skips any agent that
 * already holds a cached icon, by design, so the 482 agents currently on a
 * `shapes` tile keep it until their cached icon is cleared. Bumping
 * FALLBACK_ICON_STYLE_VERSION below is the signal to do that pass; it does not
 * perform it.
 */

import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";

/** Where a stored icon actually came from. Surfaced so a UI can label it. */
export type IconSource =
  | "8004scan-image"
  | "registration-file"
  | "generated-fallback";

/** Icons are small. Anything larger is not an agent icon and is not stored. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

const ICON_FETCH_TIMEOUT_MS = 10_000;

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
];

/**
 * Which generated-fallback style a stored tile was drawn in.
 *
 * Exists because the icon pass is idempotent by skipping anything already
 * cached, so a style change reaches only agents onboarded after it. Comparing a
 * stored version against this constant is how a future pass can find the tiles
 * drawn in a superseded style without re-fetching every publisher URL, and how
 * "why do two fallback tiles look different" stays answerable.
 *
 *   1  DiceBear `shapes`  - abstract geometry (until 2026-09-05)
 *   2  DiceBear `bottts`  - robot; artificial system, never a person
 */
export const FALLBACK_ICON_STYLE_VERSION = 2;

/**
 * The deterministic fallback. Same tokenId in, byte-identical SVG out, on every
 * call and every deployment - which is what makes it safe to store once.
 */
export function generateFallbackIconSvg(tokenId: string): string {
  return createAvatar(bottts, {
    seed: tokenId,
    size: 256,
    radius: 12,
  }).toString();
}

export interface FetchedIcon {
  blob: Blob;
  contentType: string;
  bytes: number;
}

/**
 * Fetches a candidate icon URL once, rejecting anything that is not actually a
 * small image. A publisher pointing `image_url` at an HTML error page or a 40MB
 * asset should end up on the generated fallback, not in Dolphin's storage.
 */
export async function fetchIcon(url: string): Promise<FetchedIcon> {
  const response = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`content-type "${contentType || "none"}" is not an allowed image type`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("the response body was empty");
  }
  if (blob.size > MAX_ICON_BYTES) {
    throw new Error(`image is ${blob.size} bytes, over the ${MAX_ICON_BYTES} cap`);
  }

  return { blob, contentType, bytes: blob.size };
}

/** The fallback SVG as a Blob, ready for ctx.storage.store. */
export function fallbackIconBlob(tokenId: string): { blob: Blob; bytes: number } {
  const svg = generateFallbackIconSvg(tokenId);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  return { blob, bytes: blob.size };
}
