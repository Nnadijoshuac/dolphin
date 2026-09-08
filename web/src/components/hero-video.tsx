"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page's background video, loaded on terms.
 *
 * ===========================================================================
 * WHAT THIS REPLACED (2026-09-08)
 * ===========================================================================
 * A bare `<video autoPlay loop muted playsInline src="https://res.cloudinary…">`
 * sitting directly in app/page.tsx. It is the largest element on the landing
 * page and it had:
 *
 *   no poster        so the hero is blank until enough of an MP4 has arrived
 *                    over a third-party CDN. The Largest Contentful Paint of
 *                    the whole site was gated on a video download.
 *   no preload hint  so the browser is free to pull the whole file immediately,
 *                    competing with the fonts, the JS bundle and the Convex
 *                    socket for the same connection.
 *   no motion gate   `prefers-reduced-motion` was honoured in CSS for the page's
 *                    own animations and NOT for this, which is the one thing on
 *                    the page that actually moves continuously. The media query
 *                    cannot stop a video; only not playing it can.
 *   no failure state If the CDN is unreachable the element renders transparent
 *                    and the hero text sits on whatever is behind it.
 *
 * ===========================================================================
 * HOW IT LOADS NOW
 * ===========================================================================
 * 1. A CSS gradient paints immediately, so the hero has a ground from the first
 *    frame and the text is legible before any network request resolves. It also
 *    stays as the backstop if the video never arrives.
 * 2. `poster` gives the browser a still to paint. It is served from the same
 *    Cloudinary transform as the video, so it is the video's own first frame
 *    rather than a second asset that can drift out of sync with it.
 * 3. `preload="none"` plus a deliberate mount delay: the video element is not
 *    even rendered until the page has had a chance to become interactive. LCP
 *    is then the heading, which is what it should always have been.
 * 4. `prefers-reduced-motion: reduce` means the video is never mounted at all.
 *    Not paused - not requested. Someone who has asked for less motion should
 *    not also pay for the download.
 */

/** The Cloudinary asset, and the still frame derived from it by transform. */
const VIDEO_SRC =
  "https://res.cloudinary.com/ejr7iufx/video/upload/v1788251928/0901.mp4";
/*
 * `so_0` = start offset zero, `f_auto,q_auto` = negotiated format and quality,
 * `w_1600` caps it at the widest the hero is ever painted. Cloudinary derives
 * this from the video itself, which is what keeps the poster and the first
 * played frame identical.
 */
const POSTER_SRC =
  "https://res.cloudinary.com/ejr7iufx/video/upload/so_0,w_1600,f_auto,q_auto/v1788251928/0901.jpg";

export function HeroVideo({ className }: { className?: string }) {
  /*
   * Starts false on the server AND on the first client render, so the two agree
   * and React cannot throw a hydration mismatch. Everything below only ever
   * turns it on, after mount, in the browser.
   */
  const [shouldLoad, setShouldLoad] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return undefined;

    /*
     * One frame after the browser has gone idle, or 1.2s, whichever is first.
     * `requestIdleCallback` is not in Safari, hence the timeout as both the
     * fallback and the ceiling - an idle callback that never fires must not
     * mean a hero that never animates.
     */
    const start = () => setShouldLoad(true);
    timer.current = setTimeout(start, 1_200);

    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(start, { timeout: 1_200 })
        : null;

    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setShouldLoad(false);
    };
    reduceMotion.addEventListener("change", onChange);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (idle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idle);
      }
      reduceMotion.removeEventListener("change", onChange);
    };
  }, []);

  if (!shouldLoad || failed) {
    /*
     * The poster as a plain background. Painted from CSS, so it costs no
     * JavaScript and no video decoder, and it is what a reduced-motion visitor
     * sees permanently - a still hero, not a broken one.
     */
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{
          backgroundImage: `url(${POSTER_SRC})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      />
    );
  }

  return (
    <video
      aria-hidden="true"
      autoPlay
      className={className}
      loop
      muted
      onError={() => setFailed(true)}
      playsInline
      poster={POSTER_SRC}
      /*
       * "none", not "metadata" or "auto". By the time this element exists the
       * decision to load has already been made in the effect above, and
       * autoPlay will start the fetch - so a preload hint here would only ever
       * duplicate that, earlier, against the critical path.
       */
      preload="none"
      src={VIDEO_SRC}
    />
  );
}
