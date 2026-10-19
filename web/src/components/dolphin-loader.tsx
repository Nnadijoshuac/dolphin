"use client";

import { createElement, type CSSProperties } from "react";
import Script from "next/script";

import styles from "@/components/dolphin-loader.module.css";

const loaderStyle = {
  "--dolphin-gold": "#f0b90b",
} as CSSProperties;

/**
 * `done`: the dolphin leaps and dives back in - every loader, the chat's
 * "Thinking…" included (owner, 2026-09-29: "just the jumping"; 2026-10-19:
 * "change it to the one where the dolphin is diving"). `working`: the fin
 * patrols on the surface, kept for a caller that wants it.
 */
export function DolphinLoader({
  label,
  state = "done",
  className = "",
  showLabel = true,
}: {
  label: string;
  state?: "working" | "done";
  className?: string;
  /** False: the animation alone, the label kept for screen readers only. */
  showLabel?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} role="status">
      <Script id="dolphin-loader-element" src="/dolphin-loader.js" strategy="afterInteractive" />
      <span aria-hidden className={styles.ocean} style={loaderStyle}>
        {/*
          React does not need to know this custom element's type: the pasted
          script upgrades it in the browser after hydration.
        */}
        {createElement("dolphin-loader", {
          "aria-label": label,
          className: styles.element,
          state,
        })}
      </span>
      <span className={showLabel ? "text-[0.85rem] text-muted" : "sr-only"}>{label}</span>
    </div>
  );
}
