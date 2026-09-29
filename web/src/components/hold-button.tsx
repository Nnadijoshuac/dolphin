"use client";

/**
 * HOLD TO CONFIRM - React Bits' HoldButton (reactbits.dev), converted to
 * TypeScript for this repo (owner, 2026-09-29: "use this for the cancel hire
 * button"). A destructive action needs a deliberate press: a liquid fill
 * sweeps across while the button is held, and letting go early cancels
 * nothing. Keyboard: hold Space or Enter; Escape abandons.
 *
 * Changes from the original: types; the ref that tracks `release` is updated
 * in an effect rather than during render (react-hooks/refs); CSS lives in
 * globals.css under .hold-button.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const TAP_MS = 250;
const HIT_PAD = 10;
const LINEAR = (t: number) => t;
const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);
/** Read only from event handlers, timers and animation frames - never during render. */
const clock = () => performance.now();

type Phase = "idle" | "holding" | "done";
type Input = "pointer" | "key" | null;

export type HoldButtonProps = {
  children?: ReactNode;
  doneLabel?: ReactNode;
  icon?: ReactNode;
  doneIcon?: ReactNode;
  backgroundColor?: string;
  fillColor?: string;
  textColor?: string;
  fillTextColor?: string;
  size?: "sm" | "md" | "lg";
  radius?: number;
  fillDirection?: "right" | "up";
  holdTime?: number;
  releaseTime?: number;
  pressScale?: number;
  wave?: boolean;
  waveAmplitude?: number;
  glow?: boolean;
  resetAfter?: number;
  disabled?: boolean;
  onHold?: () => void;
  onTap?: () => void;
  className?: string;
};

export function HoldButton({
  children = "Hold to delete",
  doneLabel = "Deleted",
  icon = null,
  doneIcon = null,
  backgroundColor = "#27272a",
  fillColor = "#5227FF",
  textColor = "#f5f5f5",
  fillTextColor = "#ffffff",
  size = "md",
  radius = 14,
  fillDirection = "right",
  holdTime = 2000,
  releaseTime = 200,
  pressScale = 0.97,
  wave = true,
  waveAmplitude = 6,
  glow = true,
  resetAfter = 1200,
  disabled = false,
  onHold,
  onTap,
  className = "",
}: HoldButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState<Input>(null);
  const phaseRef = useRef<Phase>("idle");
  const inputRef = useRef<Input>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ pointerId: number | null; start: number; rect: DOMRect | null }>({ pointerId: null, start: 0, rect: null });
  const timers = useRef<{ complete: number; reset: number }>({ complete: 0, reset: 0 });
  const motion = useRef({ raf: 0, p: 0, from: 0, to: 0, start: 0 });
  const hintId = useId();

  const go = (next: Phase, kind: Input = null) => {
    phaseRef.current = next;
    inputRef.current = kind;
    setPhase(next);
    setInput(kind);
  };

  const clearTimers = () => {
    window.clearTimeout(timers.current.complete);
    window.clearTimeout(timers.current.reset);
  };

  const drive = (to: number, duration: number, ease: (t: number) => number) => {
    const m = motion.current;
    cancelAnimationFrame(m.raf);
    m.from = m.p;
    m.to = to;
    m.start = clock();
    const step = (now: number) => {
      const t = duration > 0 ? Math.min(1, (now - m.start) / duration) : 1;
      m.p = m.from + (m.to - m.from) * ease(t);
      buttonRef.current?.style.setProperty("--hb-p", m.p.toFixed(4));
      if (t < 1) {
        m.raf = requestAnimationFrame(step);
        return;
      }
      m.raf = 0;
      if (m.to === 1) complete();
    };
    m.raf = requestAnimationFrame(step);
  };

  const complete = () => {
    if (phaseRef.current !== "holding") return;
    if (clock() - gesture.current.start < holdTime - 50) return;
    clearTimers();
    go("done", inputRef.current);
    onHold?.();
    if (resetAfter > 0) {
      timers.current.reset = window.setTimeout(() => {
        go("idle");
        drive(0, releaseTime, EASE_OUT);
      }, resetAfter);
    }
  };

  const begin = (kind: Exclude<Input, null>) => {
    if (disabled || phaseRef.current !== "idle") return false;
    const button = buttonRef.current;
    if (!button) return false;
    gesture.current.start = clock();
    gesture.current.rect = button.getBoundingClientRect();
    go("holding", kind);
    drive(1, holdTime, LINEAR);
    timers.current.complete = window.setTimeout(complete, holdTime + 100);
    return true;
  };

  const release = ({ drifted = false }: { drifted?: boolean } = {}) => {
    if (phaseRef.current !== "holding") return;
    clearTimers();
    const held = clock() - gesture.current.start;
    go("idle");
    drive(0, releaseTime, EASE_OUT);
    if (!drifted && held < TAP_MS) onTap?.();
  };
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });

  const endPointer = (event: React.PointerEvent<HTMLButtonElement>, options?: { drifted?: boolean }) => {
    if (event.pointerId !== gesture.current.pointerId) return;
    gesture.current.pointerId = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* capture already gone */
    }
    release(options);
  };

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return undefined;
    const measure = () => {
      button.style.setProperty("--hb-w", `${button.offsetWidth}px`);
      button.style.setProperty("--hb-h", `${button.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (phase !== "holding") return undefined;
    const cancel = () => releaseRef.current({ drifted: true });
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase]);

  useEffect(() => {
    const t = timers.current;
    const m = motion.current;
    return () => {
      window.clearTimeout(t.complete);
      window.clearTimeout(t.reset);
      cancelAnimationFrame(m.raf);
    };
  }, []);

  const labels = (
    <>
      <span aria-hidden={phase === "done"} className="hold-button__idle">
        {icon ? <span className="hold-button__icon">{icon}</span> : null}
        {children}
      </span>
      <span aria-hidden={phase !== "done"} className="hold-button__done">
        {doneIcon ? <span className="hold-button__icon">{doneIcon}</span> : null}
        {doneLabel}
      </span>
    </>
  );

  return (
    <button
      aria-describedby={hintId}
      className={`hold-button hold-button--${size}${className ? ` ${className}` : ""}`}
      data-direction={fillDirection === "up" ? "up" : "right"}
      data-glow={glow ? "true" : undefined}
      data-input={input ?? undefined}
      data-phase={phase}
      disabled={disabled}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (inputRef.current === "key") release({ drifted: true });
          return;
        }
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!event.repeat) begin("key");
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (inputRef.current === "key") release();
        }
      }}
      onLostPointerCapture={(event) => endPointer(event, { drifted: true })}
      onPointerCancel={(event) => endPointer(event, { drifted: true })}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || gesture.current.pointerId !== null) return;
        if (!begin("pointer")) return;
        gesture.current.pointerId = event.pointerId;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* not capturable */
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") endPointer(event, { drifted: true });
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== gesture.current.pointerId) return;
        const rect = gesture.current.rect;
        if (!rect) return;
        const out =
          event.clientX < rect.left - HIT_PAD ||
          event.clientX > rect.right + HIT_PAD ||
          event.clientY < rect.top - HIT_PAD ||
          event.clientY > rect.bottom + HIT_PAD;
        if (out) endPointer(event, { drifted: true });
      }}
      onPointerUp={(event) => endPointer(event)}
      ref={buttonRef}
      style={
        {
          "--hb-radius": `${radius}px`,
          "--hb-bg": backgroundColor,
          "--hb-fill": fillColor,
          "--hb-text": textColor,
          "--hb-fill-text": fillTextColor,
          "--hb-hold": `${holdTime}ms`,
          "--hb-cycles": holdTime / 1100,
          "--hb-release": `${releaseTime}ms`,
          "--hb-press": pressScale,
          "--hb-wave": `${wave ? waveAmplitude : 0}px`,
        } as CSSProperties
      }
      type="button"
    >
      <span aria-hidden="true" className="hold-button__pulse" />
      <span className="hold-button__label">{labels}</span>
      <span aria-hidden="true" className="hold-button__clip">
        <span className="hold-button__fill">
          <span className="hold-button__label hold-button__label--fill">{labels}</span>
        </span>
        <span aria-hidden="true" className="hold-button__crest">
          <span className="hold-button__label hold-button__label--fill">{labels}</span>
        </span>
      </span>
      <span className="hold-button__sr" id={hintId}>
        Press and hold for {Math.round(holdTime / 100) / 10} seconds to confirm
      </span>
    </button>
  );
}
