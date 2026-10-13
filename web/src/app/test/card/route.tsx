import { ImageResponse } from "next/og";

import { parseArgs, persona, signed, strategySentence } from "@/app/test/choices";
import { runStrategyTest } from "@/server/convex";

/**
 * The share card for one strategy test (1200x630). Unlike the agent cards, this one carries a number,
 * because the number is FIXED: a backtest over a finished window that is printed on the card itself, with
 * "fees and gas counted" - the provenance travels with the image (AGENTS.md §5).
 */

const BG = "#0c0d0a";
const INK = "#f4f3ed";
const MUTED = "#9a9b90";
const GOLD = "#f0b90b";
const UP = "#3ccf9e";
const DOWN = "#ff6b5e";

function day(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function path(points: number[], width: number, height: number, min: number, max: number): string {
  const span = max - min || 1;
  return points
    .map((value, index) => `${index === 0 ? "M" : "L"}${((index / Math.max(1, points.length - 1)) * width).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`)
    .join(" ");
}

export async function GET(request: Request) {
  const args = parseArgs(new URL(request.url).searchParams);
  // X keeps a card for days: one retry before falling back to the plain one.
  const result = (await runStrategyTest(args)) ?? (await runStrategyTest(args));
  if (!result) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BG, color: INK, fontSize: 56 }}>
          Would your strategy have survived?
        </div>
      ),
      { width: 1200, height: 630, headers: { "Cache-Control": "no-store" } },
    );
  }
  const who = persona(result);
  const you = result.curve.map((point) => point.you);
  const hold = result.curve.map((point) => point.hold);
  const min = Math.min(...you, ...hold);
  const max = Math.max(...you, ...hold);
  const beat = Math.round((result.resultPct - result.holdPct) * 10) / 10;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: INK, padding: "56px 64px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, color: GOLD, letterSpacing: 4, textTransform: "uppercase" }}>{who.title}</div>
          <div style={{ display: "flex", fontSize: 24, color: MUTED }}>dolphinamp.xyz/test</div>
        </div>
        <div style={{ display: "flex", marginTop: 28, gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 520 }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 800, lineHeight: 1, color: result.resultPct >= 0 ? UP : DOWN, letterSpacing: -6 }}>{signed(result.resultPct)}</div>
            <div style={{ display: "flex", fontSize: 30, marginTop: 18, color: INK }}>
              {`Just holding ${result.coin}: ${signed(result.holdPct)}`}
            </div>
            <div style={{ display: "flex", fontSize: 30, marginTop: 6, color: beat >= 0 ? UP : DOWN }}>
              {beat >= 0 ? `${beat} points better than holding` : `${Math.abs(beat)} points worse than holding`}
            </div>
            <div style={{ display: "flex", fontSize: 24, marginTop: 26, color: MUTED, lineHeight: 1.35 }}>{strategySentence(args)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <svg height="300" viewBox="0 0 520 300" width="520">
              <path d={path(hold, 520, 300, min, max)} fill="none" stroke={MUTED} strokeDasharray="8 8" strokeWidth="4" />
              <path d={path(you, 520, 300, min, max)} fill="none" stroke={GOLD} strokeWidth="7" />
            </svg>
            <div style={{ display: "flex", gap: 28, fontSize: 22, marginTop: 14, color: MUTED }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: GOLD }}>
                <div style={{ display: "flex", width: 28, height: 5, borderRadius: 3, background: GOLD }} />
                this strategy
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", width: 28, height: 0, borderTop: `4px dashed ${MUTED}` }} />
                just holding
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", fontSize: 22, color: MUTED }}>
          <div style={{ display: "flex" }}>{`Backtest · ${day(result.from)} – ${day(result.to)} · ${result.trades} trades · fees and gas counted`}</div>
          <div style={{ display: "flex", color: INK }}>Test yours →</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
