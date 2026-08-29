"use client";

function seeded(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const DOTS = Array.from({ length: 28 }, (_, i) => ({
  size: 2 + seeded(i, 1) * 3,
  top: 4 + seeded(i, 2) * 92,
  left: 3 + seeded(i, 3) * 94,
  opacity: 0.25 + seeded(i, 4) * 0.45,
  isGold: seeded(i, 5) > 0.4,
}));

export function ConstellationBg({ opacity = 0.6 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity }}
    >
      {/* Subtle radial ambient warmth */}
      <div className="absolute -top-40 right-[-10%] h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.08)_0%,transparent_70%)] blur-2xl" />
      <div className="absolute top-[35%] left-[-15%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.04)_0%,transparent_70%)] blur-3xl" />

      {/* SVG Celestial Orbital Ring Patterns */}
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
      </svg>

      {/* Fixed Constellation Star Nodes */}
      <div className="absolute inset-0">
        {DOTS.map((dot, i) => (
          <span
            className={`absolute rounded-full ${dot.isGold ? "bg-[#F5B300]" : "bg-[#D8D1C2]"}`}
            key={i}
            style={{
              width: dot.size,
              height: dot.size,
              top: `${dot.top}%`,
              left: `${dot.left}%`,
              opacity: dot.opacity,
            }}
          />
        ))}
      </div>
    </div>
  );
}
