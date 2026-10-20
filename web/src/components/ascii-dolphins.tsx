"use client";

/**
 * ASCII DOLPHINS - the empty Dolphin chat's background, a top-down view of the sea.
 * (2026-10-20, owner: "do the dolphin version for Dolphin chat", after stackedlol/ascii-sharks.)
 *
 * The idea is borrowed (a simulation rasterised into monospace cells); the code is not. That repo
 * carries no licence, so this is written from scratch for a dolphin seen from above.
 *
 *   World (ascii-dolphins-world.ts): a pair swims across, or a lone dolphin roams, leaps and turns
 *   back at the ends of the sea; between scenes the sea is empty. Dolphins rise from below, so each
 *   has a depth: faint and wobbling far down, crisp on the surface.
 *   Water: slow swells drawn as sparse "~" and "." over the whole sea, so empty water still reads
 *   as water.
 *   Raster: every cell near a dolphin is sampled against a parametric outline (body, melon and
 *   beak, flippers, dorsal ridge, flukes) in body coordinates, five points per cell, so the
 *   silhouette is anti-aliased into edge glyphs. A leaping dolphin grows, casts a shadow on the
 *   water and lands in a burst of spray. (No rings around it: owner, 2026-10-20, "water ripple is
 *   not perfect circles"; the wavy swell over the whole sea is what he liked.)
 *   Glyphs: the ramp follows the shading. On a dark page a lit cell is a dense glyph; on a light
 *   page ink is dark, so the ramp flips. Colours come from the page's own tokens.
 *
 * Nothing here is data. It is decoration, and it never shows a number.
 */
import { useEffect, useRef } from "react";

import { clamp, NODES, TAU, World, type Dolphin } from "./ascii-dolphins-world";

const STEP = 1 / 60;
const RAMP = ".:;t%S8#@";
const EDGE = ".',`:";

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Deterministic cell hash in [0, 1), so a glyph stays put on the skin it was picked for. */
function hash(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── outline ─────────────────────────────────────────────────────────────────
// Everything below is a fraction of body length, s running beak (0) to fluke tips (1).

/** Bottlenose seen from above: a slim beak, the melon swelling behind it, widest a third back. */
function halfWidth(s: number) {
  let w: number;
  if (s < 0.07) w = 0.02 * Math.sqrt(Math.min(1, s / 0.02));
  else if (s < 0.17) w = 0.02 + 0.03 * smooth(0.07, 0.17, s);
  else if (s < 0.38) w = 0.05 + 0.03 * smooth(0.17, 0.38, s);
  else if (s < 0.9) w = 0.012 + 0.068 * Math.pow(1 - (s - 0.38) / 0.52, 1.3);
  else w = 0.012;
  return 1.25 * w;
}
const FLIPPER = { lead: 0.27, trail: 0.4, tip: 0.47, reach: 0.1 };
const FLUKE = { root: 0.87, notch: 0.955, tip: 1, span: 0.15 };
const RIDGE = { from: 0.38, to: 0.5, half: 0.011 };
const EYE = { s: 0.115, v: 0.043 };

function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// ── renderer ────────────────────────────────────────────────────────────────

interface Palette {
  ink: [number, number, number];
  accent: [number, number, number];
  dark: boolean;
}

function parseColour(raw: string, fallback: [number, number, number]): [number, number, number] {
  const hex = raw.trim().replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  if (/^[0-9a-f]{3}$/i.test(hex)) return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  return fallback;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const canvas = parseColour(css.getPropertyValue("--canvas"), [244, 243, 237]);
  return {
    ink: parseColour(css.getPropertyValue("--ink"), [23, 24, 19]),
    accent: parseColour(css.getPropertyValue("--accent"), [240, 185, 11]),
    dark: (canvas[0] * 0.299 + canvas[1] * 0.587 + canvas[2] * 0.114) / 255 < 0.5,
  };
}

const FLAG_BODY = 1;
const FLAG_EDGE = 2;
const FLAG_FIN = 3;
const FLAG_RIDGE = 4;
const FLAG_EYE = 5;
const FLAG_FLUKE = 6;
const SUB = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
const LIGHT = [-0.6, -0.8];
const SPRAY = "'`*.";

class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cw = 8;
  private ch = 12;
  private cols = 0;
  private rows = 0;
  private flag = new Uint8Array(0);
  private shade = new Float32Array(0);
  private key = new Uint32Array(0);
  /** Per cell: how visible the dolphin is (1 on the surface, faint far below) and how high it is leaping. */
  private vis = new Float32Array(0);
  private lift = new Float32Array(0);
  private energy = new Float32Array(0);
  private tmp = new Float32Array(0);
  private spine = new Float32Array(NODES * 2);
  private arc = new Float32Array(NODES);
  private palette: Palette = { ink: [23, 24, 19], accent: [240, 185, 11], dark: false };
  private ripple = document.createElement("canvas");
  private rippleAt = -1;
  private fontFamily = "ui-monospace, Menlo, monospace";
  // sample() scratch outputs.
  private hFlag = 0;
  private hShade = 0;
  private hS = 0;
  private hV = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  setPalette(p: Palette) { this.palette = p; this.rippleAt = -1; }
  setFont(f: string) { if (f) this.fontFamily = f; }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.cw = clamp(Math.round(w / 150), 6, 10);
    this.ch = Math.round(this.cw * 1.5);
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.ch);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ripple.width = this.canvas.width;
    this.ripple.height = this.canvas.height;
    this.rippleAt = -1;
    const n = this.cols * this.rows;
    this.flag = new Uint8Array(n);
    this.shade = new Float32Array(n);
    this.key = new Uint32Array(n);
    this.vis = new Float32Array(n);
    this.lift = new Float32Array(n);
    this.energy = new Float32Array(n);
    this.tmp = new Float32Array(n);
  }

  /**
   * Where does (px, py) fall on a dolphin? Finds the nearest spine segment, turns the point into
   * body coordinates (s along, v across) and tests the outline there. Writes hFlag/hShade/hS/hV.
   */
  private sample(px: number, py: number, L: number, bank: number): boolean {
    const { spine, arc } = this;
    const total = arc[NODES - 1] || 1;
    let best = Infinity;
    let bs = 0;
    let bv = 0;
    let bdx = 1;
    let bdy = 0;
    for (let k = 0; k < NODES - 1; k++) {
      const ax = spine[k * 2];
      const ay = spine[k * 2 + 1];
      const ex = spine[k * 2 + 2] - ax;
      const ey = spine[k * 2 + 3] - ay;
      const len2 = ex * ex + ey * ey || 1;
      const raw = ((px - ax) * ex + (py - ay) * ey) / len2;
      const t = clamp(raw, 0, 1);
      // Past the tail the flukes still need an along-body coordinate, so the last segment runs on.
      const tAlong = k === NODES - 2 ? clamp(raw, 0, 1.4) : t;
      const qx = ax + ex * t - px;
      const qy = ay + ey * t - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bdx = ex / len;
        bdy = ey / len;
        bs = (arc[k] + (arc[k + 1] - arc[k]) * tAlong) / total;
        // Lateral offset: signed, positive to the spine direction's left.
        bv = (px - ax) * -bdy + (py - ay) * bdx;
      }
    }
    // The spine runs head-to-tail in node order, so the beak is s = 0.
    const along = bs * L;
    const hw = halfWidth(bs) * L;
    const av = Math.abs(bv);
    const sign = bv < 0 ? -1 : 1;
    this.hS = bs;
    this.hV = bv;
    let flag = 0;
    let lit = 0;

    if (bs <= 1 && av < hw) {
      flag = FLAG_BODY;
      // The back is lightest down the middle; the flank away from the light darkens.
      const nx = -bdy * sign;
      const ny = bdx * sign;
      const facing = nx * LIGHT[0] + ny * LIGHT[1];
      lit = clamp(0.5 + 0.38 * (1 - av / hw) + 0.22 * facing, 0, 1);
      if (bs > RIDGE.from && bs < RIDGE.to && av < RIDGE.half * L) { flag = FLAG_RIDGE; lit = 0.95; }
      if (Math.abs(bs - EYE.s) < 0.012 && Math.abs(av - EYE.v * L) < 0.01 * L) flag = FLAG_EYE;
    } else {
      // Pectoral flippers: a swept triangle each side, the inner one foreshortened in a turn.
      const f = FLIPPER;
      const reach = L * f.reach * (1 + sign * bank);
      const root = halfWidth(f.lead) * L;
      if (inTriangle(along, av, f.lead * L, root, f.trail * L, halfWidth(f.trail) * L, f.tip * L, root + reach)) {
        flag = FLAG_FIN;
        lit = clamp(0.42 + 0.2 * ((-bdy * sign) * LIGHT[0] + bdx * sign * LIGHT[1]), 0, 1);
      } else {
        // Flukes: two swept blades off the tail stock, notched in the middle.
        const k = FLUKE;
        if (inTriangle(along, av, k.root * L, 0, k.tip * L, k.span * L, k.notch * L, 0)) {
          flag = FLAG_FLUKE;
          lit = 0.4 + 0.25 * (av / (k.span * L));
        }
      }
    }
    this.hFlag = flag;
    this.hShade = lit;
    return flag !== 0;
  }

  /**
   * The sea itself: sparse "~" and "." that drift as two crossing swells pass over the grid, so
   * the water reads as water where nothing is swimming. Painted to its own layer at about 12 fps
   * (it moves slowly) and blitted every frame.
   */
  private paintRipples(t: number) {
    const g = this.ripple.getContext("2d");
    if (!g) return;
    const { cols, rows, cw, ch, palette } = this;
    const [ir, ig, ib] = palette.ink;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ripple.width, this.ripple.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.font = `500 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const strength = palette.dark ? 1 : 1.25;
    const bands: [string, string][] = [
      ["~", `rgba(${ir},${ig},${ib},${(0.17 * strength).toFixed(2)})`],
      ["~", `rgba(${ir},${ig},${ib},${(0.1 * strength).toFixed(2)})`],
      [".", `rgba(${ir},${ig},${ib},${(0.11 * strength).toFixed(2)})`],
    ];
    for (let b = 0; b < bands.length; b++) {
      g.fillStyle = bands[b][1];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Long crests running across the screen, bent slowly along their length, like swell.
          const v =
            Math.sin(r * 0.72 + t * 0.6 + 2.4 * Math.sin(c * 0.06 + t * 0.18)) +
            Math.sin(r * 0.45 - t * 0.4 + 1.9 * Math.sin(c * 0.04 - t * 0.12 + 1.3));
          const band = v > 1.75 ? 0 : v > 1.5 ? 1 : v > 1.3 ? 2 : -1;
          if (band === b) g.fillText(bands[b][0], c * cw + cw / 2, r * ch + ch / 2);
        }
      }
    }
    this.rippleAt = t;
  }

  /** A gold wake behind anything on the surface, fading as the dolphin sinks. */
  private fillWake(world: World) {
    const { energy, cols, rows, cw, ch } = this;
    for (const d of world.dolphins) {
      const amount = 0.35 * (1 - d.depth) + 0.04;
      for (let k = 0; k < NODES; k += 2) {
        const c = Math.floor(d.nodes[k * 2] / cw);
        const r = Math.floor(d.nodes[k * 2 + 1] / ch);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        energy[i] = Math.min(1, energy[i] + amount);
      }
    }
  }

  private diffuse(dt: number) {
    const { energy, tmp, cols, rows } = this;
    const decay = Math.exp(-dt * 2.2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const sum =
          (c > 0 ? energy[i - 1] : 0) + (c < cols - 1 ? energy[i + 1] : 0) +
          (r > 0 ? energy[i - cols] : 0) + (r < rows - 1 ? energy[i + cols] : 0);
        tmp[i] = (energy[i] * 0.6 + sum * 0.1) * decay;
      }
    }
    energy.set(tmp);
  }

  private raster(world: World) {
    const { flag, shade, key, vis, lift, spine, arc, cw, ch, cols, rows } = this;
    flag.fill(0);
    world.dolphins.forEach((d: Dolphin, id) => {
      const L = d.length;
      const n = d.nodes;
      const air = d.lift;
      // Airborne, it is closer to the camera: a little bigger, and it stops beating its tail.
      const grow = 1 + 0.22 * air;
      const amp = L * 0.055 * (1 - 0.7 * air);
      const mid = NODES >> 1;
      const cx = n[mid * 2];
      const cy = n[mid * 2 + 1];
      for (let k = 0; k < NODES; k++) {
        const s = k / (NODES - 1);
        const a = Math.max(0, k - 1);
        const b = Math.min(NODES - 1, k + 1);
        let tx = n[a * 2] - n[b * 2];
        let ty = n[a * 2 + 1] - n[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        // A travelling wave that grows toward the tail, with the head swaying against it.
        const wave = Math.sin(d.phase - s * 4.2);
        const sway = 0.14 * Math.pow(1 - s, 2) * Math.sin(d.phase - s * 4.2 + Math.PI);
        const off = amp * (0.06 + 0.94 * Math.pow(s, 1.6)) * wave + amp * sway;
        const x = n[k * 2] - ty * off;
        const y = n[k * 2 + 1] + tx * off;
        spine[k * 2] = cx + (x - cx) * grow;
        spine[k * 2 + 1] = cy + (y - cy) * grow;
      }
      arc[0] = 0;
      for (let k = 1; k < NODES; k++) {
        arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
      }
      const Ls = L * grow;
      const bank = clamp(d.omega * 0.5, -0.3, 0.3);
      const visibility = air > 0.02 ? 1 : 1 - 0.82 * d.depth;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < NODES; k++) {
        minX = Math.min(minX, spine[k * 2]); maxX = Math.max(maxX, spine[k * 2]);
        minY = Math.min(minY, spine[k * 2 + 1]); maxY = Math.max(maxY, spine[k * 2 + 1]);
      }
      const reach = Ls * 0.22;
      const c0 = Math.max(0, Math.floor((minX - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
      const r0 = Math.max(0, Math.floor((minY - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw;
          const y = r * ch;
          const centre = this.sample(x + cw / 2, y + ch / 2, Ls, bank);
          const f0 = this.hFlag;
          const l0 = this.hShade;
          const s0 = this.hS;
          const v0 = this.hV;
          let hits = centre ? 1 : 0;
          for (let q = 0; q < SUB.length; q += 2) if (this.sample(x + SUB[q] * cw, y + SUB[q + 1] * ch, Ls, bank)) hits++;
          if (hits === 0) continue;
          const i = r * cols + c;
          key[i] = (hash(Math.round(s0 * 48), Math.round(v0 / (cw * 0.9)), id) * 4294967295) >>> 0;
          vis[i] = visibility;
          lift[i] = air;
          if (centre && hits >= 4) {
            flag[i] = f0;
            shade[i] = clamp(l0 + (hash(c, r, Math.floor(world.time * 6)) - 0.5) * 0.06, 0, 1);
          } else {
            flag[i] = FLAG_EDGE;
            shade[i] = hits / 5;
          }
        }
      }
    });
  }

  /** Gold spray flung outward in the first moments of a splash. */
  private drawSpray(world: World) {
    const { ctx, palette } = this;
    const [ar, ag, ab] = palette.accent;
    for (const s of world.splashes) {
      const a = world.time - s.t0;
      if (a > 0.9) continue;
      const id = Math.floor(s.t0 * 1000);
      const fade = 1 - a / 0.9;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},${(fade * 0.85).toFixed(2)})`;
      for (let p = 0; p < 12; p++) {
        const ang = hash(p, id, 5) * TAU;
        const speed = (50 + hash(p, id, 9) * 130) * (s.size / 150);
        ctx.fillText(SPRAY[p % SPRAY.length], s.x + Math.cos(ang) * speed * a, s.y + Math.sin(ang) * speed * a);
      }
    }
  }

  render(world: World, dt: number) {
    const { ctx, dpr, cols, rows, cw, ch, flag, shade, key, vis, lift, energy, palette } = this;
    if (cols === 0) return;
    if (this.rippleAt < 0 || world.time - this.rippleAt > 0.08) this.paintRipples(world.time);
    this.raster(world);
    this.fillWake(world);
    this.diffuse(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cw, rows * ch);
    ctx.drawImage(this.ripple, 0, 0, cols * cw, rows * ch);
    const [ir, ig, ib] = palette.ink;
    const [ar, ag, ab] = palette.accent;

    // Wake: faint gold dots, five alpha buckets so each is one fillStyle.
    for (let b = 1; b <= 5; b++) {
      const lo = b * 0.06;
      const hi = b === 5 ? 2 : (b + 1) * 0.06;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},${(b * 0.09).toFixed(2)})`;
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i];
        if (e < lo || e >= hi || flag[i]) continue;
        ctx.fillRect((i % cols) * cw + cw / 2 - 1, ((i / cols) | 0) * ch + ch / 2 - 1, 2, 2);
      }
    }

    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // A leaping dolphin's shadow on the water, thrown away from the light and growing with height.
    for (let i = 0; i < flag.length; i++) {
      const air = lift[i];
      if (!flag[i] || air < 0.05 || flag[i] === FLAG_EDGE) continue;
      const off = air * 26;
      ctx.fillStyle = `rgba(${ir},${ig},${ib},${(0.2 * air).toFixed(2)})`;
      ctx.fillText(".", (i % cols) * cw + cw / 2 - LIGHT[0] * off, ((i / cols) | 0) * ch + ch / 2 - LIGHT[1] * off);
    }

    const dark = palette.dark;
    const t = world.time;
    for (let i = 0; i < flag.length; i++) {
      const fl = flag[i];
      if (!fl) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      const v = vis[i];
      const deep = v < 0.6;
      // Far below the surface the shape wobbles, as if seen through moving water.
      const wob = deep ? (1 - v) * 2.2 * Math.sin(t * 2.2 + row * 0.7) : 0;
      const x = col * cw + cw / 2 + wob;
      const y = row * ch + ch / 2;
      const k = key[i];
      if (fl === FLAG_EYE && !deep) {
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
        ctx.fillText("o", x, y);
        continue;
      }
      if (fl === FLAG_EDGE) {
        ctx.fillStyle = `rgba(${ir},${ig},${ib},${((0.35 + shade[i] * 0.5) * v).toFixed(2)})`;
        ctx.fillText(EDGE[k % EDGE.length], x, y);
        continue;
      }
      const lit = shade[i];
      // On a dark page lit = dense = bright; on a light page ink is dark, so the ramp flips.
      const density = dark ? lit : 1 - lit;
      let idx = clamp(Math.round(density * (RAMP.length - 1)) + (k % 3) - 1, 0, RAMP.length - 1);
      if (deep) idx = Math.min(idx, 3);
      if (fl === FLAG_RIDGE && !deep) ctx.fillStyle = `rgba(${ar},${ag},${ab},${(0.9 * v).toFixed(2)})`;
      else if (fl === FLAG_FLUKE) ctx.fillStyle = `rgba(${ir},${ig},${ib},${(0.6 * v).toFixed(2)})`;
      else ctx.fillStyle = `rgba(${ir},${ig},${ib},${((0.6 + lit * 0.4) * v).toFixed(2)})`;
      ctx.fillText(RAMP[idx], x, y);
    }
    this.drawSpray(world);
  }
}

// ── component ───────────────────────────────────────────────────────────────

/** Soft edges, so the sea fades into the page instead of ending in a hard rectangle. */
const FADE = "radial-gradient(ellipse 85% 80% at 50% 50%, #000 55%, transparent 100%)";

/** Needs a monospace font on the canvas (give it `font-mono`). Decorative: `aria-hidden`. */
export function AsciiDolphins({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const world = new World();
    const renderer = new Renderer(canvas);
    renderer.setFont(getComputedStyle(canvas).fontFamily);
    renderer.setPalette(readPalette());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    let last = 0;
    let acc = 0;
    let visible = true;
    let disposed = false;

    const drawStill = () => {
      // Let the pod settle for a moment of simulated time, then show one frame.
      if (world.time < 3) for (let i = 0; i < 180; i++) world.step(STEP);
      renderer.render(world, STEP);
    };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 4) { world.step(STEP); acc -= STEP; steps++; }
      if (steps === 4) acc = 0;
      renderer.render(world, dt);
      raf = requestAnimationFrame(frame);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      if (disposed || !visible || document.hidden || reduced.matches) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
      world.resize(rect.width, rect.height);
      if (reduced.matches) drawStill();
    };
    const repaint = () => {
      renderer.setPalette(readPalette());
      if (reduced.matches) renderer.render(world, STEP);
    };
    const onMotion = () => (reduced.matches ? (cancelAnimationFrame(raf), drawStill()) : schedule());

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
    intersection.observe(canvas);
    // The page's theme can flip while this is mounted: re-read the tokens when it does.
    const themeObserver = new MutationObserver(repaint);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", repaint);
    reduced.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", schedule);

    resize();
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener("change", repaint);
      reduced.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      className={`pointer-events-none font-mono ${className ?? ""}`}
      ref={canvasRef}
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
    />
  );
}
