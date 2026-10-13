"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { COINS, ENTRIES, persona, signed, STOPS, strategySentence, TARGETS, toQuery, type EntryKey } from "@/app/test/choices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StrategyTestArgs, StrategyTestResult } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * WOULD YOUR STRATEGY HAVE SURVIVED? Composed from shadcn/ui's dashboard-01 block (owner, 2026-10-13: "go
 * to shadcn and React Bits... look for UI components you can use"): a settings card, stat cards with trend
 * badges, an area chart. Normal letter-spacing throughout. Every number comes from convex/strategyTest.ts
 * through the cached /api/strategy-test.
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

  return (
    <div className="bg-canvas pb-20 text-ink">
      <div className="mx-auto w-[min(100%-32px,1200px)] pt-10 sm:pt-14">
        <Badge variant="outline">Strategy test · free · no sign-up</Badge>
        <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-semibold sm:text-5xl sm:leading-[1.1]">
          {result ? `${result.coin} ${result.holdPct < 0 ? "fell" : "rose"} ${Math.abs(result.holdPct).toFixed(0)}% this year. ` : ""}
          <span className="text-muted">Would your strategy have survived?</span>
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted">Pick when to buy and when to sell. Dolphin replays it on every 4-hour price of the last 12 months, fees and gas counted.</p>

        <div className="mt-8 grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle>Your strategy</CardTitle>
              <CardDescription>{strategySentence(args)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field label="Coin">
                <ToggleGroup onValueChange={(coin) => coin && set({ coin })} type="single" value={args.coin}>
                  {COINS.map((coin) => (
                    <ToggleGroupItem key={coin} value={coin}>
                      {coin}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field label="Buy when">
                <div className="grid grid-cols-2 gap-2">
                  {ENTRIES.map((candidate) => (
                    <button
                      className="rounded-md border border-line bg-paper px-3 py-2 text-left text-sm transition-colors hover:bg-paper-muted data-[on=true]:border-ink data-[on=true]:bg-paper-muted"
                      data-on={args.entry === candidate.key}
                      key={candidate.key}
                      onClick={() => {
                        const key = candidate.key as EntryKey;
                        set({ entry: key, level: candidate.levels.includes(args.level) ? args.level : candidate.levels[Math.min(1, candidate.levels.length - 1)] });
                      }}
                      type="button"
                    >
                      <span className="block font-medium">{candidate.label}</span>
                    </button>
                  ))}
                </div>
                <ToggleGroup className="mt-2" onValueChange={(level) => level && set({ level: Number(level) })} type="single" value={String(args.level)}>
                  {entry.levels.map((level) => (
                    <ToggleGroupItem key={level} value={String(level)}>
                      {entry.key === "rsi" || entry.key === "trend" ? `RSI < ${level}` : `${level}%`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field label="Take profit">
                <ToggleGroup onValueChange={(target) => target && set({ target: target === "none" ? null : Number(target) })} type="single" value={args.target === null ? "none" : String(args.target)}>
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

          <Results args={args} error={error} loading={loading} result={result} />
        </div>

        <p className="mt-8 text-xs text-muted">A backtest on Binance prices, $100 a trade, PancakeSwap fees and gas counted. Past results don&rsquo;t predict what happens next. Not financial advice.</p>
      </div>
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

function Results({ args, result, loading, error }: { args: StrategyTestArgs; result: StrategyTestResult | null; loading: boolean; error: string | null }) {
  const router = useRouter();
  const shown = useCountUp(result ? result.resultPct : null);

  if (error && !result) {
    return (
      <Card>
        <CardContent className="text-sm text-danger">{error}</CardContent>
      </Card>
    );
  }
  if (!result || shown === null) {
    return (
      <div className="grid gap-4">
        <div className="skeleton h-[188px] rounded-xl" />
        <div className="skeleton h-[340px] rounded-xl" />
      </div>
    );
  }

  const who = persona(result);
  const beat = Math.round((result.resultPct - result.holdPct) * 10) / 10;
  const link = () => `${window.location.origin}/test?${toQuery(args)}`;
  const share = () => {
    const text = `My ${result.coin} strategy: ${signed(result.resultPct)} in a year.\nJust holding: ${signed(result.holdPct)}.\n\n${who.title}. Would yours have survived?`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${link()}&ref=test-share`)}`, "_blank", "noopener,noreferrer");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${link()}&ref=test-link`);
      toast.success("Link copied. Its preview shows your result.");
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
    <div className={`grid gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-gradient-to-t from-accent-soft/40 to-paper">
          <CardHeader>
            <CardDescription>Your strategy, 12 months</CardDescription>
            <CardTitle className={`text-4xl font-semibold tabular-nums sm:text-5xl ${result.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{signed(Math.round(shown * 10) / 10)}</CardTitle>
            <CardAction>
              <Badge variant="gold">{who.title}</Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <span className="font-medium">{who.line}</span>
            <span className="text-muted">{strategySentence(args)}</span>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Just holding {result.coin}</CardDescription>
            <CardTitle className={`text-4xl font-semibold tabular-nums sm:text-5xl ${result.holdPct >= 0 ? "pnl-up" : "pnl-down"}`}>{signed(result.holdPct)}</CardTitle>
            <CardAction>
              <Badge variant={beat >= 0 ? "up" : "down"}>{beat >= 0 ? `${beat} pts better` : `${Math.abs(beat)} pts worse`}</Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <span className="font-medium">
              {result.trades} trades · {result.winPct === null ? "none closed" : `${result.winPct}% won`}
            </span>
            <span className="text-muted">Worst dip −{result.worstDropPct.toFixed(1)}% on the way</span>
          </CardFooter>
        </Card>
      </div>

      <Card className="pb-4">
        <CardHeader>
          <CardTitle>Your strategy against holding</CardTitle>
          <CardDescription>
            {result.from && result.to ? `${day(result.from)} – ${day(result.to)}` : "The last 12 months"} · % of each $100 trade
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <YouVsHold coin={result.coin} curve={result.curve} />
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button onClick={share} size="lg" variant="gold">
            Share on X
          </Button>
          <Button onClick={() => void copy()} size="lg" variant="outline">
            Copy link
          </Button>
          <Button onClick={() => void build()} size="lg" variant="outline">
            Make it trade for me →
          </Button>
          <span className="ml-auto text-sm text-muted">
            Dolphin is in BNB Chain&rsquo;s Set and Earn.{" "}
            <Link className="font-medium text-ink underline underline-offset-4" href="/set-and-quest?ref=test">
              Take part
            </Link>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** shadcn's interactive area chart (ui.shadcn.com/charts/area), two series, on Recharts. */
function YouVsHold({ curve, coin }: { curve: StrategyTestResult["curve"]; coin: string }) {
  return (
    <div className="h-[280px] w-full text-xs">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={curve} margin={{ left: 0, right: 12, top: 8 }}>
          <defs>
            <linearGradient id="fillYou" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.5} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="fillHold" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--muted)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--muted)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="t"
            minTickGap={40}
            stroke="var(--muted)"
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis axisLine={false} stroke="var(--muted)" tickFormatter={(value: number) => `${value}%`} tickLine={false} width={44} />
          <ReferenceLine stroke="var(--line-strong)" y={0} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as StrategyTestResult["curve"][number];
              return (
                <div className="rounded-lg border border-line bg-paper-strong px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium">{day(point.t)}</p>
                  <p className="flex justify-between gap-6">
                    <span className="text-muted">Your strategy</span>
                    <span className="font-medium tabular-nums">{signed(point.you)}</span>
                  </p>
                  <p className="flex justify-between gap-6">
                    <span className="text-muted">Holding {coin}</span>
                    <span className="font-medium tabular-nums">{signed(point.hold)}</span>
                  </p>
                </div>
              );
            }}
            cursor={{ stroke: "var(--line-strong)" }}
          />
          <Area dataKey="hold" fill="url(#fillHold)" name={`Holding ${coin}`} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.5} type="monotone" />
          <Area dataKey="you" fill="url(#fillYou)" name="Your strategy" stroke="var(--accent)" strokeWidth={2} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
