import type { StrategyTestArgs, StrategyTestResult } from "@/convex/api";

/*
 * The fixed choices of "Would your strategy have survived?" - the same closed sets convex/strategyTest.ts
 * accepts (web/ cannot import convex/, so they are mirrored here by hand; a value the backend refuses
 * shows the page's error state, never a made-up result).
 */
export const COINS = ["BNB", "BTC", "ETH", "SOL"] as const;

export type EntryKey = "dip" | "rsi" | "trend" | "momentum";
export const ENTRIES: { key: EntryKey; label: string; levels: readonly number[]; words: (level: number) => string; unit: string }[] = [
  { key: "dip", label: "Buy the dip", levels: [3, 5, 8, 12], words: (level) => `it drops ${level}% in a day`, unit: "% drop" },
  { key: "rsi", label: "Oversold", levels: [25, 30, 35, 40], words: (level) => `RSI falls under ${level}`, unit: "RSI" },
  { key: "trend", label: "Dip in an uptrend", levels: [35, 40, 45], words: (level) => `it dips (RSI under ${level}) while the trend is up`, unit: "RSI" },
  { key: "momentum", label: "Chase the pump", levels: [3, 5, 8], words: (level) => `it pumps ${level}% in a day`, unit: "% pump" },
];
export const TARGETS = [2, 3, 5, 8, 12, 20] as const;
export const STOPS = [2, 3, 5, 8, 12] as const;

/** The window ends YESTERDAY (UTC): a finished day, so a shared link always shows the same result. */
export function defaultTo(now = Date.now()): string {
  return new Date(now - 86_400_000).toISOString().slice(0, 10);
}

export const DEFAULT_ARGS: Omit<StrategyTestArgs, "to"> = { coin: "BNB", entry: "dip", level: 5, target: 5, stop: 5 };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return typeof value === "string" ? value : null;
}

/** Choices from a link, each falling back to its default when missing or unknown. */
export function parseArgs(params: Params, now = Date.now()): StrategyTestArgs {
  const coin = read(params, "coin")?.toUpperCase() ?? "";
  const entryKey = read(params, "entry") ?? "";
  const entry = ENTRIES.find((candidate) => candidate.key === entryKey) ?? ENTRIES.find((candidate) => candidate.key === DEFAULT_ARGS.entry)!;
  const level = Number(read(params, "level"));
  const target = read(params, "target");
  const stop = read(params, "stop");
  const to = read(params, "to") ?? "";
  const parsedTarget = target === "none" ? null : TARGETS.includes(Number(target) as (typeof TARGETS)[number]) ? Number(target) : DEFAULT_ARGS.target;
  const parsedStop = stop === "none" ? null : STOPS.includes(Number(stop) as (typeof STOPS)[number]) ? Number(stop) : DEFAULT_ARGS.stop;
  return {
    coin: (COINS as readonly string[]).includes(coin) ? coin : DEFAULT_ARGS.coin,
    entry: entry.key,
    level: entry.levels.includes(level) ? level : entry.levels[Math.min(1, entry.levels.length - 1)],
    target: parsedTarget === null && parsedStop === null ? DEFAULT_ARGS.target : parsedTarget,
    stop: parsedStop,
    to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : defaultTo(now),
  };
}

export function toQuery(args: StrategyTestArgs): string {
  const query = new URLSearchParams({
    coin: args.coin,
    entry: args.entry,
    level: String(args.level),
    target: args.target === null ? "none" : String(args.target),
    stop: args.stop === null ? "none" : String(args.stop),
    to: args.to,
  });
  return query.toString();
}

/** A title the result earns - the thing people share. Derived from the result only, never invented. */
export function persona(result: Pick<StrategyTestResult, "resultPct" | "holdPct" | "trades">): { title: string; line: string } {
  if (result.trades === 0 && result.resultPct === 0) return { title: "The Ghost", line: "Never pulled the trigger all year." };
  if (result.resultPct >= 20) return { title: "Market Assassin", line: "Made real money in a year that punished most." };
  if (result.resultPct > 0) return { title: "The Survivor", line: "Came out ahead. Most strategies didn't." };
  if (result.resultPct > result.holdPct) return { title: "Bruised, not broken", line: "Lost money, but less than just holding." };
  return { title: "Should've just held", line: "Doing nothing would have done better." };
}

export function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

export function strategySentence(args: StrategyTestArgs): string {
  const entry = ENTRIES.find((candidate) => candidate.key === args.entry) ?? ENTRIES[0];
  const exits = [args.target !== null ? `sell at +${args.target}%` : null, args.stop !== null ? `cut losses at −${args.stop}%` : null].filter(Boolean);
  return `Buy ${args.coin} when ${entry.words(args.level)}, ${exits.join(" or ")}.`;
}

/**
 * One artwork per title (public/test, renders reviewed by the owner), shared by the page and the share card
 * so both are the same picture. The Survivor borrows the leap and The Ghost the seabed until they get their own.
 */
export const PERSONA_ART: Record<string, string> = {
  "Market Assassin": "/test/art-assassin.jpg",
  "The Survivor": "/test/art-assassin.jpg",
  "Bruised, not broken": "/test/art-bruised.jpg",
  "Should've just held": "/test/art-held.jpg",
  "The Ghost": "/test/art-held.jpg",
};
