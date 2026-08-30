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
 *   3. A locally generated DiceBear avatar. Not a flat category colour block.
 *
 * NOTHING IS HOTLINKED. Tiers 1 and 2 are fetched ONCE and the bytes are stored
 * in Convex file storage; the app renders Dolphin's own URL. A third-party image
 * host that is slow, rate-limiting, or gone looks worse than no icon at all, and
 * re-fetching an external URL on every render would make that failure mode a
 * permanent property of the page rather than a one-time risk at onboarding.
 *
 * ---------------------------------------------------------------------------
 * DECISION: DiceBear `shapes`, seeded on tokenId, generated in-process.
 * ---------------------------------------------------------------------------
 * - `shapes` is one of DiceBear's ABSTRACT/geometric styles. Deliberately not
 *   an illustrated-character style (`bottts`, `adventurer`, `personas`): a
 *   geometric pattern reads honestly as "the publisher supplied no icon",
 *   whereas a character risks being mistaken for the agent's own chosen mascot,
 *   which would be Dolphin inventing an identity for somebody else's agent.
 * - Generated with the npm library, NOT DiceBear's hosted HTTP API. That is
 *   what makes tier 3 have no external network dependency at all - strictly
 *   better than the "cache once, don't hotlink" rule the other two tiers follow.
 * - Seeded on `tokenId`, which is immutable, so an agent's fallback icon is the
 *   same on every load forever rather than changing between renders.
 * - Verified against the installed package rather than assumed: @dicebear/core
 *   9.x + @dicebear/collection 9.x (collection peers `@dicebear/core ^9.0.0`
 *   and has no v10 release, so v9 is the current compatible pairing, not a
 *   downgrade). `shapes` reports its own licence as CC0 1.0.
 */

import { createAvatar } from "@dicebear/core";
import { shapes } from "@dicebear/collection";

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
 * The deterministic fallback. Same tokenId in, byte-identical SVG out, on every
 * call and every deployment - which is what makes it safe to store once.
 */
export function generateFallbackIconSvg(tokenId: string): string {
  return createAvatar(shapes, {
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
