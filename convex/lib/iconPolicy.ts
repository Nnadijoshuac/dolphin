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

/** Every icon is stored as JPEG at this size (~35 KB measured); see-through ones are given a background first. */
export const STORED_JPEG_SIDE = 512;
export const STORED_JPEG_QUALITY = 82;

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

/* ---------------------------------------------------------------------------
 * A TRANSPARENT ICON GETS A BACKGROUND THAT FITS IT (owner, 2026-10-02:
 * "fill automatically ... we need to know what the image looks like").
 *
 * Read from the pixels, not guessed: the logo's brightness, its main colour
 * and how colourful it is. The background is the light or the dark option
 * that contrasts with the logo more, tinted toward the logo's own hue so it
 * looks designed rather than pasted on. Pure arithmetic: the same image
 * always gets the same background, and no image model is called.
 * ------------------------------------------------------------------------ */

export type Rgb = { r: number; g: number; b: number };

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/** True when enough of the image is see-through that it would show the page behind it. */
export function hasTransparency(pixels: Uint8Array): boolean {
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 250) return true;
  return false;
}

/** The visible logo's colour, its main hue and how colourful it is, alpha-weighted. */
export function readLogo(pixels: Uint8Array): { mean: Rgb; hue: number; saturation: number } {
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const hues = new Array<number>(12).fill(0);
  let satSum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.5) continue;
    const pr = pixels[index];
    const pg = pixels[index + 1];
    const pb = pixels[index + 2];
    r += pr * alpha;
    g += pg * alpha;
    b += pb * alpha;
    weight += alpha;
    const max = Math.max(pr, pg, pb) / 255;
    const min = Math.min(pr, pg, pb) / 255;
    const chroma = max - min;
    satSum += chroma * alpha;
    if (chroma > 0.15) {
      let h: number;
      if (max === pr / 255) h = ((pg - pb) / 255 / chroma) % 6;
      else if (max === pg / 255) h = (pb - pr) / 255 / chroma + 2;
      else h = (pr - pg) / 255 / chroma + 4;
      hues[Math.floor((((h * 60) % 360) + 360) % 360 / 30)] += chroma * alpha;
    }
  }
  if (weight === 0) return { mean: { r: 128, g: 128, b: 128 }, hue: 0, saturation: 0 };
  const top = hues.indexOf(Math.max(...hues));
  return { mean: { r: r / weight, g: g / weight, b: b / weight }, hue: top * 30 + 15, saturation: satSum / weight };
}

/** The background a transparent logo is placed on: the better-contrasting of a light and a dark tint of its own hue. */
export function backgroundFor(pixels: Uint8Array): Rgb {
  const logo = readLogo(pixels);
  const tint = logo.saturation > 0.12;
  const light = tint ? hsl(logo.hue, 0.35, 0.95) : { r: 245, g: 244, b: 240 };
  const dark = tint ? hsl(logo.hue, 0.3, 0.1) : { r: 22, g: 23, b: 28 };
  return contrast(logo.mean, light) >= contrast(logo.mean, dark) ? light : dark;
}

/** Places every pixel over `background`, in place; the result is fully opaque. */
export function flattenOnto(pixels: Uint8Array, background: Rgb): void {
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    pixels[index] = Math.round(pixels[index] * alpha + background.r * (1 - alpha));
    pixels[index + 1] = Math.round(pixels[index + 1] * alpha + background.g * (1 - alpha));
    pixels[index + 2] = Math.round(pixels[index + 2] * alpha + background.b * (1 - alpha));
    pixels[index + 3] = 255;
  }
}
