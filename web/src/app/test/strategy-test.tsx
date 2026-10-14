"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { COINS, ENTRIES, persona, PERSONA_ART, signed, STOPS, strategySentence, TARGETS, toQuery, type EntryKey } from "@/app/test/choices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { strategyTestApi, type StrategyTestArgs, type StrategyTestResult, type TestBoardRow } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * WOULD YOUR STRATEGY HAVE SURVIVED? (owner, 2026-10-13: "this looks very coded... look for good graphic
 * design"). Art-directed like the exchange PnL cards and Spotify Wrapped: an artwork per result title
 * (public/test), and the result on the page IS the share card - same art, same words - so what you see is
 * what you post. shadcn/ui controls, re-skinned dark by .test-dark (globals.css). Normal letter-spacing.
 * Every number comes from convex/strategyTest.ts through the cached /api/strategy-test.
 */
export function StrategyTest({ initial, challenge }: { initial: StrategyTestArgs; challenge: boolean }) {
  const [args, setArgs] = useState<StrategyTestArgs>(initial);
  const [result, setResult] = useState<StrategyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  // The result the visitor was challenged with: the first one this page showed, kept while they try their own.
  const [toBeat, setToBeat] = useState<{ pct: number; coin: string; sentence: string } | null>(null);
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
          if (challenge) setToBeat((had) => had ?? { pct: body.result!.resultPct, coin: body.result!.coin, sentence: strategySentence(args) });
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
    // args is fully described by query; challenge never changes after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const set = (change: Partial<StrategyTestArgs>) => setArgs((current) => ({ ...current, ...change }));
  const entry = ENTRIES.find((candidate) => candidate.key === args.entry) ?? ENTRIES[0];
  const coin = result?.coin ?? args.coin;

  return (
    <div className="test-dark min-h-screen pb-24">
      {/* The hero is the artwork itself. */}
      <section className="relative isolate overflow-hidden">
        {/* Phones: words on plain black, no art behind them (owner: "too busy"); the result card below is the picture. */}
        <div className="absolute inset-0 -z-10 hidden md:block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static, pre-sized artwork */}
          {/* Full height, anchored right, never cropped: "cover" cut the dolphin's head off on wide screens. */}
          <img alt="" className="absolute top-0 right-0 h-full w-auto max-w-none opacity-90" src="/test/art-assassin.jpg" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#080807] via-[#080807]/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#080807] to-transparent" />
        </div>
        <div className="mx-auto w-[min(100%-32px,1200px)] py-10 sm:py-24">
          {toBeat ? (
            <p className="mb-6 inline-flex flex-wrap items-center gap-x-2 rounded-full border border-[#f3c13a]/40 bg-[#f3c13a]/10 px-4 py-2 text-sm">
              <span className="font-semibold text-[#f3c13a]">Challenge</span>
              <span>
                Someone&rsquo;s {toBeat.coin} strategy made <b className={toBeat.pct >= 0 ? "text-[#4fe0ae]" : "text-[#ff7466]"}>{signed(toBeat.pct)}</b> this year. Can yours beat it?
              </span>
            </p>
          ) : null}
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

        <Result args={args} error={error} loading={loading} result={result} toBeat={toBeat?.pct ?? null} />
      </div>

      <Board onPick={(row) => {
        setArgs((current) => ({ ...current, coin: row.coin, entry: row.entry, level: row.level, target: row.target, stop: row.stop }));
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} />

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

function Result({ args, result, loading, error, toBeat }: { args: StrategyTestArgs; result: StrategyTestResult | null; loading: boolean; error: string | null; toBeat: number | null }) {
  const router = useRouter();
  const session = useWalletSession();
  const startPractice = useMutation(strategyTestApi.strategyTest.startPractice);
  const [starting, setStarting] = useState(false);
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
  const link = () => `${window.location.origin}/test?${toQuery(args)}&c=1`;
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
  const practice = async () => {
    setStarting(true);
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      await startPractice({ sessionToken, coin: args.coin, entry: args.entry, level: args.level, target: args.target, stop: args.stop, amountUsd: 100 });
      toast.success("It's running on $100 of practice money. Watch it under Your traders.");
      router.push("/trade#my-traders");
    } catch (cause) {
      toast.error(toUserMessage(cause, "It could not start. Connect your wallet and try again."));
    } finally {
      setStarting(false);
    }
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

      {toBeat !== null ? (
        <p className={`text-sm font-medium ${result.resultPct > toBeat ? "text-[#4fe0ae]" : "text-muted"}`}>
          {result.resultPct > toBeat
            ? `You beat it by ${(result.resultPct - toBeat).toFixed(1)} points. Post it.`
            : result.resultPct === toBeat
              ? "That's the score to beat. Change any choice on the left."
              : `${(toBeat - result.resultPct).toFixed(1)} points to go. Try another.`}
        </p>
      ) : null}
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
        <Button disabled={starting} onClick={() => void practice()} size="lg" variant="outline">
          {starting ? "Starting…" : "Run it on practice money →"}
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

/**
 * BEST STRATEGIES SO FAR - the leaderboard pattern from the best dark leaderboards (campaign/research/
 * ui-refs-2026-10-13/NOTES.md): a 2-1-3 podium with the winner raised, then the rest as rows. Tapping one
 * loads its choices into the test above. Five rows from convex/strategyTest.ts board.
 */
function Board({ onPick }: { onPick: (row: TestBoardRow) => void }) {
  const rows = useQuery(strategyTestApi.strategyTest.board, {});
  if (!rows || rows.length === 0) return null;
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean) as TestBoardRow[];
  const rest = rows.slice(3);
  const sentence = (row: TestBoardRow) => strategySentence({ coin: row.coin, entry: row.entry, level: row.level, target: row.target, stop: row.stop, to: "" });
  return (
    <section className="mx-auto mt-16 w-[min(100%-32px,1200px)]">
      <h2 className="text-2xl font-bold sm:text-3xl">Best strategies so far</h2>
      <p className="mt-1 text-sm text-muted">The strongest results anyone has tested here, over the same 12 months. Tap one to try it.</p>
      <div className="mt-6 grid items-end gap-3 sm:grid-cols-3">
        {podium.map((row) => {
          const rank = rows.indexOf(row) + 1;
          const first = rank === 1;
          return (
            <button
              className={`group relative isolate overflow-hidden rounded-2xl border text-left transition-transform hover:-translate-y-0.5 ${first ? "order-first border-[#f3c13a]/60 sm:order-none sm:pb-10" : "border-line"}`}
              key={rank}
              onClick={() => onPick(row)}
              type="button"
            >
              <div className="absolute inset-0 -z-10 hidden md:block">
                {/* eslint-disable-next-line @next/next/no-img-element -- a static, pre-sized artwork */}
                <img alt="" className="h-full w-full object-cover opacity-45 transition-opacity group-hover:opacity-60" src={first ? "/test/art-assassin.jpg" : "/test/art-survivor.jpg"} />
                <div className="absolute inset-0 bg-gradient-to-t from-[#080807] via-[#080807]/85 to-[#080807]/40" />
              </div>
              <div className={`p-5 ${first ? "sm:pt-14" : ""}`}>
                <p className={`text-sm font-semibold ${first ? "text-[#f3c13a]" : "text-muted"}`}>#{rank}</p>
                <p className={`mt-1 font-extrabold tabular-nums ${first ? "text-5xl" : "text-4xl"} ${row.resultPct >= 0 ? "text-[#4fe0ae]" : "text-[#ff7466]"}`}>{signed(row.resultPct)}</p>
                <p className="mt-1 text-sm">
                  while {row.coin} did {signed(row.holdPct)}
                </p>
                <p className="mt-3 text-sm leading-snug text-ink-soft">{sentence(row)}</p>
                <p className="mt-3 text-xs text-muted">
                  {row.trades} trades · {row.winPct ?? 0}% won
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {rest.length > 0 ? (
        <ol className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {rest.map((row, index) => (
            <li key={index}>
              <button className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-paper-muted" onClick={() => onPick(row)} type="button">
                <span className="w-6 text-sm text-muted">#{index + 4}</span>
                <span className={`w-24 text-lg font-bold tabular-nums ${row.resultPct >= 0 ? "text-[#4fe0ae]" : "text-[#ff7466]"}`}>{signed(row.resultPct)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{sentence(row)}</span>
                <span className="hidden text-xs text-muted sm:block">{row.trades} trades</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
