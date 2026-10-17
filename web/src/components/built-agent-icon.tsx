/**
 * THE ICON FOR AN AGENT BUILT ON DOLPHIN that has no picture of its own (owner, 2026-10-17: "something
 * very different from what the normal agents have"; then "just this is okay, no trade mark"). Marketplace
 * agents fall back to DiceBear's robot faces (agent-icon.tsx); built agents get DiceBear's identicon, a
 * symmetrical pixel grid, so the two never look alike. Same seed, same pattern, every time.
 */
export function BuiltAgentIcon({ seed, size = 40 }: { seed: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a remote SVG avatar, sized here; nothing to optimise
    <img
      alt=""
      className="shrink-0 rounded-xl bg-paper-muted"
      height={size}
      src={`https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}`}
      style={{ height: size, width: size }}
      width={size}
    />
  );
}
