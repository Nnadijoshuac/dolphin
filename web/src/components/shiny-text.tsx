import type { CSSProperties } from "react";

/**
 * SHINY TEXT - the React Bits effect (reactbits.dev ShinyText), done in CSS
 * (owner, 2026-09-29: for the chat placeholders).
 *
 * The original drives the shine with `motion`'s animation-frame hook. A
 * moving gradient is exactly what a CSS keyframe does, so this keeps the same
 * props and look without adding a dependency outside the locked stack
 * (AGENTS.md §1): the gradient is clipped to the text and its position swept
 * from 150% to -50% on a loop. Reduced motion shows the plain colour.
 */
export function ShinyText({
  text,
  disabled = false,
  speed = 2,
  className = "",
  color = "#b5b5b5",
  shineColor = "#ffffff",
  spread = 120,
  yoyo = false,
  pauseOnHover = false,
  direction = "left",
}: {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  color?: string;
  shineColor?: string;
  spread?: number;
  yoyo?: boolean;
  pauseOnHover?: boolean;
  direction?: "left" | "right";
}) {
  return (
    <span
      className={`shiny-text ${className}`}
      data-disabled={disabled || undefined}
      data-pause={pauseOnHover || undefined}
      style={
        {
          backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
          "--shine-color": color,
          animationDuration: `${speed}s`,
          animationDirection: yoyo
            ? direction === "left" ? "alternate" : "alternate-reverse"
            : direction === "left" ? "normal" : "reverse",
        } as CSSProperties
      }
    >
      {text}
    </span>
  );
}
