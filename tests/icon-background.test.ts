/**
 * A see-through icon gets a background that fits it (convex/lib/iconPolicy.ts).
 * Run: npx tsx --test tests/icon-background.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backgroundFor, contrast, flattenOnto, hasTransparency, luminance, type Rgb } from "../convex/lib/iconPolicy";

/** A 10x10 icon: a logo of `color` on the middle 6x6, see-through around it. */
function icon(color: Rgb): Uint8Array {
  const pixels = new Uint8Array(10 * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const i = (y * 10 + x) * 4;
      const inside = x >= 2 && x < 8 && y >= 2 && y < 8;
      pixels.set(inside ? [color.r, color.g, color.b, 255] : [0, 0, 0, 0], i);
    }
  }
  return pixels;
}

describe("backgroundFor", () => {
  it("puts a white logo on a dark background", () => {
    assert.ok(luminance(backgroundFor(icon({ r: 255, g: 255, b: 255 }))) < 0.1);
  });
  it("puts a black logo on a light background", () => {
    assert.ok(luminance(backgroundFor(icon({ r: 0, g: 0, b: 0 }))) > 0.8);
  });
  it("tints the background toward a coloured logo's own hue, with real contrast", () => {
    const blue = { r: 30, g: 90, b: 230 };
    const bg = backgroundFor(icon(blue));
    assert.ok(bg.b > bg.r, "a blue logo gets a blue-leaning background");
    assert.ok(contrast(blue, bg) > 3, "and it stands out from it");
  });
  it("gives a yellow logo a dark background", () => {
    assert.ok(luminance(backgroundFor(icon({ r: 243, g: 186, b: 47 }))) < 0.1);
  });
});

describe("flattenOnto", () => {
  it("leaves nothing see-through and keeps the logo's own pixels", () => {
    const pixels = icon({ r: 200, g: 10, b: 10 });
    assert.equal(hasTransparency(pixels), true);
    flattenOnto(pixels, { r: 245, g: 244, b: 240 });
    assert.equal(hasTransparency(pixels), false);
    const centre = (5 * 10 + 5) * 4;
    assert.deepEqual([...pixels.subarray(centre, centre + 3)], [200, 10, 10]);
    assert.deepEqual([...pixels.subarray(0, 3)], [245, 244, 240]);
  });
  it("treats an opaque icon as needing nothing", () => {
    const pixels = new Uint8Array(16).fill(255);
    assert.equal(hasTransparency(pixels), false);
  });
});
