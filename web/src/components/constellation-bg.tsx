"use client";

// Deterministic star node coordinates (fixed integers to ensure 100% SSR & client hydration parity)
const STARS = [
  { cx: 120, cy: 150, r: 2.5, isGold: true, opacity: 0.5 },
  { cx: 280, cy: 90, r: 1.8, isGold: false, opacity: 0.35 },
  { cx: 440, cy: 220, r: 2.2, isGold: true, opacity: 0.45 },
  { cx: 620, cy: 110, r: 3.0, isGold: false, opacity: 0.4 },
  { cx: 830, cy: 180, r: 2.0, isGold: true, opacity: 0.6 },
  { cx: 990, cy: 85, r: 2.4, isGold: false, opacity: 0.35 },
  { cx: 1180, cy: 160, r: 2.8, isGold: true, opacity: 0.55 },
  { cx: 1350, cy: 240, r: 1.8, isGold: false, opacity: 0.3 },
  { cx: 180, cy: 380, r: 2.2, isGold: false, opacity: 0.35 },
  { cx: 340, cy: 490, r: 2.6, isGold: true, opacity: 0.5 },
  { cx: 510, cy: 370, r: 1.9, isGold: false, opacity: 0.35 },
  { cx: 720, cy: 420, r: 3.5, isGold: true, opacity: 0.7 },
  { cx: 910, cy: 460, r: 2.2, isGold: false, opacity: 0.4 },
  { cx: 1100, cy: 390, r: 2.5, isGold: true, opacity: 0.5 },
  { cx: 1290, cy: 480, r: 2.0, isGold: false, opacity: 0.35 },
  { cx: 150, cy: 670, r: 2.4, isGold: true, opacity: 0.45 },
  { cx: 320, cy: 760, r: 1.8, isGold: false, opacity: 0.3 },
  { cx: 560, cy: 690, r: 2.6, isGold: true, opacity: 0.55 },
  { cx: 780, cy: 740, r: 2.1, isGold: false, opacity: 0.35 },
  { cx: 960, cy: 680, r: 2.8, isGold: true, opacity: 0.6 },
  { cx: 1150, cy: 770, r: 1.9, isGold: false, opacity: 0.35 },
  { cx: 1320, cy: 710, r: 2.5, isGold: true, opacity: 0.5 },
];

export function ConstellationBg({ opacity = 0.4 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity }}
    >
      {/* Subtle radial ambient warmth */}
      <div className="absolute -top-40 right-[-10%] h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.08)_0%,transparent_70%)] blur-2xl" />
      <div className="absolute top-[35%] left-[-15%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.04)_0%,transparent_70%)] blur-3xl" />

      {/* SVG Celestial Orbital Ring & Deterministic Star Patterns */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1440 900"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse
          cx="720"
          cy="420"
          fill="none"
          rx="680"
          ry="320"
          stroke="#E8DFCA"
          strokeDasharray="4 8"
          strokeOpacity="0.45"
          strokeWidth="1"
          transform="rotate(-8 720 420)"
        />
        <ellipse
          cx="720"
          cy="420"
          fill="none"
          rx="520"
          ry="240"
          stroke="#DFD3B8"
          strokeDasharray="3 6"
          strokeOpacity="0.35"
          strokeWidth="1"
          transform="rotate(12 720 420)"
        />
        <ellipse
          cx="720"
          cy="420"
          fill="none"
          rx="340"
          ry="150"
          stroke="#F3E5AB"
          strokeOpacity="0.4"
          strokeWidth="1"
          transform="rotate(-20 720 420)"
        />

        {/* Fine cross lines */}
        <line
          stroke="#F0EAE0"
          strokeOpacity="0.3"
          strokeWidth="0.8"
          x1="120"
          x2="1320"
          y1="420"
          y2="420"
        />
        <line
          stroke="#F0EAE0"
          strokeOpacity="0.3"
          strokeWidth="0.8"
          x1="720"
          x2="720"
          y1="100"
          y2="740"
        />

        {/* Star Nodes (100% Deterministic in SVG to avoid hydration mismatches) */}
        {STARS.map((star, i) => (
          <circle
            cx={star.cx}
            cy={star.cy}
            fill={star.isGold ? "#F5B300" : "#D8D1C2"}
            key={i}
            opacity={star.opacity}
            r={star.r}
          />
        ))}
      </svg>
    </div>
  );
}
