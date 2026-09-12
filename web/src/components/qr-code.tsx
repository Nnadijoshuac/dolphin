"use client";

import { useMemo } from "react";
import QRCode from "qrcode";

/**
 * A QR code, drawn as one SVG path from the raw module matrix.
 *
 * ===========================================================================
 * WHY NOT `QRCode.toString(…, {type:"svg"})`
 * ===========================================================================
 * That returns a finished SVG string with its own hardcoded `fill="#000000"`
 * and `#ffffff`, which would have to go in through `dangerouslySetInnerHTML`
 * and would render a black-on-white square in dark mode — a bright rectangle
 * punched through the sheet. `QRCode.create` hands back `{modules:{size,data}}`
 * instead, so the matrix is drawn here as a single `<path>` in `currentColor`
 * and inherits the theme like everything else on the page.
 *
 * It is also one path, not one `<rect>` per module: a 29×29 code is 841
 * modules and roughly 400 of them are dark, so the rect version is ~400 DOM
 * nodes for a decorative square. A path is one node and draws identically.
 *
 * ===========================================================================
 * ERROR CORRECTION LEVEL M, deliberately.
 * ===========================================================================
 * L is smaller but tolerates ~7% damage; M tolerates ~15% at one version
 * larger. This code is scanned off a screen, at an angle, by a phone camera,
 * often with a finger or a reflection across part of it — and what it encodes
 * is an address that money is about to be sent to. The cost of M is a slightly
 * denser square; the cost of a failed scan is the user hand-typing 42
 * characters. There is no case for H here: the payload is short and H would
 * grow the version for redundancy nothing needs.
 *
 * `create` throws on an un-encodable payload rather than returning junk. That
 * is caught and surfaced as `null` so the caller can say so — a QR that does
 * not encode this exact address must never be drawn (see receive-sheet.tsx).
 */
/**
 * The quiet zone, in modules.
 *
 * Not decoration: the spec requires a clear margin around the symbol, and a
 * code drawn flush to the edge of its container is measurably worse to scan.
 */
const QUIET = 2;

/**
 * value → `{ extent, path }`, or null if the payload will not encode.
 *
 * Exported and pure so it can be TESTED, which for this function means tested
 * against the library's own renderer: qr-code.test.ts asserts that the module
 * set drawn here is byte-identical to the set `QRCode.toString({type:"svg"})`
 * draws for the same input. That is the check that matters — a QR that looks
 * like a QR but encodes something else is the whole risk of hand-drawing one,
 * and "it rendered a square" is not evidence against it.
 */
export function qrPath(value: string): { extent: number; path: string } | null {
  try {
    const created = QRCode.create(value, { errorCorrectionLevel: "M" });
    const count = created.modules.size;
    const bits = created.modules.data;

    /*
     * One `M x y h1 v1 h-1 z` per dark module, on integer coordinates. The
     * viewBox is the module count plus the quiet zone, so every module is
     * exactly one user unit and no fractional coordinate ever appears —
     * fractional rects are what produce the faint seams between modules that
     * make some rendered QRs hard to scan.
     */
    let path = "";
    for (let y = 0; y < count; y += 1) {
      for (let x = 0; x < count; x += 1) {
        if (bits[y * count + x]) {
          path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
        }
      }
    }
    return { extent: count + QUIET * 2, path };
  } catch {
    return null;
  }
}

export function QrCode({
  className,
  size = 148,
  value,
}: {
  className?: string;
  /** Rendered edge length in px. The matrix is scaled by viewBox, not redrawn. */
  size?: number;
  value: string;
}) {
  const code = useMemo(() => qrPath(value), [value]);

  if (!code) return null;

  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      shapeRendering="crispEdges"
      viewBox={`0 0 ${code.extent} ${code.extent}`}
      width={size}
    >
      <path d={code.path} fill="currentColor" />
    </svg>
  );
}
