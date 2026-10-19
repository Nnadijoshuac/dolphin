import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { fetchLiveRun } from "@/server/convex";

/**
 * THE CARD A SHARED RUN UNFURLS INTO (owner, 2026-10-19: "the post on X does not have a preview... preview
 * cards must have great images"). Art first, data set on it - the look the owner chose for every shareable
 * surface: the liquid-gold leaping dolphin render (public/live/gold-dolphin.jpg, the art approved for the live
 * stream's thumbnail) full-bleed, the type on its black side.
 *
 * Like the agent card (app/agent/[id]/opengraph-image.tsx) it carries NO LIVE NUMBER: platforms cache a card
 * indefinitely with no timestamp, so a balance on it would still circulate weeks later as if current (AGENTS.md
 * SS5). Its one big number is what the run STARTED with - true forever. The live figure travels in the post
 * text, written at the moment of sharing.
 */

export const alt = "An AI agent trading real money live on Dolphin";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

const INK = "#fafafa";
const MUTED = "#b4b4ad";
const GOLD = "#f3c13a";
const GREEN = "#3ddc84";

/*
 * Display type with character (owner, 2026-10-19: "interesting fonts... old English... unusual fonts you see in
 * very nice design and branding"): the name in blackletter, UnifrakturMaguntia; the line and the number in
 * Instrument Serif, the site's own serif. Both SIL Open Font License, in public/fonts.
 */
const font = (file: string) => readFile(join(process.cwd(), "public", "fonts", file));

async function dataUri(file: string, type: string) {
  return `data:${type};base64,${(await readFile(join(process.cwd(), "public", file))).toString("base64")}`;
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [run, art, logo, blackletter, serif, serifItalic, sans] = await Promise.all([
    fetchLiveRun(decodeURIComponent(slug)),
    dataUri("live/gold-dolphin.jpg", "image/jpeg"),
    dataUri("dolphin-logo.png", "image/png"),
    font("unifraktur-maguntia.woff"),
    font("instrument-serif.woff"),
    font("instrument-serif-italic.woff"),
    font("geist-600.woff"),
  ]);

  const name = run?.name ?? "A live run";
  const coins = [...new Set((run?.desk ?? []).map((rule) => (rule.market ?? run?.market ?? "").replace("USDT", "")).filter(Boolean))];
  const started = run ? `$${run.startUsd.toFixed(2)}` : null;
  const day = run ? new Date(run.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", background: "#000", fontFamily: "Geist", color: INK }}>
        {/* the art, full-bleed */}
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
        <img alt="" height={676} src={art} style={{ position: "absolute", top: -23, left: 0, width: 1200, height: 676, objectFit: "cover" }} width={1200} />
        {/* the type's side kept black, so the words read on any screen */}
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(90deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.75) 38%, rgba(0,0,0,0) 62%)" }} />

        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: 720, height: "100%", padding: "56px 0 56px 68px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 999, background: GOLD }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img */}
              <img alt="" height={32} src={logo} width={32} />
            </div>
            <span style={{ fontSize: 28, fontWeight: 600 }}>Dolphin</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 8, padding: "8px 18px", borderRadius: 999, background: "rgba(61,220,132,0.14)", color: GREEN, fontSize: 22, fontWeight: 700 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: GREEN }} />
              LIVE
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ display: "flex", fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 40, color: MUTED }}>An AI agent trading real money</span>
            <span style={{ display: "flex", marginTop: 4, fontFamily: "Unifraktur", fontSize: name.length > 16 ? 100 : 128, lineHeight: 1.0, color: INK }}>{name}</span>
            {started ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 22 }}>
                <span style={{ fontFamily: "Instrument Serif", fontSize: 84, lineHeight: 1, color: GOLD }}>{started}</span>
                <span style={{ fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 32, color: MUTED }}>to start · {day}</span>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {(coins.length ? coins : ["BNB"]).map((coin) => (
              <span key={coin} style={{ display: "flex", padding: "8px 18px", borderRadius: 999, border: "2px solid rgba(255,255,255,0.18)", fontSize: 24, fontWeight: 600 }}>
                {coin}
              </span>
            ))}
            <span style={{ display: "flex", marginLeft: 10, fontSize: 24, color: MUTED }}>every trade on BNB Chain</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        // First, so every small label (brand, LIVE, coins) falls back to the site's own sans.
        { name: "Geist", data: sans, style: "normal", weight: 600 },
        { name: "Unifraktur", data: blackletter, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serif, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
      ],
    },
  );
}
