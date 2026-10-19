"use client";

import styles from "@/app/live/live.module.css";

const UP = "#3ddc84";
const DOWN = "#ff5c5c";
const GOLD = "#f3c13a";

/**
 * RSI as a dial: 0 to 100 on a 240° arc, the buy zone lit green, the sell zone red. The reading is the
 * Dolphin itself (owner, 2026-10-19: "instead of a gold knob, can we have a dolphin be the guy there"),
 * a gold disc carrying the mark that glides along the arc to each new reading. Used on the run page and
 * the /live list.
 */
export function RsiDial({ value, buy, sell, size = 80 }: { value: number | null; buy: number | null; sell: number | null; size?: number }) {
  const R = 32;
  const C = 40;
  const start = 150;
  const sweep = 240;
  const at = (v: number) => {
    const a = ((start + (sweep * Math.max(0, Math.min(100, v))) / 100) * Math.PI) / 180;
    return [C + R * Math.cos(a), C + R * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = at(from);
    const [x2, y2] = at(to);
    return `M ${x1} ${y1} A ${R} ${R} 0 ${((to - from) / 100) * sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const [nx, ny] = value === null ? [C, C] : at(value);
  return (
    // A margin all round: the Dolphin's disc (radius 11) reaches past the arc (8 from the top edge), and was
    // cut off at its head whenever the reading sat near the top (owner, 2026-10-19).
    <svg className="shrink-0 overflow-visible" height={(size * 88) / 92} viewBox="-6 -7 92 88" width={size}>
      <path d={arc(0, 100)} fill="none" stroke="rgba(255,255,255,0.16)" strokeLinecap="round" strokeWidth="6" />
      {buy !== null ? <path d={arc(0, buy)} fill="none" stroke={UP} strokeLinecap="round" strokeOpacity="0.9" strokeWidth="6" /> : null}
      {sell !== null ? <path d={arc(sell, 100)} fill="none" stroke={DOWN} strokeLinecap="round" strokeOpacity="0.75" strokeWidth="6" /> : null}
      <text fill="#ffffff" fontSize="18" fontWeight="700" textAnchor="middle" x={C} y={C + 6}>
        {value === null ? "—" : value.toFixed(0)}
      </text>
      <text fill="#8a8c85" fontSize="9" textAnchor="middle" x={C} y={C + 26}>
        RSI
      </text>
      {value !== null ? (
        <g className={styles.dialDolphin} style={{ transform: `translate(${nx}px, ${ny}px)` }}>
          <circle fill={GOLD} r="11" stroke="#0e0f0e" strokeWidth="1.5" />
          {/* The mark is pure black on transparent (brand-mark.tsx): black on gold, the brand's own pairing. */}
          <image height="16" href="/dolphin-logo.png" width="16" x="-8" y="-8" />
        </g>
      ) : null}
    </svg>
  );
}

/**
 * RSI on a straight track, for a trading app's rows and its signal strip: 0 to 100, the buy zone lit, and the
 * Dolphin riding to the reading. Where an exchange draws your order line, this draws what the agent waits for.
 */
export function RsiTrack({ value, buy, height = 22 }: { value: number | null; buy: number | null; height?: number }) {
  const at = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-white/[0.10]" />
      {buy !== null ? <div className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full" style={{ width: `${buy}%`, background: UP }} /> : null}
      {buy !== null ? <div className="absolute top-1/2 h-[10px] w-px -translate-y-1/2 bg-[#3ddc84]" style={{ left: `${buy}%` }} /> : null}
      {at !== null ? (
        <span
          className={`${styles.trackDolphin} absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full`}
          style={{ left: `${at}%`, width: height, height, background: GOLD }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a 14px mark inside a dot, not content */}
          <img alt="" height={height - 8} src="/dolphin-logo.png" width={height - 8} />
        </span>
      ) : null}
    </div>
  );
}
