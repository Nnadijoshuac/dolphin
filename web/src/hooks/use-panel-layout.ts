"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The /dolphin page's columns: sized, animated and resizable. (2026-09-28)
 *
 * Owner's direction: switching Chat -> Build must not snap - the right panel
 * grows in from the right and the page reflows around it - and a person can
 * drag any border to the width they like. Sizes are a per-browser convenience
 * kept in localStorage, never in the database ("I'm managing my database
 * despicably"), and a double-click on a border puts it back.
 *
 * WHY PIXELS, NOT FR. The page always has four tracks - history | chat |
 * canvas | draft - and a hidden one is 0px, so the track count never changes.
 * The browser only interpolates `grid-template-columns` between values of the
 * same shape, and `1fr` to `24rem` is not one, so every track is computed in px
 * from the measured width and the flexible one takes the remainder.
 *
 * WHY THE ZOOM FACTOR. The whole screen renders at CSS `zoom: 0.8`
 * (dolphin-chat.module.css). Pointer coordinates are viewport pixels and the
 * tracks are in the page's own pixels, so a drag divides by the measured
 * ratio - measured, not hard-coded, so changing the zoom cannot desync it.
 */

export type PanelLayout = "chat" | "draft" | "canvas";
export type PanelKey = "history" | "builder" | "draft";

type Sizes = Record<PanelKey, number>;

export const PANEL_DEFAULTS: Sizes = { history: 272, builder: 384, draft: 352 };
const LIMITS: Record<PanelKey, readonly [number, number]> = {
  history: [200, 440],
  builder: [300, 760],
  draft: [280, 680],
};
/** The flexible column never gets narrower than this. */
const FLUID_MIN = 360;
const STORAGE_KEY = "dolphin.panel-sizes.v1";
const DESKTOP_QUERY = "(min-width: 1024px)";

function readStored(): Sizes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return PANEL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Sizes>;
    const out = { ...PANEL_DEFAULTS };
    for (const key of Object.keys(out) as PanelKey[]) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) out[key] = clamp(key, value);
    }
    return out;
  } catch {
    return PANEL_DEFAULTS;
  }
}

function writeStored(sizes: Sizes) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    /* Private window or blocked storage: the sizes just are not remembered. */
  }
}

function clamp(key: PanelKey, value: number): number {
  const [min, max] = LIMITS[key];
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** [history, chat, canvas, draft] in px for a layout at a given width. */
export function columnsFor(layout: PanelLayout, width: number, sizes: Sizes): [number, number, number, number] {
  // Fixed panels give way before the flexible column drops under FLUID_MIN.
  const fit = (fixed: number[]) => {
    const total = fixed.reduce((a, b) => a + b, 0);
    const room = Math.max(0, width - FLUID_MIN);
    return total <= room ? fixed : fixed.map((size) => Math.floor((size / total) * room));
  };
  if (layout === "chat") {
    const [history] = fit([sizes.history]);
    return [history, width - history, 0, 0];
  }
  if (layout === "draft") {
    const [history, draft] = fit([sizes.history, sizes.draft]);
    return [history, width - history - draft, 0, draft];
  }
  const [builder, draft] = fit([sizes.builder, sizes.draft]);
  return [0, builder, width - builder - draft, draft];
}

/**
 * Maximized or popped-out panels (owner, 2026-10-03). A maximized panel takes the whole
 * width; a panel away in its own tab gives its width to its neighbour. Still four tracks,
 * so the change animates like any other.
 */
export type PanelFocus = { maximized: "draft" | "canvas" | null; away: { draft: boolean; canvas: boolean } };
export const NO_FOCUS: PanelFocus = { maximized: null, away: { draft: false, canvas: false } };

export function focusColumns(layout: PanelLayout, columns: [number, number, number, number], focus: PanelFocus): [number, number, number, number] {
  const width = columns.reduce((a, b) => a + b, 0);
  if (focus.maximized === "draft" && layout !== "chat" && !focus.away.draft) return [0, 0, 0, width];
  if (focus.maximized === "canvas" && layout === "canvas" && !focus.away.canvas) return [0, 0, width, 0];
  const next: [number, number, number, number] = [...columns];
  if (layout === "canvas" && focus.away.canvas) {
    next[1] += next[2];
    next[2] = 0;
  }
  if (layout !== "chat" && focus.away.draft) {
    // To the canvas while it is here, otherwise to the chat.
    next[layout === "canvas" && !focus.away.canvas ? 2 : 1] += next[3];
    next[3] = 0;
  }
  return next;
}

/** The borders a person can drag in each layout, and which panel each one sizes. */
export function handlesFor(layout: PanelLayout): { key: PanelKey; afterColumn: number; invert: boolean }[] {
  if (layout === "chat") return [{ key: "history", afterColumn: 0, invert: false }];
  if (layout === "draft") {
    return [
      { key: "history", afterColumn: 0, invert: false },
      { key: "draft", afterColumn: 2, invert: true },
    ];
  }
  return [
    { key: "builder", afterColumn: 1, invert: false },
    { key: "draft", afterColumn: 2, invert: true },
  ];
}

function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function usePanelLayout(layout: PanelLayout, focus: PanelFocus = NO_FOCUS) {
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );

  // A callback ref held in state, not a ref object: the React Compiler lint
  // treats everything returned beside a ref object as a ref.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Sizes>(PANEL_DEFAULTS);
  const [dragging, setDragging] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => {
      // Stored sizes are read here, in a callback, so the first render matches
      // the server's (localStorage does not exist there).
      if (!loadedRef.current) {
        loadedRef.current = true;
        setSizes(readStored());
      }
      setWidth(element.offsetWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const columns = isDesktop && width ? focusColumns(layout, columnsFor(layout, width, sizes), focus) : null;

  const startDrag = useCallback(
    (key: PanelKey, invert: boolean, event: React.PointerEvent<HTMLElement>) => {
      if (!element) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      // Viewport px per page px - the screen's CSS zoom, measured.
      const scale = element.getBoundingClientRect().width / element.offsetWidth || 1;
      const startX = event.clientX;
      const startSize = sizes[key];
      let latest = sizes;
      setDragging(true);

      const move = (moveEvent: PointerEvent) => {
        const delta = (moveEvent.clientX - startX) / scale;
        latest = { ...latest, [key]: clamp(key, startSize + (invert ? -delta : delta)) };
        setSizes(latest);
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        setDragging(false);
        writeStored(latest);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    },
    [element, sizes],
  );

  const nudge = useCallback((key: PanelKey, delta: number) => {
    setSizes((current) => {
      const next = { ...current, [key]: clamp(key, current[key] + delta) };
      writeStored(next);
      return next;
    });
  }, []);

  const reset = useCallback((key: PanelKey) => {
    setSizes((current) => {
      const next = { ...current, [key]: PANEL_DEFAULTS[key] };
      writeStored(next);
      return next;
    });
  }, []);

  return {
    /** Callback ref for the grid. Not named *Ref: the compiler lint treats such names as ref objects. */
    measure: setElement,
    columns,
    sizes,
    /** Inline style for the grid: px tracks, animated unless dragging or reduced motion. */
    style: columns
      ? {
          gridTemplateColumns: columns.map((size) => `${size}px`).join(" "),
          transition:
            dragging || reducedMotion ? "none" : "grid-template-columns 460ms cubic-bezier(0.22, 1, 0.36, 1)",
        }
      : undefined,
    // A border is draggable only between two panels that are both showing.
    handles: columns
      ? handlesFor(layout).filter((handle) =>
          handle.key === "history"
            ? columns[0] > 0 && columns[1] > 0
            : handle.key === "builder"
              ? columns[1] > 0 && columns[2] > 0
              : columns[3] > 0 && columns[0] + columns[1] + columns[2] > 0,
        )
      : [],
    dragging,
    startDrag,
    nudge,
    reset,
  };
}
