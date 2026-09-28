"use client";

import { useEffect } from "react";

/**
 * THE CONSOLE BANNER. (2026-09-28, owner's request)
 *
 * What a developer sees on opening the browser console on any Dolphin page:
 * the name in block letters, then what Dolphin is. The letters are figlet's
 * "ANSI Shadow" font, generated rather than hand-typed so every row lines up.
 *
 * Printed once per page load. React's development mode runs effects twice,
 * so a window flag keeps it from printing a second copy. It says nothing a
 * visitor could not read on the page itself: no build info, no addresses.
 */

const LETTERS = [
  "██████╗  ██████╗ ██╗     ██████╗ ██╗  ██╗██╗███╗   ██╗",
  "██╔══██╗██╔═══██╗██║     ██╔══██╗██║  ██║██║████╗  ██║",
  "██║  ██║██║   ██║██║     ██████╔╝███████║██║██╔██╗ ██║",
  "██║  ██║██║   ██║██║     ██╔═══╝ ██╔══██║██║██║╚██╗██║",
  "██████╔╝╚██████╔╝███████╗██║     ██║  ██║██║██║ ╚████║",
  "╚═════╝  ╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝",
].join("\n");

declare global {
  interface Window {
    __dolphinBannerShown?: boolean;
  }
}

export function ConsoleBanner() {
  useEffect(() => {
    if (window.__dolphinBannerShown) return;
    window.__dolphinBannerShown = true;
    /*
     * BNB yellow (--accent in globals.css), then the tagline in the page's ink grey.
     *
     * Handed to the browser's own timer as a bound function, so the BROWSER makes
     * the call: the console then shows no "console-banner.tsx:37" source link
     * beside the banner (owner's request, 2026-09-28).
     */
    setTimeout(
      console.log.bind(
        console,
        `%c${LETTERS}\n\n%cThe agent marketplace on BNB Chain.\n%chttps://www.x.com/dolphin_agents`,
        "color:#f0b90b;font-family:monospace;font-size:11px;line-height:1.15",
        "color:#f0b90b;font-family:monospace;font-size:13px;font-weight:700",
        "color:#8a8a80;font-family:monospace;font-size:12px",
      ),
    );
  }, []);
  return null;
}
