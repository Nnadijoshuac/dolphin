import type { Candle } from "./strategy";

/**
 * JEV, THE FIRST BRAIN IN THE BRAIN PORT (owner, 2026-10-13). TypeSafe AI's "System One" decision model:
 * it answers typed questions with probabilities instead of writing text, which is the shape a trade gate
 * wants. Shape from TypeSafe's docs as mirrored by LiteLLM's pass-through page and a tested dev.to guide
 * (2026-10-13): POST {base}/v1/systemone, Bearer key, body { model, state, questions }, a `choice`
 * question with `criteria`, answer { choice, probabilities, confidence }. NOT YET RUN AGAINST THE LIVE
 * API from here - early access is waitlisted and Dolphin has no key. The first real call is the test.
 * Fixed host, so a plain fetch: safeFetch is for URLs a stranger chose.
 */
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const TIMEOUT_MS = 8_000;

export type JevVerdict = { take: boolean; pct: number; model: string | null };

/** The market as plain text: the last day of closes and how far they moved. Jev reads text only. */
export function jevState(market: string, timeframe: string, candles: readonly Candle[], reason: string, action: "buy" | "short"): string {
  const recent = candles.slice(-48);
  const last = recent[recent.length - 1];
  const first = recent[0];
  const movePct = first && last ? ((last.close - first.close) / first.close) * 100 : 0;
  const closes = recent.map((candle) => Number(candle.close.toPrecision(6))).join(", ");
  return [
    `Market: ${market}, ${timeframe} candles.`,
    `A trading rule wants to ${action === "short" ? "open a short" : "buy"} now. Its reason: ${reason}`,
    `Last ${recent.length} closes, oldest first: ${closes}.`,
    `Move over those candles: ${movePct.toFixed(2)}%.`,
  ].join("\n");
}

/** Asks Jev whether to take the entry. Throws on any failure: the caller treats that as "do not trade". */
export async function askJev(apiKey: string, state: string): Promise<JevVerdict> {
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JEV_MODEL,
      state,
      questions: {
        entry: {
          type: "choice",
          instructions: "Decide whether this trade entry is worth taking now, judged only on the price action described.",
          criteria: {
            take: "The setup looks sound: take the trade.",
            skip: "The setup looks weak or risky: skip this one.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Jev refused the key. Check TYPESAFE_API_KEY in Keys.");
  if (response.status === 429) throw new Error("Jev is rate-limiting this key. The rule skips this entry.");
  if (!response.ok) throw new Error(`Jev answered ${response.status}. The rule skips this entry.`);
  const body = (await response.json()) as { model?: string; answers?: { entry?: { choice?: string; probabilities?: Record<string, number> } } };
  const answer = body.answers?.entry;
  const takeProbability = answer?.probabilities?.take;
  if (!answer || typeof takeProbability !== "number" || !Number.isFinite(takeProbability)) throw new Error("Jev's answer had no probability. The rule skips this entry.");
  const pct = Math.round(takeProbability * 100);
  return { take: answer.choice === "take", pct, model: typeof body.model === "string" ? body.model : null };
}
