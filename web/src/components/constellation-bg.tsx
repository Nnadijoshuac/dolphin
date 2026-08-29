"use client";

export function ConstellationBg({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ opacity }}
      aria-hidden="true"
    >
      {/* Animated constellation dots */}
      <div className="absolute inset-0">
        {Array.from({ length: 24 }).map((_, i) => {
          const size = 2 + Math.random() * 3;
          const top = Math.random() * 100;
          const left = Math.random() * 100;
          const delay = Math.random() * 6;
          const duration = 4 + Math.random() * 4;

          return (
            <span
              key={i}
              className="absolute rounded-full bg-amber-300"
              style={{
                width: size,
                height: size,
                top: `${top}%`,
                left: `${left}%`,
                animation: `twinkle ${duration}s ease-in-out ${delay}s infinite`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
