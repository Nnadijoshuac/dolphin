"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { COINS, ENTRIES, persona, PERSONA_ART, signed, STOPS, strategySentence, TARGETS, toQuery, type EntryKey } from "@/app/test/choices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StrategyTestArgs, StrategyTestResult } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * WOULD YOUR STRATEGY HAVE SURVIVED? (owner, 2026-10-13: "this looks very coded... look for good graphic
 * design"). Art-directed like the exchange PnL cards and Spotify Wrapped: an artwork per result title
 * (public/test), and the result on the page IS the share card - same art, same words - so what you see is
 * what you post. shadcn/ui controls, re-skinned dark by .test-dark (globals.css). Normal letter-spacing.
 * Every number comes from convex/strategyTest.ts through the cached /api/strategy-test.
 */
export function StrategyTest({ initial }: { initial: StrategyTestArgs }) {
  const [args, setArgs] = useState<StrategyTestArgs>(initial);
  const [result, setResult] = useState<StrategyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const query = toQuery(args);
  const loading = settled !== query;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/strategy-test?${query}`, { signal: controller.signal })
        .then(async (response) => {
          const body = (await response.json()) as { result?: StrategyTestResult; error?: string };
          if (!response.ok || !body.result) throw new Error(body.error ?? "The test could not run.");
          setResult(body.result);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "The test could not run.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSettled(query);
        });
    }, 150);
    window.history.replaceState(null, "", `/test?${query}`);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const set = (change: Partial<StrategyTestArgs>) => setArgs((current) => ({ ...current, ...change }));
  const entry = ENTRIES.find((candidate) => candidate.key === args.entry) ?? ENTRIES[0];
  const coin = result?.coin ?? args.coin;

  return (
    <div className="test-dark min-h-screen pb-24">
      {/* The hero is the artwork itself. */}
      <section className="relative isolate overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static, pre-sized artwork */}
        <img alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-right opacity-90" src="/test/art-assassin.jpg" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#080807] via-[#080807]/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-[#080807] to-transparent" />
        <div className="mx-auto w-[min(100%-32px,1200px)] py-16 sm:py-24">
          <p className="text-sm font-medium text-accent-ink">Strategy test · free · no sign-up</p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.12] font-bold sm:text-6xl sm:leading-[1.08]">
            {result ? `${coin} ${result.holdPct < 0 ? "fell" : "rose"} ${Math.abs(result.holdPct).toFixed(0)}% this year.` : "The market had a year."}
            <span className="block text-ink-soft">Would your strategy have survived?</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-muted">Pick when to buy and when to sell. Dolphin replays it on every 4-hour price of the last 12 months, fees and gas counted.</p>
        </div>
      </section>

      <div className="mx-auto mt-2 grid w-[min(100%-32px,1200px)] items-start gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Your strategy</CardTitle>
            <CardDescription>{strategySentence(args)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field label="Coin">
              <ToggleGroup onValueChange={(next) => next && set({ coin: next })} type="single" value={args.coin}>
                {COINS.map((option) => (
                  <ToggleGroupItem key={option} value={option}>
                    {option}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field label="Buy when">
              <ToggleGroup
                className="grid grid-cols-2"
                onValueChange={(key) => {
                  if (!key) return;
                  const next = ENTRIES.find((candidate) => candidate.key === key)!;
                  set({ entry: key as EntryKey, level: next.levels.includes(args.level) ? args.level : next.levels[Math.min(1, next.levels.length - 1)] });
                }}
                type="single"
                value={args.entry}
              >
                {ENTRIES.map((candidate) => (
                  <ToggleGroupItem className="h-10 justify-start" key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup className="mt-2" onValueChange={(level) => level && set({ level: Number(level) })} type="single" value={String(args.level)}>
                {entry.levels.map((level) => (
                  <ToggleGroupItem key={level} value={String(level)}>
                    {entry.key === "rsi" || entry.key === "trend" ? `RSI < ${level}` : `−${level}%`.replace("−", entry.key === "momentum" ? "+" : "−")}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field label="Take profit">
              <ToggleGroup onValueChange={(target) => target && set({ target: Number(target) })} type="single" value={args.target === null ? "" : String(args.target)}>
                {TARGETS.map((target) => (
                  <ToggleGroupItem key={target} value={String(target)}>
                    +{target}%
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field label="Stop loss">
              <ToggleGroup onValueChange={(stop) => stop && set({ stop: stop === "none" ? null : Number(stop) })} type="single" value={args.stop === null ? "none" : String(args.stop)}>
                {STOPS.map((stop) => (
                  <ToggleGroupItem key={stop} value={String(stop)}>
                    −{stop}%
                  </ToggleGroupItem>
                ))}
                {args.target !== null ? <ToggleGroupItem value="none">None</ToggleGroupItem> : null}
              </ToggleGroup>
            </Field>
          </CardContent>
        </Card>

        <Result args={args} error={error} loading={loading} result={result} />
      </div>

      <p className="mx-auto mt-10 w-[min(100%-32px,1200px)] text-xs text-muted">
        A backtest on Binance prices, $100 a trade, PancakeSwap fees and gas counted. Past results don&rsquo;t predict what happens next. Not financial advice.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

/** React Bits' CountUp behaviour (reactbits.dev/text-animations/count-up): eases from the last value to the new one. */
function useCountUp(target: number | null): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number>(0);
  useEffect(() => {
    if (target === null) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      setShown(origin + (target - origin) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

function day(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Result({ args, result, loading, error }: { args: StrategyTestArgs; result: StrategyTestResult | null; loading: boolean; error: string | null }) {
  const router = useRouter();
  const shown = useCountUp(result ? result.resultPct : null);

  if (error && !result) {
    return (
      <Card>
        <CardContent className="text-sm text-[#ff7466]">{error}</CardContent>
      </Card>
    );
  }
  if (!result || shown === null) return <div className="skeleton aspect-[1200/630] w-full rounded-2xl" />;

  const who = persona(result);
  const beat = Math.round((result.resultPct - result.holdPct) * 10) / 10;
  const up = result.resultPct >= 0;
  const link = () => `${window.location.origin}/test?${toQuery(args)}`;
  const share = () => {
    const text = `My ${result.coin} strategy: ${signed(result.resultPct)} in a year.\nJust holding: ${signed(result.holdPct)}.\n\n${who.title}. Would yours have survived?`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${link()}&ref=test-share`)}`, "_blank", "noopener,noreferrer");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${link()}&ref=test-link`);
      toast.success("Link copied. Its preview shows this card.");
    } catch {
      toast.error("Could not copy. Copy it from the address bar.");
    }
  };
  const build = async () => {
    try {
      await navigator.clipboard.writeText(`${strategySentence(args)} I have $50.`);
      toast.success("Strategy copied. Paste it into Dolphin and it builds the agent.");
    } catch {
      // The builder still opens; they can type it.
    }
    router.push("/dolphin?ref=test-build");
  };

  return (
    <div className={`grid gap-4 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
      {/* The share card, live: the same art and words as /test/card, scaled with the card's width. */}
      <figure className="@container relative isolate aspect-[1200/630] w-full overflow-hidden rounded-2xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static, pre-sized artwork */}
        <img alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" key={who.title} src={PERSONA_ART[who.title] ?? PERSONA_ART["Market Assassin"]} />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#050504]/90 via-[#050504]/60 via-40% to-transparent to-70%" />
        <div className="flex h-full flex-col p-[5.5cqw]">
          <p className="flex items-center gap-[1cqw] text-[2cqw] font-medium tracking-[0.12em] text-[#f3c13a] uppercase">
            <span className="size-[0.85cqw] rounded-full bg-[#f3c13a]" />
            {who.title}
          </p>
          <p className={`mt-[1.6cqw] text-[13.5cqw] leading-none font-extrabold tabular-nums ${up ? "text-[#4fe0ae]" : "text-[#ff7466]"}`}>{signed(Math.round(shown * 10) / 10)}</p>
          <p className="mt-[1.4cqw] text-[2.7cqw] font-medium">
            in a year {result.coin} did {signed(result.holdPct)}
          </p>
          <p className={`mt-[0.6cqw] text-[2.2cqw] font-medium ${beat >= 0 ? "text-[#4fe0ae]" : "text-[#ff7466]"}`}>{beat >= 0 ? `${beat} points better than holding` : `${Math.abs(beat)} points worse than holding`}</p>
          <p className="mt-[1.6cqw] max-w-[47cqw] text-[1.75cqw] leading-snug text-[#f6f4ec]/60">{strategySentence(args)}</p>
          <div className="mt-auto">
            <p className="text-[2.2cqw] font-extrabold">dolphinamp.xyz/test</p>
            <p className="mt-[0.4cqw] text-[1.45cqw] text-[#f6f4ec]/60">
              Backtest {day(result.from)} – {day(result.to)} · {result.trades} trades · fees counted
            </p>
          </div>
        </div>
      </figure>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Trades" value={String(result.trades)} />
        <Stat label="Won" value={result.winPct === null ? "–" : `${result.winPct}%`} />
        <Stat label="Worst dip" value={`−${result.worstDropPct.toFixed(1)}%`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button className="px-7" onClick={share} size="lg" variant="gold">
          Share on X
        </Button>
        <Button onClick={() => void copy()} size="lg" variant="outline">
          Copy link
        </Button>
        <Button onClick={() => void build()} size="lg" variant="outline">
          Make it trade for me →
        </Button>
      </div>
      <p className="text-sm text-muted">
        Dolphin is a marketplace in BNB Chain&rsquo;s Set and Earn.{" "}
        <Link className="font-medium text-ink underline underline-offset-4" href="/set-and-quest?ref=test">
          Take part
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
