/**
 * THE ICON FOR AN AGENT BUILT ON DOLPHIN that has no picture of its own (owner, 2026-10-17: "something
 * very different from what the normal agents have"). Marketplace agents fall back to DiceBear's robot
 * faces; these get the gold dolphin on a dark tile, so "made on Dolphin" reads at a glance. The glow
 * behind the dolphin is placed from the seed, so two agents never look identical.
 *
 * The dolphin is dolphin-logo.png used as a mask and filled with the gold gradient: the PNG is a pure
 * black silhouette (see BrandMark), so a mask is the only way to colour it.
 */
export function DolphinAgentMark({ seed, size = 40 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const x1 = 15 + (h % 70);
  const y1 = 15 + ((h >>> 7) % 70);
  const x2 = 100 - x1;
  const y2 = 100 - y1;
  const tilt = ((h >>> 14) % 50) - 25;

  return (
    <span
      aria-hidden="true"
      className="dolphin-agent-mark"
      style={{
        width: size,
        height: size,
        backgroundImage: `radial-gradient(circle at ${x1}% ${y1}%, rgba(243, 186, 47, 0.38), transparent 55%), radial-gradient(circle at ${x2}% ${y2}%, rgba(255, 221, 140, 0.16), transparent 60%)`,
      }}
    >
      <span className="dolphin-agent-mark__fish" style={{ transform: `rotate(${tilt}deg)` }} />
    </span>
  );
}

/** FNV-1a, enough to spread a seed over a few positions. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}
