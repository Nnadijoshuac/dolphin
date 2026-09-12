import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import { qrPath } from "@/components/qr-code";

/**
 * ===========================================================================
 * THE ONLY QUESTION WORTH ASKING OF A HAND-DRAWN QR
 * ===========================================================================
 * Not "does it render" — a wrong matrix renders perfectly well and looks
 * exactly like a right one. The question is whether the modules drawn are the
 * modules the encoder produced, and the way to answer it is to compare against
 * a renderer that is already trusted: the library's own SVG output.
 *
 * If these two agree on every dark module for a given payload, then this
 * component's only contribution — walking `modules.data` and emitting a path —
 * is correct, and the encoding itself is the library's problem rather than
 * ours.
 *
 * This matters more than most tests in this repo because the payload is an
 * address somebody is about to send money to. A QR that encodes a different
 * string is not a rendering bug, it is a funds-loss bug, and it is invisible
 * to every check except this one.
 * ===========================================================================
 */

/**
 * Parses the library's stroke-based SVG path into a set of "x,y" module keys.
 *
 * Its format is not the same as ours and that is the point of the exercise —
 * agreeing by construction would prove nothing. It emits horizontal runs on
 * half-pixel rows: `M0 0.5h7m2 0h2…`, where `M` is an absolute move, `m` is
 * relative to the pen (which sits at the end of the previous run), `h` draws a
 * run of that many modules, and the `.5` centres a 1px stroke on the row.
 */
function modulesFromLibrarySvg(svg: string): Set<string> {
  const stroked = /stroke="#000000" d="([^"]+)"/.exec(svg);
  if (!stroked) throw new Error("library SVG shape changed — parser needs updating");

  const modules = new Set<string>();
  let x = 0;
  let y = 0;

  for (const token of stroked[1].match(/[Mmh][-\d. ]*/g) ?? []) {
    const op = token[0];
    const nums = token.slice(1).trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (op === "M") {
      x = nums[0];
      y = Math.floor(nums[1]);
    } else if (op === "m") {
      x += nums[0];
      y += Math.floor(nums[1]);
    } else {
      for (let i = 0; i < nums[0]; i += 1) modules.add(`${x + i},${y}`);
      x += nums[0];
    }
  }
  return modules;
}

/** Parses OUR path — absolute 1×1 squares, offset by the quiet zone. */
function modulesFromOurPath(path: string, quiet = 2): Set<string> {
  const modules = new Set<string>();
  for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    modules.add(`${Number(match[1]) - quiet},${Number(match[2]) - quiet}`);
  }
  return modules;
}

const ADDRESSES = [
  // The BSC address used while verifying this by screenshot.
  "0x8Ac76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  // All-zero and all-f, to catch an off-by-one that only shows at the edges.
  "0x0000000000000000000000000000000000000000",
  "0xffffffffffffffffffffffffffffffffffffffff",
  // Mixed EIP-55 checksum casing, which changes the payload bytes.
  "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
];

describe("qrPath", () => {
  it.each(ADDRESSES)("draws the library's exact module matrix for %s", async (address) => {
    const ours = qrPath(address);
    expect(ours).not.toBeNull();

    const svg = await QRCode.toString(address, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 0,
    });

    const theirs = modulesFromLibrarySvg(svg);
    const mine = modulesFromOurPath(ours!.path);

    // Non-empty, or the comparison below would pass on two empty sets.
    expect(theirs.size).toBeGreaterThan(100);
    expect([...mine].sort()).toEqual([...theirs].sort());
  });

  it("sizes the viewBox to the matrix plus a quiet zone on both sides", () => {
    const ours = qrPath(ADDRESSES[0]);
    // A 42-character address encodes to a version-3 symbol: 29 modules, +2 each side.
    expect(ours?.extent).toBe(33);
  });

  it("uses integer coordinates only, so modules cannot show seams", () => {
    const ours = qrPath(ADDRESSES[0]);
    expect(ours!.path).not.toMatch(/\d\.\d/);
  });

  /*
   * The failure path. An un-encodable payload must yield null so the caller can
   * omit the code entirely — receive-sheet.tsx still shows the address and the
   * copy button, which is a complete receive path without a QR. Drawing
   * something here would be drawing a code that is not this address.
   */
  it("returns null rather than a partial code when the payload will not encode", () => {
    // Far past the capacity of any version at error-correction level M.
    expect(qrPath("x".repeat(5000))).toBeNull();
  });
});
