"use client";

/**
 * Deterministic hash -> [0, 1). Replaces Math.random(), which was being called
 * during render: the server and the client each rolled their own numbers, so
 * every dot's size and position differed between the two passes and React
 * reported a hydration mismatch. Seeding from the dot's index gives a fixed,
 * arbitrary-looking layout that both passes agree on.
 */
function seeded(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const DOTS = Array.from({ length: 24 }, (_, i) => ({
  size: 2 + seeded(i, 1) * 3,
  top: seeded(i, 2) * 100,
  left: seeded(i, 3) * 100,
  delay: seeded(i, 4) * 6,
  duration: 4 + seeded(i, 5) * 4,
}));

export function ConstellationBg({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity }}
      aria-hidden="true"
    >
      {/* Animated constellation dots */}
      <div className="absolute inset-0">
        {DOTS.map((dot, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-amber-300"
            style={{
              width: dot.size,
              height: dot.size,
              top: `${dot.top}%`,
              left: `${dot.left}%`,
              animation: `twinkle ${dot.duration}s ease-in-out ${dot.delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
