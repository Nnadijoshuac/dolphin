"use client";

import { useEffect, useState } from "react";

import styles from "@/app/live/live.module.css";

/** A clock that ticks every second, for "checked 12s ago". Only on the live pages. */
export function useSecond(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function dayOf(startedAt: number, now: number): number {
  return Math.max(1, Math.floor((now - startedAt) / 86_400_000) + 1);
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const pct = (from: number, to: number) => {
  const p = from > 0 ? ((to - from) / from) * 100 : 0;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
};

export function LiveBadge({ running }: { running: boolean }) {
  return (
    <span className={styles.live} style={running ? undefined : { background: "var(--paper-muted)", color: "var(--muted)" }}>
      <span className={`${styles.dot} ${running ? "" : styles.dotIdle}`} />
      {running ? "LIVE" : "ENDED"}
    </span>
  );
}

/** $0 -> target, with the start marked and the current value as a glowing bead. */
export function Track({ start, now, target }: { start: number; now: number; target: number }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / target) * 100))}%`;
  return (
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: at(now) }} />
      <div className={styles.startTick} style={{ left: at(start) }} />
      <div className={styles.bead} style={{ left: at(now) }} />
    </div>
  );
}

/** The heartbeat: sweeps while the agent is checking, goes still if it has not checked in 3 minutes. */
export function Heartbeat({ alive }: { alive: boolean }) {
  const path = "M0 20 L40 20 L48 6 L56 34 L64 20 L120 20 L128 12 L134 28 L140 20 L200 20";
  return (
    <div className={`${styles.ecg} ${alive ? "" : styles.ecgStill}`} aria-hidden="true">
      <div className={styles.ecgTrack}>
        {[0, 1].map((i) => (
          <svg key={i} preserveAspectRatio="none" viewBox="0 0 200 40">
            <path d={path} fill="none" stroke="#f3c13a" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
        ))}
      </div>
    </div>
  );
}
