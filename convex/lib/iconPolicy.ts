/**
 * WHAT AN AGENT ICON MAY BE. (2026-09-26)
 *
 * The owner's rules for built agents: every one has an icon; PNG and JPEG
 * only; a size limit; compressed after; and "secure my product from funny
 * users". Pure checks live here; the decode and re-encode is in
 * convex/iconProcessing.ts.
 *
 * WHY THE TYPE IS READ FROM THE BYTES. A file's name and its declared content
 * type are whatever the uploader typed. An SVG (which can carry script), an
 * HTML page or an executable renamed `.png` passes an extension check. The
 * first bytes of a real PNG or JPEG are fixed, so they are what is checked -
 * and then the image is decoded and redrawn anyway, so nothing but pixels
 * survives (measured: a PNG with a script and a zip appended is refused by the
 * decoder outright).
 */

/** Refused before decoding: a real icon is well under this. */
export const MAX_ICON_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Smaller than this is a speck; larger is a decode-cost attack, not an icon. */
export const MIN_ICON_SIDE = 64;
export const MAX_ICON_SIDE = 4096;

/** Opaque icons are stored as JPEG at this size (~35 KB measured). */
export const STORED_JPEG_SIDE = 512;
export const STORED_JPEG_QUALITY = 82;
/** Transparent icons stay PNG, smaller, because jimp's PNG output does not compress (~71 KB at 256). */
export const STORED_PNG_SIDE = 256;

/** Icons one wallet may process in a day. Uploading is free for us to abuse otherwise. */
export const MAX_ICONS_PER_WALLET_PER_DAY = 20;

export type IconKind = "image/png" | "image/jpeg";

/** The type the bytes actually are, or null for anything that is not a PNG or JPEG. */
export function sniffIconType(head: Uint8Array): IconKind | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= png.length && png.every((byte, index) => head[index] === byte)) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  return null;
}
