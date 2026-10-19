import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The card dolphinamp.xyz unfurls into (2026-10-19: the home page had none, so a shared link showed no
 * image). The art direction the owner approved for the live-run card (app/live/[slug]/opengraph-image.tsx):
 * an italic serif voice line, the wide heavy name, the gold dolphin leaping in front of it. Three things
 * only, and no number - a cached card outlives any figure (AGENTS.md SS5).
 */

export const alt = "Dolphin — the AI agent marketplace on BNB Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "public", "fonts", file));

async function dataUri(file: string, type: string) {
  return `data:${type};base64,${(await readFile(join(process.cwd(), "public", file))).toString("base64")}`;
}

export default async function OpengraphImage() {
  const [dolphin, display, serifItalic, sans] = await Promise.all([
    dataUri("live/gold-dolphin-cut.png", "image/png"),
    font("unbounded-800.woff"),
    font("instrument-serif-italic.woff"),
    font("geist-600.woff"),
  ]);

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", background: "#000", fontFamily: "Geist", color: "#fafafa" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "radial-gradient(700px 420px at 72% 38%, rgba(243,193,58,0.13), rgba(0,0,0,0) 70%)" }} />
        <span style={{ position: "absolute", left: 58, top: 176, display: "flex", fontFamily: "Unbounded", fontSize: 176, lineHeight: 1, color: "#fafafa" }}>Dolphin</span>
        {/* Under the name, where the dolphin's body leaves the line whole. */}
        <span style={{ position: "absolute", left: 66, top: 382, display: "flex", fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 50, color: "#cfcfc8" }}>
          The AI agent marketplace on BNB Chain
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
        <img alt="" height={676} src={dolphin} style={{ position: "absolute", top: -23, left: 40, width: 1200, height: 676 }} width={1200} />
        <span style={{ position: "absolute", left: 66, bottom: 52, display: "flex", fontSize: 26, color: "#b4b4ad" }}>dolphinamp.xyz</span>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: sans, style: "normal", weight: 600 },
        { name: "Unbounded", data: display, style: "normal", weight: 800 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
      ],
    },
  );
}
