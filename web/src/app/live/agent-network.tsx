"use client";

/**
 * THE AGENT, READING (owner, 2026-10-25: "like a brain... neural connections, data from many places connecting
 * to one place... a simple animation that looks complex"; no glow, no globe, no badges). A small network drawn
 * in hairlines: the sources it really reads on the left (its coins' candles, the order book, BNB Chain), two
 * layers in between, one decision on the right. Small dots travel the connections and converge on the decision,
 * staggered so the flow never visibly restarts. Flat: no blur, no shadow, no radiating light.
 *
 * Pure SVG with SMIL: no JavaScript per frame. `active` false shows the network still (a run that has ended).
 */
const W = 360;
const H = 120;
const X = [44, 150, 248, 330];

function column(count: number, top: number, bottom: number): number[] {
  if (count === 1) return [(top + bottom) / 2];
  return Array.from({ length: count }, (_, i) => top + ((bottom - top) * i) / (count - 1));
}

export function AgentNetwork({ sources, active = true }: { sources: string[]; active?: boolean }) {
  const inputs = column(sources.length, 14, H - 14);
  const first = column(6, 10, H - 10);
  const second = column(4, 26, H - 26);
  const out = H / 2;
  const gold = "#f3c13a";
  // Routes the dots take: every source sends through a different pair of inner nodes, so the whole net is used.
  const routes = sources.flatMap((_, i) =>
    [0, 1].map((n) => {
      const a = (i * 2 + n * 3) % first.length;
      const b = (i + n * 2) % second.length;
      return { d: `M ${X[0]} ${inputs[i]} L ${X[1]} ${first[a]} L ${X[2]} ${second[b]} L ${X[3]} ${out}`, delay: (i * 2 + n) * 0.42 };
    }),
  );
  const cycle = 3.4;
  return (
    <svg aria-hidden className="h-full w-full" preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${W} ${H}`}>
      <g stroke="#ffffff" strokeOpacity="0.07" strokeWidth="0.6">
        {inputs.map((y1) => first.map((y2) => <line key={`a${y1}-${y2}`} x1={X[0]} x2={X[1]} y1={y1} y2={y2} />))}
        {first.map((y1) => second.map((y2) => <line key={`b${y1}-${y2}`} x1={X[1]} x2={X[2]} y1={y1} y2={y2} />))}
        {second.map((y1) => <line key={`c${y1}`} x1={X[2]} x2={X[3]} y1={y1} y2={out} />)}
      </g>
      {first.map((y) => <circle cx={X[1]} cy={y} fill="#3a3c37" key={`n1${y}`} r="2.2" />)}
      {second.map((y) => <circle cx={X[2]} cy={y} fill="#3a3c37" key={`n2${y}`} r="2.2" />)}
      {inputs.map((y, i) => (
        <g key={`in${sources[i]}`}>
          <circle cx={X[0]} cy={y} fill="#8a8c85" r="2.4" />
          <text fill="#8a8c85" fontSize="9.5" textAnchor="end" x={X[0] - 8} y={y + 3.2}>
            {sources[i]}
          </text>
        </g>
      ))}
      {/* the decision */}
      <circle cx={X[3]} cy={out} fill="none" r="7" stroke={gold} strokeOpacity="0.8" />
      <circle cx={X[3]} cy={out} fill={gold} r="2.6" />
      {active
        ? routes.map((route, i) => (
            <circle fill={gold} key={i} r="1.7">
              <animateMotion begin={`${route.delay}s`} dur={`${cycle}s`} path={route.d} repeatCount="indefinite" />
              <animate attributeName="opacity" begin={`${route.delay}s`} dur={`${cycle}s`} keyTimes="0;0.1;0.9;1" repeatCount="indefinite" values="0;1;1;0" />
            </circle>
          ))
        : null}
    </svg>
  );
}
