"use client";

import { createElement, type CSSProperties } from "react";
import Script from "next/script";

import styles from "@/components/dolphin-loader.module.css";

const loaderStyle = {
  "--dolphin-gold": "#f0b90b",
} as CSSProperties;

export function DolphinLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5" role="status">
      <Script id="dolphin-loader-element" src="/dolphin-loader.js" strategy="afterInteractive" />
      <span aria-hidden className={styles.ocean} style={loaderStyle}>
        {/*
          React does not need to know this custom element's type: the pasted
          script upgrades it in the browser after hydration.
        */}
        {createElement("dolphin-loader", {
          "aria-label": label,
          className: styles.element,
          state: "working",
        })}
      </span>
      <span className="text-[0.85rem] text-muted">{label}</span>
    </div>
  );
}
