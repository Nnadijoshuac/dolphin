/**
 * The simulation behind the ASCII dolphins (see ascii-dolphins.tsx). Pure: no canvas, no DOM, so it
 * can be run in a test. Positions are CSS pixels; the sea is seen from directly above.
 *
 * Two scenes alternate with an empty sea between them (owner, 2026-10-20):
 *   pair - two dolphins rise from below on one edge, swim together across the sea, and dive again
 *          before the far edge. They leap together once in a while.
 *   solo - one dolphin rises, roams between the two ends of the sea, turns back as it nears each
 *          end, leaps (once or twice), then dives and leaves.
 *
 * `depth` is how far under the surface a dolphin is: 1 is a faint shape far below, 0 is on the
 * surface in full detail. `lift` is how far above the water it is during a leap.
 */

export const TAU = Math.PI * 2;
export const NODES = 16;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export interface Splash {
  x: number;
  y: number;
  t0: number;
  /** Radius scale in px. */
  size: number;
}

type State = "arrive" | "cruise" | "depart";
type Scene = "pair" | "solo";
interface Point {
  x: number;
  y: number;
}

export interface Dolphin {
  nodes: Float32Array;
  length: number;
  sizeFactor: number;
  heading: number;
  /** Cruise speed in px/s (about a third of a body length per second). */
  speed: number;
  /** Tail-beat phase, radians. */
  phase: number;
  /** Turn rate, rad/s, smoothed so a turn starts and ends gently. */
  omega: number;
  maxTurn: number;
  seed: number;
  depth: number;
  depthTarget: number;
  lift: number;
  /** Seconds into the current leap, or -1 when not leaping. */
  leapT: number;
  leapDur: number;
  state: State;
  scene: Scene;
  entered: boolean;
  age: number;
  /** Followers swim off a leader's shoulder; slot is the side (+1 / -1). */
  leader: Dolphin | null;
  slot: number;
  followLeapDone: boolean;
  target: Point;
  dirX: number;
  legsLeft: number;
  leapsLeft: number;
  nextLeapAt: number;
}

export class World {
  width = 0;
  height = 0;
  time = 0;
  dolphins: Dolphin[] = [];
  splashes: Splash[] = [];
  /** Small drops that ring out across the whole sea, so empty water still moves like water. */
  drops: Splash[] = [];
  private baseLength = 200;
  private nextSceneAt = 0;
  private nextScene: Scene = "pair";

  resize(w: number, h: number) {
    const first = this.width === 0;
    this.width = w;
    this.height = h;
    this.baseLength = clamp(Math.min(w, h * 1.4) * 0.3, 110, 300);
    if (first) {
      this.spawn("pair", true);
      this.nextScene = "solo";
    } else {
      for (const d of this.dolphins) d.length = this.baseLength * d.sizeFactor;
    }
  }

  step(dt: number) {
    this.time += dt;
    while (this.splashes.length && this.time - this.splashes[0].t0 > 2.4) this.splashes.shift();
    while (this.drops.length && this.time - this.drops[0].t0 > 3.2) this.drops.shift();
    if (this.width > 0 && Math.random() < dt * 3) {
      this.drops.push({ x: rand(0, this.width), y: rand(0, this.height), t0: this.time, size: rand(16, 46) });
    }
    if (this.dolphins.length === 0 && this.time >= this.nextSceneAt) {
      this.spawn(this.nextScene, false);
      this.nextScene = this.nextScene === "pair" ? "solo" : "pair";
    }
    for (let i = this.dolphins.length - 1; i >= 0; i--) {
      const d = this.dolphins[i];
      this.drive(d, dt);
      if (this.shouldRemove(d)) this.dolphins.splice(i, 1);
    }
    if (this.dolphins.length === 0 && this.nextSceneAt <= this.time) this.nextSceneAt = this.time + rand(4, 9);
  }

  private splash(x: number, y: number, size: number) {
    this.splashes.push({ x, y, t0: this.time, size });
  }

  private make(hx: number, hy: number, heading: number, sizeFactor: number, scene: Scene, settled: boolean): Dolphin {
    const length = this.baseLength * sizeFactor;
    const nodes = new Float32Array(NODES * 2);
    const gap = length / (NODES - 1);
    for (let k = 0; k < NODES; k++) {
      nodes[k * 2] = hx - Math.cos(heading) * gap * k;
      nodes[k * 2 + 1] = hy - Math.sin(heading) * gap * k;
    }
    return {
      nodes, length, sizeFactor, heading,
      speed: length * rand(0.32, 0.38),
      phase: rand(0, TAU), omega: 0, maxTurn: scene === "solo" ? 0.5 : 0.32, seed: rand(0, TAU),
      depth: settled ? 0 : 1, depthTarget: settled ? 0 : 1, lift: 0, leapT: -1, leapDur: rand(1.5, 1.9),
      state: settled ? "cruise" : "arrive", scene, entered: settled, age: 0,
      leader: null, slot: 1, followLeapDone: false,
      target: { x: hx + Math.cos(heading) * 1000, y: hy + Math.sin(heading) * 1000 },
      dirX: Math.cos(heading) >= 0 ? 1 : -1, legsLeft: 0, leapsLeft: 0, nextLeapAt: 0,
    };
  }

  /** A point in the far end of the sea from `from`, along its longer side. */
  private pickTarget(from: Point): Point {
    const { width: W, height: H } = this;
    const toFar = from.x < W / 2;
    return { x: toFar ? rand(0.68, 0.9) * W : rand(0.1, 0.32) * W, y: rand(0.2, 0.8) * H };
  }

  private spawn(scene: Scene, settled: boolean) {
    const { width: W, height: H } = this;
    const fromLeft = Math.random() < 0.5;
    const dirX = fromLeft ? 1 : -1;
    if (scene === "pair") {
      const y0 = H * rand(0.25, 0.75);
      const y1 = H * rand(0.25, 0.75);
      const aim = Math.atan2(y1 - y0, W * dirX);
      const x0 = settled ? (fromLeft ? W * rand(0.15, 0.4) : W * rand(0.6, 0.85)) : fromLeft ? -30 : W + 30;
      const yAt = settled ? y0 + (y1 - y0) * (Math.abs(x0 - (fromLeft ? 0 : W)) / W) : y0;
      const leader = this.make(x0, yAt, aim, 1, "pair", settled);
      leader.target = { x: fromLeft ? W * 1.8 : -W * 0.8, y: y1 + (y1 - y0) * 0.8 };
      leader.leapsLeft = Math.random() < 0.6 ? 1 : 0;
      leader.nextLeapAt = this.time + rand(5, 8);
      const slot = Math.random() < 0.5 ? 1 : -1;
      const f = 0.85;
      const L = leader.length * f;
      const fx = x0 - Math.cos(aim) * 0.5 * L - Math.sin(aim) * 0.85 * L * slot;
      const fy = yAt - Math.sin(aim) * 0.5 * L + Math.cos(aim) * 0.85 * L * slot;
      const follower = this.make(fx, fy, aim, f, "pair", settled);
      follower.leader = leader;
      follower.slot = slot;
      this.dolphins.push(leader, follower);
    } else {
      const y0 = H * rand(0.25, 0.75);
      const x0 = fromLeft ? -30 : W + 30;
      const first = this.pickTarget({ x: x0, y: y0 });
      const heading = Math.atan2(first.y - y0, first.x - x0);
      const d = this.make(x0, y0, heading, 1, "solo", false);
      d.target = first;
      d.legsLeft = 2 + Math.floor(rand(0, 2));
      d.leapsLeft = 1 + Math.floor(rand(0, 2));
      d.nextLeapAt = this.time + rand(7, 10);
      this.dolphins.push(d);
    }
  }

  private startLeap(d: Dolphin, dur?: number) {
    d.leapT = 0;
    d.leapDur = dur ?? rand(1.5, 1.9);
    d.depthTarget = 0;
    this.splash(d.nodes[0], d.nodes[1], d.length * 0.3);
  }

  private startDepart(d: Dolphin) {
    d.state = "depart";
    d.depthTarget = 1;
    const reach = Math.max(this.width, this.height) * 2;
    d.target = { x: d.nodes[0] + Math.cos(d.heading) * reach, y: d.nodes[1] + Math.sin(d.heading) * reach };
    d.maxTurn = 0.25;
    this.splash(d.nodes[0], d.nodes[1], d.length * 0.3);
  }

  private leaderLogic(d: Dolphin) {
    const { width: W, height: H, time } = this;
    const hx = d.nodes[0];
    const hy = d.nodes[1];
    if (d.state === "arrive") {
      if (hx > 0.04 * W && hx < 0.96 * W && hy > 0.04 * H && hy < 0.96 * H) {
        d.depthTarget = 0;
        if (d.depth < 0.35) {
          d.state = "cruise";
          this.splash(hx, hy, d.length * 0.35);
        }
      }
      return;
    }
    if (d.state === "depart") return;

    // Breathing: the odd shallow dip between breaths, nothing like a dive.
    if (d.leapT < 0) d.depthTarget = 0.2 * Math.pow(Math.max(0, Math.sin(d.age * 0.55 + d.seed)), 3);

    if (d.scene === "pair") {
      if ((d.dirX > 0 ? hx > W * 0.7 : hx < W * 0.3) || d.age > 70) this.startDepart(d);
    } else if (Math.hypot(d.target.x - hx, d.target.y - hy) < d.length * 1.0) {
      // Near the end of the sea: pick the other end, so it turns back before it runs out of room.
      d.legsLeft--;
      if (d.legsLeft <= 0) this.startDepart(d);
      else d.target = this.pickTarget({ x: hx, y: hy });
    }
    if (
      d.state === "cruise" && d.leapsLeft > 0 && d.leapT < 0 && time >= d.nextLeapAt && d.depth < 0.25 &&
      hx > 0.15 * W && hx < 0.85 * W && hy > 0.2 * H && hy < 0.8 * H
    ) {
      d.leapsLeft--;
      d.nextLeapAt = time + rand(9, 14);
      this.startLeap(d);
    }
  }

  private followerLogic(d: Dolphin) {
    const lead = d.leader;
    if (!lead || !this.dolphins.includes(lead)) {
      d.leader = null;
      this.startDepart(d);
      return;
    }
    if (lead.state === "arrive") {
      d.depthTarget = 1;
    } else if (lead.state === "cruise") {
      if (d.state === "arrive" && lead.depth < 0.35) {
        d.state = "cruise";
        this.splash(d.nodes[0], d.nodes[1], d.length * 0.35);
      }
      if (d.leapT < 0) d.depthTarget = lead.depthTarget;
      if (lead.leapT > 0.25 && d.leapT < 0 && !d.followLeapDone) {
        d.followLeapDone = true;
        this.startLeap(d, lead.leapDur);
      }
      if (lead.leapT < 0) d.followLeapDone = false;
    } else if (d.state !== "depart") {
      d.state = "depart";
      d.depthTarget = 1;
      this.splash(d.nodes[0], d.nodes[1], d.length * 0.3);
    }
  }

  private drive(d: Dolphin, dt: number) {
    const n = d.nodes;
    const hx = n[0];
    const hy = n[1];
    d.age += dt;
    if (d.leader) this.followerLogic(d);
    else this.leaderLogic(d);

    // Steering. The heading eases toward the target through a smoothed turn rate, so turns start and
    // end gently; the body is a trail behind the head, so it bends exactly as far as the path did.
    let tx = d.target.x;
    let ty = d.target.y;
    let maxTurn = d.maxTurn;
    if (d.leader && d.state !== "depart") {
      const lead = d.leader;
      const L = d.length;
      tx = lead.nodes[0] - Math.cos(lead.heading) * 0.5 * L - Math.sin(lead.heading) * 0.85 * L * d.slot;
      ty = lead.nodes[1] - Math.sin(lead.heading) * 0.5 * L + Math.cos(lead.heading) * 0.85 * L * d.slot;
      maxTurn = 0.6;
    }
    const desired = Math.atan2(ty - hy, tx - hx);
    let want = clamp(angleDiff(d.heading, desired) * 1.4, -maxTurn, maxTurn);
    if (d.scene === "pair" && d.state === "cruise" && !d.leader) want += 0.07 * Math.sin(this.time * 0.45 + d.seed);
    d.omega += (want - d.omega) * Math.min(1, dt * 1.8);
    d.heading += d.omega * dt;

    // Speed: a surge with each tail stroke, a touch slower in a tight turn, faster in the air.
    let sp = d.speed;
    if (d.leader && d.state !== "depart") {
      const dist = Math.hypot(tx - hx, ty - hy);
      sp = d.leader.speed * clamp(0.85 + dist / (4 * d.length), 0.85, 1.35);
    }
    sp *= (1 + 0.1 * Math.sin(d.phase * 2)) * (1 - 0.2 * Math.min(1, Math.abs(d.omega) / d.maxTurn));
    if (d.leapT >= 0) sp *= 1.15;

    n[0] = hx + Math.cos(d.heading) * sp * dt;
    n[1] = hy + Math.sin(d.heading) * sp * dt;
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
    d.phase += dt * (4.5 + (6 * sp) / d.length);

    d.depth += (d.depthTarget - d.depth) * Math.min(1, dt * 2.2);
    if (d.leapT >= 0) {
      d.leapT += dt;
      d.lift = Math.sin(Math.PI * Math.min(1, d.leapT / d.leapDur));
      if (d.leapT >= d.leapDur) {
        d.leapT = -1;
        d.lift = 0;
        this.splash(n[0], n[1], d.length * 0.5);
      }
    }
  }

  private shouldRemove(d: Dolphin) {
    const { width: W, height: H } = this;
    const m = 24;
    let any = false;
    for (let k = 0; k < NODES; k++) {
      const x = d.nodes[k * 2];
      const y = d.nodes[k * 2 + 1];
      if (x > -m && x < W + m && y > -m && y < H + m) { any = true; break; }
    }
    if (any) d.entered = true;
    return (d.entered && !any && d.state === "depart") || d.age > 120;
  }
}
