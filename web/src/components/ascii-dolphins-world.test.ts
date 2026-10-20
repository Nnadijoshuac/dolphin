import { afterEach, describe, expect, it, vi } from "vitest";

import { NODES, World } from "./ascii-dolphins-world";

/** A repeatable Math.random, so a failure can be replayed. */
function seeded(seed: number) {
  let s = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  });
}

function run(seed: number, seconds: number, w = 1200, h = 800) {
  seeded(seed);
  const world = new World();
  world.resize(w, h);
  const seen = { maxAtOnce: 0, empty: 0, leaps: 0, scenes: new Set<string>(), maxBend: 0, outOfBounds: 0, steps: 0 };
  let wasLeaping = false;
  for (let t = 0; t < seconds * 60; t++) {
    world.step(1 / 60);
    seen.steps++;
    seen.maxAtOnce = Math.max(seen.maxAtOnce, world.dolphins.length);
    if (world.dolphins.length === 0) seen.empty++;
    const leaping = world.dolphins.some((d) => d.leapT >= 0);
    if (leaping && !wasLeaping) seen.leaps++;
    wasLeaping = leaping;
    for (const d of world.dolphins) {
      seen.scenes.add(d.scene);
      expect(Number.isFinite(d.nodes[0]) && Number.isFinite(d.nodes[1])).toBe(true);
      expect(d.depth).toBeGreaterThanOrEqual(-1e-6);
      expect(d.depth).toBeLessThanOrEqual(1 + 1e-6);
      // Total bend along the body: heading change from head segment to tail segment.
      const a0 = Math.atan2(d.nodes[1] - d.nodes[3], d.nodes[0] - d.nodes[2]);
      const k = NODES - 1;
      const a1 = Math.atan2(d.nodes[(k - 1) * 2 + 1] - d.nodes[k * 2 + 1], d.nodes[(k - 1) * 2] - d.nodes[k * 2]);
      let diff = Math.abs(a0 - a1) % (2 * Math.PI);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      seen.maxBend = Math.max(seen.maxBend, diff);
      // A surfaced dolphin must not drift far off the sea.
      if (d.depth < 0.3 && (d.nodes[0] < -d.length * 0.5 || d.nodes[0] > w + d.length * 0.5)) seen.outOfBounds++;
    }
  }
  return seen;
}

describe("ascii dolphin world", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never has more than two dolphins, and the sea is empty some of the time", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const seen = run(seed, 150);
      expect(seen.maxAtOnce).toBeLessThanOrEqual(2);
      expect(seen.empty).toBeGreaterThan(60); // at least a second of empty sea in 150s
    }
  });

  it("alternates a pair and a lone dolphin, and the lone one leaps", () => {
    const seen = run(7, 200);
    expect(seen.scenes.has("pair")).toBe(true);
    expect(seen.scenes.has("solo")).toBe(true);
    expect(seen.leaps).toBeGreaterThan(0);
  });

  it("bends no more than a real turn would, and stays on the sea while surfaced", () => {
    for (const seed of [11, 12, 13]) {
      const seen = run(seed, 150);
      expect(seen.maxBend).toBeLessThan(2.2); // radians over the whole body
      expect(seen.outOfBounds).toBe(0);
    }
  });

  it("works on a phone-shaped screen", () => {
    const seen = run(21, 120, 390, 800);
    expect(seen.maxAtOnce).toBeLessThanOrEqual(2);
  });
});
