import { ImageResponse } from "next/og";
import sharp from "sharp";

import { parseArgs, persona, PERSONA_ART, signed, strategySentence } from "@/app/test/choices";
import { runStrategyTest } from "@/server/convex";

/**
 * The share card for one strategy test (1200x630) - the first thing anyone sees on X (owner, 2026-10-13:
 * "this looks very coded... look for good graphic design"). Built like the exchange PnL cards and Spotify
 * Wrapped (campaign/research/ui-refs-2026-10-13): an ARTWORK first, the result set on it. The artwork is a
 * premium render per title (public/test/art-*.jpg); the number, holding and window are the real backtest,
 * printed with "fees counted" so the provenance travels with the image (AGENTS.md §5).
 */

const INK = "#f6f4ec";
const MUTED = "rgba(246,244,236,0.62)";
const GOLD = "#f3c13a";
const UP = "#4fe0ae";
const DOWN = "#ff7466";

const ART = PERSONA_ART;

const GEIST: Record<500 | 800, string> = {
  500: "https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RruM4nQ.ttf",
  800: "https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RHOQ4nQ.ttf",
};
type Font = { name: string; data: ArrayBuffer; weight: 500 | 800; style: "normal" };
let fonts: Promise<Font[]> | null = null;
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    ([500, 800] as const).map(async (weight): Promise<Font> => ({ name: "Geist", data: await (await fetch(GEIST[weight])).arrayBuffer(), weight, style: "normal" })),
  ).catch(() => []);
  return fonts;
}

function day(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * WhatsApp shows no preview for an image over ~300 KB or slow to load, and the art makes the PNG that
 * next/og renders ~840 KB. Re-encoded as a progressive JPEG it is ~100 KB, so every app unfurls it.
 */
async function asJpeg(png: ImageResponse, headers: Record<string, string>): Promise<Response> {
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) } });
}

export async function GET(request: Request) {
  const args = parseArgs(new URL(request.url).searchParams);
  // X keeps a card for days: one retry before falling back to the plain one.
  const [result, loaded] = await Promise.all([runStrategyTest(args).then((first) => first ?? runStrategyTest(args)), loadFonts()]);
  const options = { width: 1200, height: 630, ...(loaded.length ? { fonts: loaded } : {}) };

  if (!result) {
    return asJpeg(new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Geist" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only */}
          <img alt="" height={630} src={new URL(ART["Market Assassin"], request.url).toString()} style={{ position: "absolute", top: 0, left: 0 }} width={1200} />
          <div style={{ display: "flex", margin: "auto 0 auto 72px", fontSize: 64, fontWeight: 800, color: INK, maxWidth: 560, lineHeight: 1.1 }}>Would your strategy have survived?</div>
        </div>
      ),
      options,
    ), { "Cache-Control": "no-store" });
  }

  const who = persona(result);
  const beat = Math.round((result.resultPct - result.holdPct) * 10) / 10;
  const src = new URL(ART[who.title] ?? ART["Market Assassin"], request.url).toString();

  return asJpeg(new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Geist", color: INK }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only */}
        <img alt="" height={630} src={src} style={{ position: "absolute", top: 0, left: 0 }} width={1200} />
        {/* A soft shade under the words so they read on any frame of the art. */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", background: "linear-gradient(90deg, rgba(5,5,4,0.88) 0%, rgba(5,5,4,0.6) 40%, rgba(5,5,4,0) 68%)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "60px 72px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: GOLD }} />
            <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: GOLD, letterSpacing: 3, textTransform: "uppercase" }}>{who.title}</div>
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 168, fontWeight: 800, lineHeight: 1, color: result.resultPct >= 0 ? UP : DOWN }}>{signed(result.resultPct)}</div>
          <div style={{ display: "flex", marginTop: 16, fontSize: 32, fontWeight: 500 }}>{`in a year ${result.coin} did ${signed(result.holdPct)}`}</div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 26, fontWeight: 500, color: beat >= 0 ? UP : DOWN }}>
            {beat >= 0 ? `${beat} points better than holding` : `${Math.abs(beat)} points worse than holding`}
          </div>
          <div style={{ display: "flex", marginTop: 20, maxWidth: 560, fontSize: 21, fontWeight: 500, color: MUTED, lineHeight: 1.4 }}>{strategySentence(args)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>dolphinamp.xyz/test</div>
            <div style={{ display: "flex", fontSize: 17, fontWeight: 500, color: MUTED }}>{`Backtest ${day(result.from)} – ${day(result.to)} · ${result.trades} trades · fees counted`}</div>
          </div>
        </div>
      </div>
    ),
    options,
  ), { "Cache-Control": "public, max-age=300, s-maxage=31536000, stale-while-revalidate=604800" });
}
