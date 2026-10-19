import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { fetchLiveRun } from "@/server/convex";

/**
 * THE CARD A SHARED RUN UNFURLS INTO (owner, 2026-10-19: "the post on X does not have a preview... preview
 * cards must have great images"). Every live run gets it, built from the run's own name.
 *
 * Three things only (owner: "too much information on this card"): the brand with LIVE, one line of voice, the
 * agent's name. Font play from the poster research: an italic serif voice line against a wide, heavy display
 * name, with the liquid-gold dolphin (public/live/gold-dolphin-cut.png, the approved render cut from its black)
 * leaping IN FRONT of the type for depth. Candles along the foot say "trading" at a glance - drawn as a shape,
 * a dip and its recovery, with no axis or price: decoration, not data.
 *
 * NO NUMBER on it: platforms cache a card indefinitely, so a balance would circulate weeks later as if current
 * (AGENTS.md SS5). The live figure travels in the post text, written at the moment of sharing.
 */

export const alt = "An AI agent trading real money live on Dolphin";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

const INK = "#fafafa";
const MUTED = "#cfcfc8";
const GOLD = "#f3c13a";
const GREEN = "#3ddc84";
const RED = "#f6465d";

/* Fonts, SIL Open Font License, public/fonts: Unbounded 800 (the name), Instrument Serif italic (the voice), Geist (labels). */
const font = (file: string) => readFile(join(process.cwd(), "public", "fonts", file));

async function dataUri(file: string, type: string) {
  return `data:${type};base64,${(await readFile(join(process.cwd(), "public", file))).toString("base64")}`;
}

/* A drift up, a sharp dip, the recovery - the shape every dip-buyer knows. Closes in arbitrary units. */
const CLOSES = [50, 52, 51, 54, 53, 56, 55, 58, 56, 53, 49, 45, 40, 36, 33, 35, 39, 42, 41, 45, 48, 51, 50, 54, 57, 60];
const CANDLE_TOP = 440;
const CANDLE_BOTTOM = 610;
const LO = 30;
const HI = 63;
const y = (price: number) => CANDLE_BOTTOM - ((price - LO) / (HI - LO)) * (CANDLE_BOTTOM - CANDLE_TOP);
const STEP = 1200 / CLOSES.length;
const candles = CLOSES.map((close, i) => {
  const open = i === 0 ? close - 1 : CLOSES[i - 1];
  const up = close >= open;
  const high = Math.max(open, close) + 1.6;
  const low = Math.min(open, close) - 1.6;
  return { x: i * STEP + STEP / 2, up, top: y(Math.max(open, close)), bottom: y(Math.min(open, close)), wickTop: y(high), wickBottom: y(low) };
});

/* Unbounded is wide (~0.72em a glyph): size the name to the width it has, so any run's name fits on the card. */
function nameSize(name: string) {
  return Math.max(76, Math.min(168, Math.floor(1060 / (name.length * 0.72))));
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [run, dolphin, logo, display, serifItalic, sans] = await Promise.all([
    fetchLiveRun(decodeURIComponent(slug)),
    dataUri("live/gold-dolphin-cut.png", "image/png"),
    dataUri("dolphin-logo.png", "image/png"),
    font("unbounded-800.woff"),
    font("instrument-serif-italic.woff"),
    font("geist-600.woff"),
  ]);

  const name = run?.name ?? "A live run";

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", background: "#000", fontFamily: "Geist", color: INK }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "radial-gradient(700px 420px at 72% 38%, rgba(243,193,58,0.13), rgba(0,0,0,0) 70%)" }} />

        {/* the candles, under everything else */}
        {candles.map((c, i) => (
          <div key={i} style={{ position: "absolute", left: c.x - 9, top: c.wickTop, width: 18, height: c.wickBottom - c.wickTop, display: "flex", justifyContent: "center", opacity: 0.38 }}>
            <div style={{ position: "absolute", left: 8, top: 0, width: 2, height: c.wickBottom - c.wickTop, background: c.up ? GREEN : RED }} />
            <div style={{ position: "absolute", left: 0, top: c.top - c.wickTop, width: 18, height: Math.max(3, c.bottom - c.top), borderRadius: 2, background: c.up ? GREEN : RED }} />
          </div>
        ))}
        {/* the candles fade into the black at the very foot */}
        <div style={{ position: "absolute", left: 0, top: 520, width: 1200, height: 110, display: "flex", background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)" }} />

        <span style={{ position: "absolute", left: 66, top: 156, display: "flex", fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 48, color: MUTED }}>An AI agent trading real money</span>
        <span style={{ position: "absolute", left: 58, top: 216, display: "flex", maxWidth: 1100, fontFamily: "Unbounded", fontSize: nameSize(name), lineHeight: 1, color: INK }}>{name}</span>

        {/* the dolphin leaps in front of the name */}
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
        <img alt="" height={676} src={dolphin} style={{ position: "absolute", top: -23, left: 40, width: 1200, height: 676 }} width={1200} />

        <div style={{ position: "absolute", left: 66, top: 52, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 999, background: GOLD }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
            <img alt="" height={30} src={logo} width={30} />
          </div>
          <span style={{ fontSize: 27, fontWeight: 600 }}>Dolphin</span>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: 6, padding: "7px 16px", borderRadius: 999, background: "rgba(61,220,132,0.14)", color: GREEN, fontSize: 21, fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: GREEN }} />
            LIVE
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        // First, so every small label falls back to the site's own sans.
        { name: "Geist", data: sans, style: "normal", weight: 600 },
        { name: "Unbounded", data: display, style: "normal", weight: 800 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
      ],
    },
  );
}
