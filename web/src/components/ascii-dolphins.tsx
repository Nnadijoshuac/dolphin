"use client";

/**
 * ASCII DOLPHINS - the empty Dolphin chat's background. (2026-10-20, owner: "do the dolphin version
 * for Dolphin chat", after stackedlol/ascii-sharks.)
 *
 * The idea is borrowed (a simulation rasterised into monospace cells); the code is not. That repo
 * carries no licence, so this is written from scratch for a dolphin seen from above.
 *
 *   1. World: a few dolphins (a head that steers, a follow-the-leader spine) and schools of small
 *      fish (boids). Dolphins chase fish, fish scatter from dolphins and from the pointer, and a
 *      caught fish respawns at the edge. Nothing here is data: it is decoration, and it says so
 *      by never showing a number.
 *   2. Raster: every cell near a dolphin is sampled against a parametric outline (body, melon and
 *      beak, flippers, dorsal ridge, flukes) in body coordinates, five points per cell, so the
 *      silhouette is anti-aliased into edge glyphs.
 *   3. Glyphs: the ramp follows the shading. On a dark page a lit cell is a dense glyph; on a light
 *      page ink is dark, so the ramp flips. Colours are read from the page's own tokens.
 *   4. A wake field diffuses where anything swims and is drawn as faint gold dots (--accent).
 */
import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;
const NODES = 14;
const STEP = 1 / 60;
const RAMP = ".:;t%S8#@";
const EDGE = ".',`:";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const angleDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
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
  return 1.25 * rawHalfWidth(s);
}
function rawHalfWidth(s: number) {
  if (s < 0.07) return 0.02 * Math.sqrt(Math.min(1, s / 0.02));
  if (s < 0.17) return 0.02 + 0.03 * smooth(0.07, 0.17, s);
  if (s < 0.38) return 0.05 + 0.03 * smooth(0.17, 0.38, s);
  if (s < 0.9) return 0.012 + 0.068 * Math.pow(1 - (s - 0.38) / 0.52, 1.3);
  return 0.012;
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

// ── world ───────────────────────────────────────────────────────────────────

interface Dolphin {
  nodes: Float32Array;
  length: number;
  heading: number;
  speed: number;
  phase: number;
  turn: number;
  wander: number;
  hunger: number;
  target: Fish | null;
  retargetAt: number;
}
interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  school: number;
}

class World {
  width = 0;
  height = 0;
  time = 0;
  dolphins: Dolphin[] = [];
  fish: Fish[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** Positions where a fish was just caught; the renderer turns them into a wake burst. */
  catches: { x: number; y: number }[] = [];
  private schools = 5;

  constructor(private dolphinCount: number, private fishPerSchool: number) {}

  resize(w: number, h: number) {
    const first = this.width === 0;
    this.width = w;
    this.height = h;
    const base = clamp(Math.min(w, h * 1.4) * 0.36, 120, 340);
    if (first) this.seed(base);
    else this.dolphins.forEach((d, i) => (d.length = base * (1 - i * 0.16)));
  }

  private seed(base: number) {
    const { width: W, height: H } = this;
    this.dolphins = [];
    for (let i = 0; i < this.dolphinCount; i++) {
      const length = base * (1 - i * 0.16);
      const heading = rand(0, TAU);
      const hx = W * rand(0.2, 0.8);
      const hy = H * rand(0.25, 0.75);
      const nodes = new Float32Array(NODES * 2);
      const gap = length / (NODES - 1);
      for (let k = 0; k < NODES; k++) {
        nodes[k * 2] = hx - Math.cos(heading) * gap * k;
        nodes[k * 2 + 1] = hy - Math.sin(heading) * gap * k;
      }
      this.dolphins.push({
        nodes, length, heading, speed: rand(60, 90), phase: rand(0, TAU), turn: 0,
        wander: 0, hunger: rand(0.2, 0.8), target: null, retargetAt: 0,
      });
    }
    this.fish = [];
    for (let s = 0; s < this.schools; s++) {
      const cx = rand(0.1, 0.9) * W;
      const cy = rand(0.1, 0.9) * H;
      const dir = rand(0, TAU);
      for (let k = 0; k < this.fishPerSchool; k++) {
        const a = dir + rand(-0.3, 0.3);
        const sp = rand(40, 70);
        this.fish.push({ x: cx + rand(-30, 30), y: cy + rand(-20, 20), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, school: s });
      }
    }
  }

  step(dt: number) {
    this.time += dt;
    this.stepFish(dt);
    this.stepDolphins(dt);
  }

  private stepFish(dt: number) {
    const { fish, dolphins, pointer, width: W, height: H } = this;
    // School centroid and mean velocity, one pass.
    const cx = new Float32Array(this.schools);
    const cy = new Float32Array(this.schools);
    const vx = new Float32Array(this.schools);
    const vy = new Float32Array(this.schools);
    const n = new Float32Array(this.schools);
    for (const f of fish) {
      cx[f.school] += f.x; cy[f.school] += f.y; vx[f.school] += f.vx; vy[f.school] += f.vy; n[f.school]++;
    }
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const m = n[f.school] || 1;
      let ax = (cx[f.school] / m - f.x) * 0.5 + (vx[f.school] / m - f.vx) * 1.6;
      let ay = (cy[f.school] / m - f.y) * 0.5 + (vy[f.school] / m - f.vy) * 1.6;
      // Separation from the next few in the list (same school sits together in the array).
      for (let j = Math.max(0, i - 4); j < Math.min(fish.length, i + 5); j++) {
        if (j === i) continue;
        const o = fish[j];
        const dx = f.x - o.x;
        const dy = f.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d < 18 && d > 1e-3) { ax += (dx / d) * (18 - d) * 5; ay += (dy / d) * (18 - d) * 5; }
      }
      // Slow drifting current so the schools wander instead of settling.
      const t = this.time * 0.2 + f.school * 3.1;
      ax += Math.cos(t + f.x * 0.004) * 26;
      ay += Math.sin(t * 1.3 + f.y * 0.004) * 26;
      // Scatter from dolphin heads and the pointer.
      for (const d of dolphins) {
        const dx = f.x - d.nodes[0];
        const dy = f.y - d.nodes[1];
        const dist = Math.hypot(dx, dy);
        if (dist < 150 && dist > 1e-3) { const w = (1 - dist / 150) * 520; ax += (dx / dist) * w; ay += (dy / dist) * w; }
      }
      if (pointer.active) {
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 110 && dist > 1e-3) { const w = (1 - dist / 110) * 420; ax += (dx / dist) * w; ay += (dy / dist) * w; }
      }
      // Stay on screen.
      const edge = 40;
      if (f.x < edge) ax += (edge - f.x) * 9;
      if (f.x > W - edge) ax -= (f.x - (W - edge)) * 9;
      if (f.y < edge) ay += (edge - f.y) * 9;
      if (f.y > H - edge) ay -= (f.y - (H - edge)) * 9;

      f.vx += ax * dt;
      f.vy += ay * dt;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const clamped = clamp(sp, 30, 150);
      f.vx = (f.vx / sp) * clamped;
      f.vy = (f.vy / sp) * clamped;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
  }

  private stepDolphins(dt: number) {
    const { dolphins, fish, width: W, height: H, time } = this;
    for (const d of dolphins) {
      const n = d.nodes;
      const hx = n[0];
      const hy = n[1];
      d.hunger = Math.min(1, d.hunger + dt * 0.04);

      let dx = Math.cos(d.heading);
      let dy = Math.sin(d.heading);
      d.wander = clamp(d.wander + (Math.random() - 0.5) * dt * 3, -1, 1);
      dx += Math.cos(d.heading + d.wander) * 0.5;
      dy += Math.sin(d.heading + d.wander) * 0.5;

      if (time >= d.retargetAt) {
        d.retargetAt = time + 0.5;
        let best: Fish | null = null;
        let bestD = d.length * 2.4;
        for (const f of fish) {
          const dist = Math.hypot(f.x - hx, f.y - hy);
          if (dist < bestD) { bestD = dist; best = f; }
        }
        d.target = best;
      }
      const t = d.target;
      if (t && d.hunger > 0.25) {
        const tx = t.x + t.vx * 0.3 - hx;
        const ty = t.y + t.vy * 0.3 - hy;
        const dist = Math.hypot(tx, ty) || 1;
        const w = 1.2 + 2.2 * d.hunger;
        dx += (tx / dist) * w;
        dy += (ty / dist) * w;
        d.speed = clamp(d.speed + dt * 40, 60, 125);
        if (dist < d.length * 0.09) {
          this.catches.push({ x: t.x, y: t.y });
          t.x = Math.random() < 0.5 ? rand(0, W) : Math.random() < 0.5 ? 0 : W;
          t.y = rand(0, H);
          d.hunger = rand(0, 0.25);
          d.target = null;
        }
      } else {
        d.speed = clamp(d.speed - dt * 25, 55, 125);
      }

      // Keep clear of the edges and of each other.
      const margin = d.length * 0.95;
      if (hx < margin) dx += (margin - hx) / margin * 4;
      if (hx > W - margin) dx -= (hx - (W - margin)) / margin * 4;
      if (hy < margin) dy += (margin - hy) / margin * 4;
      if (hy > H - margin) dy -= (hy - (H - margin)) / margin * 4;
      for (const o of dolphins) {
        if (o === d) continue;
        for (let k = 0; k < NODES; k += 3) {
          const ox = hx - o.nodes[k * 2];
          const oy = hy - o.nodes[k * 2 + 1];
          const dist = Math.hypot(ox, oy);
          const range = (d.length + o.length) * 0.4;
          if (dist < range && dist > 1e-3) { const w = (1 - dist / range) * 3; dx += (ox / dist) * w; dy += (oy / dist) * w; }
        }
      }

      const want = Math.atan2(dy, dx);
      const diff = angleDiff(d.heading, want);
      const maxTurn = 1.3 * dt;
      const turn = clamp(diff, -maxTurn, maxTurn);
      d.heading += turn;
      d.turn += (turn / dt - d.turn) * Math.min(1, dt * 4);

      n[0] = hx + Math.cos(d.heading) * d.speed * dt;
      n[1] = hy + Math.sin(d.heading) * d.speed * dt;
      const gap = d.length / (NODES - 1);
      for (let k = 1; k < NODES; k++) {
        const px = n[(k - 1) * 2];
        const py = n[(k - 1) * 2 + 1];
        let vx = n[k * 2] - px;
        let vy = n[k * 2 + 1] - py;
        const l = Math.hypot(vx, vy) || 1;
        vx = (vx / l) * gap;
        vy = (vy / l) * gap;
        n[k * 2] = px + vx;
        n[k * 2 + 1] = py + vy;
      }
      d.phase += dt * (3 + d.speed * 0.035);
    }
  }
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

class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cw = 10;
  private ch = 15;
  private cols = 0;
  private rows = 0;
  private flag = new Uint8Array(0);
  private shade = new Float32Array(0);
  private key = new Uint32Array(0);
  private energy = new Float32Array(0);
  private tmp = new Float32Array(0);
  private spine = new Float32Array(NODES * 2);
  private arc = new Float32Array(NODES);
  private palette: Palette = { ink: [23, 24, 19], accent: [240, 185, 11], dark: false };
  private fontFamily = "ui-monospace, Menlo, monospace";
  // sampleShape scratch outputs.
  private hFlag = 0;
  private hShade = 0;
  private hS = 0;
  private hV = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  get cellWidth() { return this.cw; }
  get cellHeight() { return this.ch; }

  setPalette(p: Palette) { this.palette = p; }
  setFont(f: string) { if (f) this.fontFamily = f; }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.cw = clamp(Math.round(w / 150), 6, 10);
    this.ch = Math.round(this.cw * 1.5);
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.ch);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const n = this.cols * this.rows;
    this.flag = new Uint8Array(n);
    this.shade = new Float32Array(n);
    this.key = new Uint32Array(n);
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
        bv = ((px - ax) * -bdy + (py - ay) * bdx);
      }
    }
    // Spine runs head-to-tail in node order, so the beak is s = 0.
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
      // Back is lightest down the middle; the flank away from the light darkens.
      const nx = -bdy * sign;
      const ny = bdx * sign;
      const facing = nx * LIGHT[0] + ny * LIGHT[1];
      lit = clamp(0.5 + 0.38 * (1 - av / hw) + 0.22 * facing, 0, 1);
      if (bs > RIDGE.from && bs < RIDGE.to && av < RIDGE.half * L) { flag = FLAG_RIDGE; lit = 0.95; }
      if (Math.abs(bs - EYE.s) < 0.012 && Math.abs(av - EYE.v * L) < 0.01 * L) flag = FLAG_EYE;
    } else {
      // Pectoral flippers: a swept triangle on each side, the inner one foreshortened in a turn.
      const reach = L * FLIPPER.reach * (1 + sign * bank);
      const root = halfWidth(FLIPPER.lead) * L;
      const f = FLIPPER;
      if (
        inTriangle(
          along, av,
          f.lead * L, root,
          f.trail * L, halfWidth(f.trail) * L,
          f.tip * L, root + reach,
        )
      ) {
        flag = FLAG_FIN;
        lit = clamp(0.42 + 0.2 * (nxFacing(bdx, bdy, sign)), 0, 1);
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

  private fillWake(world: World) {
    const { energy, cols, rows, cw, ch } = this;
    const put = (x: number, y: number, amount: number) => {
      const c = Math.floor(x / cw);
      const r = Math.floor(y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c;
      energy[i] = Math.min(1, energy[i] + amount);
    };
    for (const f of world.fish) put(f.x, f.y, 0.08);
    for (const d of world.dolphins) {
      for (let k = 0; k < NODES; k += 2) put(d.nodes[k * 2], d.nodes[k * 2 + 1], 0.35);
    }
    for (const c of world.catches) {
      for (let a = 0; a < 16; a++) put(c.x + Math.cos((a / 16) * TAU) * 22, c.y + Math.sin((a / 16) * TAU) * 14, 0.9);
    }
    world.catches.length = 0;
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
    const { flag, shade, key, spine, arc, cw, ch, cols, rows } = this;
    flag.fill(0);
    world.dolphins.forEach((d, id) => {
      const L = d.length;
      const n = d.nodes;
      const swim = clamp(d.speed / 80, 0.5, 1.4);
      for (let k = 0; k < NODES; k++) {
        const s = k / (NODES - 1);
        const a = Math.max(0, k - 1);
        const b = Math.min(NODES - 1, k + 1);
        let tx = n[a * 2] - n[b * 2];
        let ty = n[a * 2 + 1] - n[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        // Lateral wave grows toward the tail, like a fluke stroke.
        const off = L * 0.045 * (0.08 + 0.92 * Math.pow(s, 1.7)) * swim * Math.sin(d.phase - s * 4.6);
        spine[k * 2] = n[k * 2] - ty * off;
        spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
      }
      arc[0] = 0;
      for (let k = 1; k < NODES; k++) {
        arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
      }
      const bank = clamp(d.turn * 0.25, -0.3, 0.3);

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < NODES; k++) {
        minX = Math.min(minX, spine[k * 2]); maxX = Math.max(maxX, spine[k * 2]);
        minY = Math.min(minY, spine[k * 2 + 1]); maxY = Math.max(maxY, spine[k * 2 + 1]);
      }
      const reach = L * 0.2;
      const c0 = Math.max(0, Math.floor((minX - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
      const r0 = Math.max(0, Math.floor((minY - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw;
          const y = r * ch;
          const centre = this.sample(x + cw / 2, y + ch / 2, L, bank);
          const f0 = this.hFlag;
          const l0 = this.hShade;
          const s0 = this.hS;
          const v0 = this.hV;
          let hits = centre ? 1 : 0;
          for (let q = 0; q < SUB.length; q += 2) if (this.sample(x + SUB[q] * cw, y + SUB[q + 1] * ch, L, bank)) hits++;
          if (hits === 0) continue;
          const i = r * cols + c;
          key[i] = (hash(Math.round(s0 * 48), Math.round(v0 / (cw * 0.9)), id) * 4294967295) >>> 0;
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

  render(world: World, dt: number) {
    const { ctx, dpr, cols, rows, cw, ch, flag, shade, key, energy, palette } = this;
    if (cols === 0) return;
    this.raster(world);
    this.fillWake(world);
    this.diffuse(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cw, rows * ch);
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
        const col = i % cols;
        const row = (i / cols) | 0;
        ctx.fillRect(col * cw + cw / 2 - 1, row * ch + ch / 2 - 1, 2, 2);
      }
    }

    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Fish: a ><> glyph facing the way it swims.
    ctx.fillStyle = `rgba(${ir},${ig},${ib},0.55)`;
    for (const f of world.fish) {
      const a = Math.atan2(f.vy, f.vx);
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const g = Math.abs(sy) > 0.85 ? (sy > 0 ? "v" : "^") : cx > 0 ? ">" : "<";
      ctx.fillText(g, f.x, f.y);
    }

    // Dolphins, one bucket of alpha per glyph density so fillStyle changes stay few.
    const dark = palette.dark;
    for (let i = 0; i < flag.length; i++) {
      const fl = flag[i];
      if (!fl) continue;
      const x = (i % cols) * cw + cw / 2;
      const y = ((i / cols) | 0) * ch + ch / 2;
      const k = key[i];
      if (fl === FLAG_EYE) {
        ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
        ctx.fillText("o", x, y);
        continue;
      }
      if (fl === FLAG_EDGE) {
        const cov = shade[i];
        ctx.fillStyle = `rgba(${ir},${ig},${ib},${(0.35 + cov * 0.5).toFixed(2)})`;
        ctx.fillText(EDGE[k % EDGE.length], x, y);
        continue;
      }
      const lit = shade[i];
      // On a dark page lit = dense = bright; on a light page ink is dark, so the ramp flips.
      const density = dark ? lit : 1 - lit;
      const idx = clamp(Math.round(density * (RAMP.length - 1)) + (k % 3) - 1, 0, RAMP.length - 1);
      if (fl === FLAG_RIDGE) ctx.fillStyle = `rgba(${ar},${ag},${ab},0.9)`;
      else if (fl === FLAG_FLUKE) ctx.fillStyle = `rgba(${ir},${ig},${ib},0.6)`;
      else ctx.fillStyle = `rgba(${ir},${ig},${ib},${(0.6 + lit * 0.4).toFixed(2)})`;
      ctx.fillText(RAMP[idx], x, y);
    }
  }
}

function nxFacing(dx: number, dy: number, sign: number) {
  return (-dy * sign) * LIGHT[0] + dx * sign * LIGHT[1];
}

// ── component ───────────────────────────────────────────────────────────────

/** Needs a monospace font on the canvas (give it `font-mono`). Decorative: `aria-hidden`. */
export function AsciiDolphins({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const narrow = window.innerWidth < 640;
    const world = new World(narrow ? 2 : 3, narrow ? 9 : 13);
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
      // Let the pod settle for a few seconds of simulated time, then show one frame.
      if (world.time < 4) for (let i = 0; i < 240; i++) world.step(STEP);
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
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      world.pointer.x = e.clientX - rect.left;
      world.pointer.y = e.clientY - rect.top;
      world.pointer.active = e.pointerType !== "touch";
    };
    const onLeave = () => { world.pointer.active = false; };
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
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);
    document.documentElement.addEventListener("pointerleave", onLeave);

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
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas aria-hidden="true" className={`pointer-events-none font-mono ${className ?? ""}`} ref={canvasRef} />;
}
