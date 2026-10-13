"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { COINS, ENTRIES, persona, signed, STOPS, strategySentence, TARGETS, toQuery, type EntryKey } from "@/app/test/choices";
import styles from "@/app/test/test.module.css";
import DotGrid from "@/components/react-bits/DotGrid";
import type { StrategyTestArgs, StrategyTestResult } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * WOULD YOUR STRATEGY HAVE SURVIVED? (owner, 2026-10-13: "build it... make the UI very cool... let it go
 * viral"). Three choices, one real backtest, one result worth showing off - and a link whose preview is
 * that result. Every number comes from convex/strategyTest.ts through the cached /api/strategy-test.
 */
export function StrategyTest({ initial }: { initial: StrategyTestArgs }) {
  const [args, setArgs] = useState<StrategyTestArgs>(initial);
  const [result, setResult] = useState<StrategyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which choices the card shows now: loading is "the card is behind the choices".
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
    }, 200);
    window.history.replaceState(null, "", `/test?${query}`);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const entry = ENTRIES.find((candidate) => candidate.key === args.entry) ?? ENTRIES[0];
  const set = (change: Partial<StrategyTestArgs>) => setArgs((current) => ({ ...current, ...change }));
  const chooseEntry = (key: EntryKey) => {
    const next = ENTRIES.find((candidate) => candidate.key === key)!;
    set({ entry: key, level: next.levels.includes(args.level) ? args.level : next.levels[Math.min(1, next.levels.length - 1)] });
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div aria-hidden className={styles.heroDots}>
          <DotGrid activeColor="#f0b90b" baseColor="#8f8a7c" dotSize={3} gap={22} glow={0.35} intro opacity={0.4} proximity={140} shockRadius={240} shockStrength={3} dpr={undefined} style={undefined} />
        </div>
        <p className={styles.eyebrow}>Strategy test · free · no sign-up</p>
        <h1 className={styles.title}>
          {result ? (
            <>
              {result.coin} {result.holdPct < 0 ? "fell" : "rose"} <span className={result.holdPct < 0 ? styles.down : styles.up}>{Math.abs(result.holdPct).toFixed(0)}%</span> this year.
              <br />
              Would your strategy have survived?
            </>
          ) : (
            "Would your strategy have survived the last year?"
          )}
        </h1>
        <p className={styles.sub}>Pick when to buy and when to sell. Dolphin replays it on every price of the last 12 months, fees and gas counted.</p>
      </header>

      <div className={styles.layout}>
        <section aria-label="Your strategy" className={styles.builder}>
          <Step n={1} title="Pick a coin">
            <div className={styles.coins}>
              {COINS.map((coin) => (
                <button aria-pressed={args.coin === coin} className={styles.coin} key={coin} onClick={() => set({ coin })} type="button">
                  {coin}
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title="Buy when">
            <div className={styles.entries}>
              {ENTRIES.map((candidate) => (
                <button aria-pressed={args.entry === candidate.key} className={styles.entry} key={candidate.key} onClick={() => chooseEntry(candidate.key)} type="button">
                  <b>{candidate.label}</b>
                  <span>{candidate.words(args.entry === candidate.key ? args.level : candidate.levels[Math.min(1, candidate.levels.length - 1)])}</span>
                </button>
              ))}
            </div>
            <Chips label={entry.unit} onPick={(level) => set({ level: level as number })} options={entry.levels.map((level) => ({ value: level, text: entry.key === "rsi" || entry.key === "trend" ? `< ${level}` : `${level}%` }))} value={args.level} />
          </Step>

          <Step n={3} title="Sell when">
            <Chips
              label="Take profit"
              onPick={(target) => set({ target: target as number | null })}
              options={[...TARGETS.map((target) => ({ value: target as number | null, text: `+${target}%` })), ...(args.stop !== null ? [{ value: null, text: "None" }] : [])]}
              value={args.target}
            />
            <Chips
              label="Stop loss"
              onPick={(stop) => set({ stop: stop as number | null })}
              options={[...STOPS.map((stop) => ({ value: stop as number | null, text: `−${stop}%` })), ...(args.target !== null ? [{ value: null, text: "None" }] : [])]}
              value={args.stop}
            />
          </Step>

          <p className={styles.sentence}>{strategySentence(args)}</p>
        </section>

        <ResultCard args={args} error={error} loading={loading} result={result} />
      </div>

      <p className={styles.fine}>
        A backtest on Binance prices over the last 12 months, checked every 4 hours, $100 a trade, with PancakeSwap fees and gas counted. Past results don&rsquo;t predict what happens next. Not financial
        advice.
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className={styles.step}>
      <p className={styles.stepTitle}>
        <span>{n}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

function Chips({ label, options, value, onPick }: { label: string; options: { value: number | null; text: string }[]; value: number | null; onPick: (value: number | null) => void }) {
  return (
    <div className={styles.chipRow}>
      <span className={styles.chipLabel}>{label}</span>
      <div className={styles.chips}>
        {options.map((option) => (
          <button aria-pressed={option.value === value} className={styles.chip} key={String(option.value)} onClick={() => onPick(option.value)} type="button">
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Counts from the last shown value to the new one, so every change lands like a reveal. */
function useCountUp(target: number | null): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number>(0);
  useEffect(() => {
    if (target === null) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 750);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = origin + (target - origin) * eased;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

function ResultCard({ args, result, loading, error }: { args: StrategyTestArgs; result: StrategyTestResult | null; loading: boolean; error: string | null }) {
  const router = useRouter();
  const shown = useCountUp(result ? result.resultPct : null);
  const who = result ? persona(result) : null;
  const beat = result ? Math.round((result.resultPct - result.holdPct) * 10) / 10 : 0;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/test?${toQuery(args)}`;

  const share = () => {
    if (!result || !who) return;
    const text = `My ${result.coin} strategy: ${signed(result.resultPct)} in a year.\nJust holding: ${signed(result.holdPct)}.\n\n${who.title}. Would yours have survived?`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${link}&ref=test-share`)}`, "_blank", "noopener,noreferrer");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${link}&ref=test-link`);
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
    <section aria-live="polite" className={styles.result} data-loading={loading || undefined}>
      {error && !result ? (
        <p className={styles.error}>{error}</p>
      ) : !result || shown === null || !who ? (
        <div className={styles.skeleton}>
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <p className={styles.persona}>{who.title}</p>
          <p className={`${styles.big} ${result.resultPct >= 0 ? styles.up : styles.down}`}>{signed(Math.round(shown * 10) / 10)}</p>
          <p className={styles.versus}>
            Just holding {result.coin}: <b className={result.holdPct >= 0 ? styles.up : styles.down}>{signed(result.holdPct)}</b>
            <span className={beat >= 0 ? styles.up : styles.down}>{beat >= 0 ? ` · ${beat} points better` : ` · ${Math.abs(beat)} points worse`}</span>
          </p>
          <p className={styles.personaLine}>{who.line}</p>
          <Chart curve={result.curve} />
          <dl className={styles.stats}>
            <div>
              <dt>Trades</dt>
              <dd>{result.trades}</dd>
            </div>
            <div>
              <dt>Won</dt>
              <dd>{result.winPct === null ? "–" : `${result.winPct}%`}</dd>
            </div>
            <div>
              <dt>Worst dip</dt>
              <dd>−{result.worstDropPct.toFixed(1)}%</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button className={styles.share} onClick={share} type="button">
              Share on X
            </button>
            <button className={styles.ghost} onClick={() => void copy()} type="button">
              Copy link
            </button>
          </div>
          <button className={styles.make} onClick={() => void build()} type="button">
            Turn it into an agent that trades for you →
          </button>
          <p className={styles.quest}>
            Dolphin is a marketplace in BNB Chain&rsquo;s Set and Earn. <Link href="/set-and-quest?ref=test">Take part</Link>
          </p>
        </>
      )}
    </section>
  );
}

function Chart({ curve }: { curve: StrategyTestResult["curve"] }) {
  const { you, hold, zero } = useMemo(() => {
    const values = curve.flatMap((point) => [point.you, point.hold]);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    const x = (index: number) => (index / Math.max(1, curve.length - 1)) * 600;
    const y = (value: number) => 200 - ((value - min) / span) * 190 - 5;
    const line = (key: "you" | "hold") => curve.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
    return { you: line("you"), hold: line("hold"), zero: y(0) };
  }, [curve]);
  return (
    <figure className={styles.chart}>
      <svg preserveAspectRatio="none" viewBox="0 0 600 200">
        <defs>
          <linearGradient id="you-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f0b90b" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f0b90b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line stroke="currentColor" strokeOpacity="0.18" x1="0" x2="600" y1={zero} y2={zero} />
        <path d={hold} fill="none" stroke="currentColor" strokeDasharray="5 6" strokeOpacity="0.55" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={`${you} L600,${zero} L0,${zero} Z`} fill="url(#you-fill)" />
        <path className={styles.youLine} d={you} fill="none" pathLength={1} stroke="#f0b90b" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span className={styles.keyYou}>Your strategy</span>
        <span className={styles.keyHold}>Just holding</span>
      </figcaption>
    </figure>
  );
}
