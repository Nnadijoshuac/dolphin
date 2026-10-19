"use client";

import { useEffect } from "react";

/**
 * Keeps the live pages dark while they are open, and gives the theme back on the way out: moving to another page
 * of the site in the same tab restores whatever the viewer had (their system setting, or their own choice).
 */
export function LiveDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      if (before && before !== "dark") root.setAttribute("data-theme", before);
      else root.removeAttribute("data-theme");
    };
  }, []);
  return null;
}
