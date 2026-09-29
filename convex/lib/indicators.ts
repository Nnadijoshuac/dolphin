/**
 * TECHNICAL INDICATORS - computed in code, on CLOSED candles only, so the
 * Brain never does the arithmetic and never sees a candle that could still
 * change. (Owner, 2026-09-29: blocks for the technical traders; mentor review:
 * closed candles only.)
 *
 * Used by the Indicators block (read every run) and the Signal trigger
 * (fires when a condition turns true on a newly closed candle).
 */

export type OHLCV = [number, number, number, number, number, number?];

export function smaSeries(values: readonly number[], length: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    let sum = 0;
    for (let i = index - length + 1; i <= index; i++) sum += values[i];
    return sum / length;
  });
}

export function emaSeries(values: readonly number[], length: number): (number | null)[] {
  const k = 2 / (length + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  values.forEach((value, index) => {
    if (index + 1 < length) {
      out.push(null);
      return;
    }
    if (ema === null) {
      ema = values.slice(index - length + 1, index + 1).reduce((sum, v) => sum + v, 0) / length;
    } else {
      ema = value * k + ema * (1 - k);
    }
    out.push(ema);
  });
  return out;
}

/** Wilder's RSI for every index (null until there is enough history). */
export function rsiSeries(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** MACD (12, 26, 9): line, signal and histogram for every index. */
export function macdSeries(closes: readonly number[]) {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) => (fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null));
  const defined = line.filter((value): value is number => value !== null);
  const signalDefined = emaSeries(defined, 9);
  const offset = line.length - defined.length;
  const signal = line.map((_, i) => (i < offset ? null : signalDefined[i - offset]));
  return { line, signal, histogram: line.map((value, i) => (value !== null && signal[i] !== null ? value - signal[i]! : null)) };
}

export type SignalCondition = "rsiBelow" | "rsiAbove" | "maCrossUp" | "maCrossDown" | "macdCrossUp" | "macdCrossDown";
export const SIGNAL_CONDITIONS: readonly SignalCondition[] = ["rsiBelow", "rsiAbove", "maCrossUp", "maCrossDown", "macdCrossUp", "macdCrossDown"];

export function describeCondition(condition: SignalCondition, level: number | null): string {
  switch (condition) {
    case "rsiBelow":
      return `RSI falls below ${level ?? 30}`;
    case "rsiAbove":
      return `RSI rises above ${level ?? 70}`;
    case "maCrossUp":
      return "20 crosses above 50 (golden cross)";
    case "maCrossDown":
      return "20 crosses below 50 (death cross)";
    case "macdCrossUp":
      return "MACD crosses above its signal";
    case "macdCrossDown":
      return "MACD crosses below its signal";
  }
}

/**
 * Whether the condition is met on the LAST closed candle. Crosses compare the
 * last two closed candles; level conditions compare the last one.
 */
export function conditionMet(closes: readonly number[], condition: SignalCondition, level: number | null): boolean {
  const last = closes.length - 1;
  if (last < 1) return false;
  if (condition === "rsiBelow" || condition === "rsiAbove") {
    const rsi = rsiSeries(closes)[last];
    if (rsi === null) return false;
    return condition === "rsiBelow" ? rsi < (level ?? 30) : rsi > (level ?? 70);
  }
  if (condition === "maCrossUp" || condition === "maCrossDown") {
    const fast = smaSeries(closes, 20);
    const slow = smaSeries(closes, 50);
    if (fast[last - 1] === null || slow[last - 1] === null) return false;
    const before = fast[last - 1]! - slow[last - 1]!;
    const now = fast[last]! - slow[last]!;
    return condition === "maCrossUp" ? before <= 0 && now > 0 : before >= 0 && now < 0;
  }
  const { histogram } = macdSeries(closes);
  if (histogram[last - 1] === null || histogram[last] === null) return false;
  return condition === "macdCrossUp" ? histogram[last - 1]! <= 0 && histogram[last]! > 0 : histogram[last - 1]! >= 0 && histogram[last]! < 0;
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return Math.abs(value) >= 1 ? value.toFixed(digits) : value.toPrecision(4);
}

/** The Indicators block's report for the Brain. */
export function indicatorReport(candles: readonly OHLCV[], timeframeLabel: string): string {
  const closes = candles.map((candle) => candle[4]);
  const volumes = candles.map((candle) => candle[5] ?? 0);
  if (closes.length < 30) return `Indicators (${timeframeLabel}): not enough closed candles yet (${closes.length}).`;
  const last = closes.length - 1;
  const rsi = rsiSeries(closes)[last];
  const macd = macdSeries(closes);
  const sma20 = smaSeries(closes, 20);
  const sma50 = smaSeries(closes, 50);
  const mid = sma20[last]!;
  const window = closes.slice(-20);
  const sd = Math.sqrt(window.reduce((sum, v) => sum + (v - mid) ** 2, 0) / window.length);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const percentB = upper === lower ? null : (closes[last] - lower) / (upper - lower);
  const avgVolume = volumes.slice(-21, -1).reduce((sum, v) => sum + v, 0) / Math.max(1, Math.min(20, volumes.length - 1));
  const crossed = (["maCrossUp", "maCrossDown", "macdCrossUp", "macdCrossDown"] as const).filter((c) => conditionMet(closes, c, null));
  return (
    `Indicators on ${closes.length} CLOSED ${timeframeLabel} candles (the last one opened ${new Date(candles[last][0] * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC): ` +
    `RSI(14) ${fmt(rsi, 1)}; ` +
    `MACD(12,26,9) line ${fmt(macd.line[last], 4)}, signal ${fmt(macd.signal[last], 4)}, histogram ${fmt(macd.histogram[last], 4)}; ` +
    `Bollinger(20,2) ${fmt(lower, 4)} - ${fmt(upper, 4)}, %B ${fmt(percentB, 2)}; ` +
    `20-average ${fmt(sma20[last], 4)}, 50-average ${sma50[last] === null ? "not enough history" : fmt(sma50[last], 4)}; ` +
    `volume ${avgVolume > 0 ? `${fmt(volumes[last] / avgVolume, 2)}x its 20-candle average` : "unknown"}. ` +
    (crossed.length ? `Just happened on the last candle: ${crossed.map((c) => describeCondition(c, null)).join("; ")}.` : "No cross on the last candle.")
  );
}
