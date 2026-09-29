"use client";

import { createElement, type CSSProperties } from "react";
import Script from "next/script";

import styles from "@/components/dolphin-loader.module.css";

const loaderStyle = {
  "--dolphin-gold": "#f0b90b",
} as CSSProperties;

/**
 * `working`: the fin patrols while an agent works (the chat). `done`: the
 * dolphin leaps - used for plain page loads such as "Show more" (owner,
 * 2026-09-29: "the dolphin state of finished work, just the jumping").
 */
export function DolphinLoader({
  label,
  state = "working",
  className = "",
}: {
  label: string;
  state?: "working" | "done";
  className?: string;
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
      <span className="text-[0.85rem] text-muted">{label}</span>
    </div>
  );
}
