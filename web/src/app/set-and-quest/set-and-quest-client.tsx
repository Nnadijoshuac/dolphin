"use client";

/*
 * SET AND QUEST (rebuilt 2026-10-01 against BNB Chain's published rules).
 *
 * A wallet qualifies by finishing two tracks: HIRE 3 different agents, the
 * hire event onchain, across 2+ shortlisted marketplaces; and BUILD one agent
 * that is registered and listed, discoverable in a campaign category, live,
 * hired by 3 wallets that are not yours, and that has made 5 onchain actions
 * on 3 separate days. convex/setAndQuest.ts measures what Dolphin can see.
 *
 * Every check shows one of four states and never a guess: done, in progress
 * (with the real count), not started, or "after close" for what only BNB
 * Chain can judge. Hires on other marketplaces are invisible to Dolphin, so
 * that one box is the wallet owner's own tick, and says so.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { MobileMenuButton } from "@/components/mobile-nav";
import { SET_AND_EARN_OFFICIAL_URL } from "@/constants/site";
import { setAndQuestApi, type QuestAgent, type QuestProgress } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import { useWallet } from "@/wallet/wallet-provider";

import styles from "./set-and-quest.module.css";

const CLOSES_AT = Date.parse("2026-11-05T12:00:00Z");
const OPENS_AT = Date.parse("2026-10-01T00:00:00Z");

type State = "done" | "progress" | "todo" | "later";

/* ───────── small stores: a minute clock, and the other-marketplace tick ───────── */

let minute = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(fn: () => void) {
  clockListeners.add(fn);
  clockTimer ??= setInterval(() => {
    minute = Date.now();
    clockListeners.forEach((l) => l());
  }, 60_000);
  return () => {
    clockListeners.delete(fn);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const useMinute = () => useSyncExternalStore(subscribeClock, () => minute, () => OPENS_AT);

const TICK_EVENT = "dolphin:quest-tick";
const tickKey = (wallet: string) => `dolphin:quest:other-marketplace:${wallet.toLowerCase()}`;
function subscribeTick(fn: () => void) {
  window.addEventListener(TICK_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(TICK_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
function readTick(wallet: string | null) {
  if (!wallet) return false;
  try {
    return window.localStorage.getItem(tickKey(wallet)) === "1";
  } catch {
    return false;
  }
}
function writeTick(wallet: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(tickKey(wallet), "1");
    else window.localStorage.removeItem(tickKey(wallet));
  } catch {
    /* private window: the tick lasts until reload */
  }
  window.dispatchEvent(new Event(TICK_EVENT));
}

/* ───────── pieces ───────── */

function StatusIcon({ state }: { state: State }) {
  return (
    <span aria-hidden="true" className={styles.status} data-state={state}>
      {state === "done" ? <CategoryGlyph color="currentColor" name="check" size={13} strokeWidth={2.6} /> : null}
    </span>
  );
}

function Pips({ value, of }: { value: number; of: number }) {
  return (
    <span aria-label={`${Math.min(value, of)} of ${of}`} className={styles.pips} role="img">
      {Array.from({ length: of }, (_, i) => (
        <i data-on={i < value} key={i} />
      ))}
    </span>
  );
}

function Check({ state, title, detail, meter, children }: { state: State; title: string; detail?: ReactNode; meter?: ReactNode; children?: ReactNode }) {
  const label = state === "done" ? "Done" : state === "progress" ? "In progress" : state === "later" ? "Checked after close" : "Not started";
  return (
    <li className={styles.check} data-state={state}>
      <StatusIcon state={state} />
      <div className={styles.checkBody}>
        <div className={styles.checkHead}>
          <h3>
            {title}
            <span className={styles.srOnly}> · {label}</span>
          </h3>
          {meter}
        </div>
        {detail ? <p>{detail}</p> : null}
        {children}
      </div>
    </li>
  );
}

const countState = (value: number, needed: number): State => (value >= needed ? "done" : value > 0 ? "progress" : "todo");

/* ───────── hero ───────── */

function Countdown() {
  const now = useMinute();
  const left = CLOSES_AT - now;
  if (left <= 0) return <span>Campaign closed</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return (
    <span>
      <strong>{days}</strong> days <strong>{hours}</strong> h left
    </span>
  );
}

function ProgressCard({ address, progress, connect, otherMarketplace }: { address: string | null; progress: QuestProgress | undefined; connect: () => void; otherMarketplace: boolean }) {
  if (!address) {
    return (
      <aside className={styles.progressCard}>
        <span className={styles.cardEyebrow}>Your progress</span>
        <p className={styles.connectLine}>Connect the wallet you registered for the campaign to see exactly where you stand.</p>
        <button className="manage-btn manage-btn--primary" onClick={connect} type="button">
          Connect wallet
        </button>
      </aside>
    );
  }
  if (progress === undefined) {
    return (
      <aside aria-busy="true" className={styles.progressCard}>
        <span className={styles.cardEyebrow}>Your progress</span>
        <div className={`${styles.ring} skeleton`} />
      </aside>
    );
  }
  const hireDone = (progress ? Math.min(progress.hire.onchainAgents, 3) >= 3 : false) ? 1 : 0;
  const marketsDone = progress?.hire.onDolphin && otherMarketplace ? 1 : 0;
  const best = progress?.build.agents[0] ?? null;
  const buildDone = best ? best.passed : 0;
  const done = hireDone + marketsDone + buildDone;
  const total = 2 + 6;
  const pct = Math.round((done / total) * 100);

  return (
    <aside className={styles.progressCard}>
      <span className={styles.cardEyebrow}>Your progress</span>
      <div className={styles.ringRow}>
        <div className={styles.ring} style={{ "--p": `${pct}%` } as CSSProperties}>
          <span>
            <strong>{done}</strong>/{total}
          </span>
        </div>
        <dl className={styles.trackTotals}>
          <div>
            <dt>Hire</dt>
            <dd>{hireDone + marketsDone} of 2</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>{buildDone} of 6</dd>
          </div>
        </dl>
      </div>
      <p className={styles.cardNote}>
        {done === total ? "Everything Dolphin can check is done. BNB Chain reviews the rest after the campaign closes." : "Checks Dolphin can see. BNB Chain makes the final call after the campaign closes."}
      </p>
    </aside>
  );
}

/* ───────── tracks ───────── */

function HireTrack({ address, progress, otherMarketplace }: { address: string | null; progress: QuestProgress | undefined; otherMarketplace: boolean }) {
  const hire = progress?.hire;
  const onchain = hire?.onchainAgents ?? 0;
  const offchain = hire ? hire.hires.filter((h) => !h.onchain) : [];
  const onchainHires = hire ? hire.hires.filter((h) => h.onchain) : [];
  const markets = (hire?.onDolphin ? 1 : 0) + (otherMarketplace ? 1 : 0);

  return (
    <section aria-labelledby="hire-track" className={styles.track}>
      <header className={styles.trackHead}>
        <span className={styles.trackNumber}>01</span>
        <div>
          <h2 id="hire-track">Hire</h2>
          <p>Three different agents, across at least two marketplaces.</p>
        </div>
      </header>

      <ol className={styles.checks}>
        <Check
          detail={
            address
              ? onchain >= 3
                ? "Three different agents, each with an onchain hire."
                : "Each agent must be different, and the hire must happen onchain. A token approval alone doesn't count."
              : "Each agent must be different, and the hire must happen onchain."
          }
          meter={<Pips of={3} value={onchain} />}
          state={address ? countState(onchain, 3) : "todo"}
          title="Hire 3 different agents"
        >
          {onchainHires.length || offchain.length ? (
            <ul className={styles.hireList}>
              {onchainHires.map((h) => (
                <li key={h.agentKey}>
                  <span className={styles.hireName}>{h.agentName}</span>
                  <span className={styles.tagGood}>Onchain</span>
                </li>
              ))}
              {offchain.map((h) => (
                <li key={`${h.agentKey}-free`}>
                  <span className={styles.hireName}>{h.agentName}</span>
                  <span className={styles.tagMuted}>Free hire · doesn&apos;t count</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Check>

        <Check
          detail="Dolphin is one. Hires on other shortlisted marketplaces happen there, so tick this yourself once you've made one."
          meter={<Pips of={2} value={markets} />}
          state={address ? countState(markets, 2) : "todo"}
          title="Use 2 marketplaces"
        >
          <div className={styles.marketRow}>
            <span className={styles.market} data-on={Boolean(hire?.onDolphin)}>
              <StatusIcon state={hire?.onDolphin ? "done" : "todo"} />
              Dolphin
            </span>
            <label className={styles.market} data-on={otherMarketplace}>
              <input
                checked={otherMarketplace}
                disabled={!address}
                onChange={(e) => address && writeTick(address, e.target.checked)}
                type="checkbox"
              />
              Another shortlisted marketplace
              {otherMarketplace ? <span className={styles.selfTag}>your tick</span> : null}
            </label>
          </div>
        </Check>
      </ol>

      <div className={styles.trackFoot}>
        <Link className="manage-btn manage-btn--primary" href="/search">
          Find agents to hire
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}

function BuildTrack({ address, progress }: { address: string | null; progress: QuestProgress | undefined }) {
  const build = progress?.build;
  const agent: QuestAgent | null = build?.agents[0] ?? null;
  const need = build?.needed ?? { otherHirers: 3, actions: 5, actionDays: 3 };
  const c = agent?.checks;

  return (
    <section aria-labelledby="build-track" className={styles.track}>
      <header className={styles.trackHead}>
        <span className={styles.trackNumber}>02</span>
        <div>
          <h2 id="build-track">Build</h2>
          <p>One agent of your own that is real, live and used.</p>
        </div>
      </header>

      {agent ? (
        <div className={styles.agentStrip}>
          <span className={styles.agentName}>{agent.name}</span>
          <span className={styles.tagMuted}>
            {agent.network === "bsc" ? "BNB Chain" : "BNB testnet"}
            {agent.tokenId ? ` · #${agent.tokenId}` : ""}
          </span>
          {build && build.agents.length > 1 ? <span className={styles.tagMuted}>closest of your {build.agents.length} agents</span> : null}
        </div>
      ) : null}

      <ol className={styles.checks}>
        <Check
          detail={
            agent
              ? c?.listed
                ? "Registered on the ERC-8004 registry and listed on Dolphin."
                : "Registered. It isn't listed on Dolphin yet; listing follows its first successful check."
              : build?.drafting
                ? "You started publishing an agent. Finish signing the registration."
                : "Register it on the ERC-8004 registry (chain 56 or 97) from your campaign wallet, and list it."
          }
          state={!address ? "todo" : !agent ? (build?.drafting ? "progress" : "todo") : c?.listed ? "done" : "progress"}
          title="Registered and listed"
        />
        <Check
          detail={
            agent
              ? agent.categoryLabel
                ? `Its card says it's a ${agent.categoryLabel.toLowerCase()} agent.`
                : `Its category is “${agent.category}”. It has to be yield, grid, rebalancing or health factor.`
              : "Its card must say what it does, in one of yield, grid, rebalancing or health factor."
          }
          state={!agent ? "todo" : c?.campaignCategory ? "done" : "todo"}
          title="Discoverable in a campaign category"
        />
        <Check
          detail={agent ? (c?.live ? "Answering when called." : "Not answering checks yet. BNB Chain probes at random times.") : "It must answer when invoked, at any time."}
          state={!agent ? "todo" : c?.live ? "done" : "progress"}
          title="Live"
        />
        <Check
          detail={`Completed hires from ${need.otherHirers} different wallets that aren't yours and aren't funded by you.`}
          meter={<Pips of={need.otherHirers} value={agent?.otherHirers ?? 0} />}
          state={agent ? countState(agent.otherHirers, need.otherHirers) : "todo"}
          title="Hired by 3 others"
        />
        <Check
          detail={
            agent
              ? `${agent.actions} onchain action${agent.actions === 1 ? "" : "s"} on ${agent.actionDays} day${agent.actionDays === 1 ? "" : "s"} so far. It needs ${need.actions} on ${need.actionDays} separate days.`
              : `At least ${need.actions} onchain actions, on ${need.actionDays} separate days. Hired but never transacting doesn't count.`
          }
          meter={<Pips of={need.actions} value={agent?.actions ?? 0} />}
          state={!agent ? "todo" : c?.executes ? "done" : agent.actions > 0 ? "progress" : "todo"}
          title="Actually executes"
        />
        <Check
          detail="Its onchain actions must match its category. A yield agent uses lending or vaults; a grid agent trades repeatedly."
          state="later"
          title="Does what it says"
        />
      </ol>

      <div className={styles.trackFoot}>
        {agent ? (
          <Link className="manage-btn manage-btn--primary" href="/my-agents">
            Manage my agent
            <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
          </Link>
        ) : (
          <Link className="manage-btn manage-btn--primary" href="/dolphin">
            Build an agent
            <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
          </Link>
        )}
        <span className={styles.footNote}>Your agent&apos;s code must be in a public repository.</span>
      </div>
    </section>
  );
}

/* ───────── rules ───────── */

const RULES: { title: string; items: string[] }[] = [
  {
    title: "Before you start",
    items: [
      "Register your name and campaign wallet on BNB Chain's page.",
      "Actions from unregistered wallets don't count.",
      "Your agent must be owned by that same wallet.",
    ],
  },
  {
    title: "Who can take part",
    items: ["18 or over.", "One wallet per person. More than one is disqualified, not merged.", "Not in a sanctioned or restricted country, and not on a marketplace team."],
  },
  {
    title: "What gets you disqualified",
    items: [
      "Wallets funded from the same source, or trading in circles.",
      "Hiring your own agent from wallets you control or fund.",
      "Hires made and undone just to tick a box, or scripted multi-wallet play.",
    ],
  },
];

/* ───────── page ───────── */

export function SetAndQuestClient() {
  const wallet = useWallet();
  const address = wallet.isConnected && wallet.address ? wallet.address : null;
  const connect = () => void wallet.connect();

  return (
    <div className={styles.page}>
      <header className={`${styles.mobileHead} mobile-only`}>
        <Link href="/">Dolphin</Link>
        <MobileMenuButton className={styles.menuButton} />
      </header>
      <main className={styles.shell}>{convexClient ? <Board address={address} connect={connect} /> : <Content address={address} connect={connect} progress={undefined} />}</main>
    </div>
  );
}

function Board({ address, connect }: { address: string | null; connect: () => void }) {
  const progress = useQuery(setAndQuestApi.setAndQuest.progress, address ? { wallet: address } : "skip");
  return <Content address={address} connect={connect} progress={address ? progress : undefined} />;
}

function Content({ address, connect, progress }: { address: string | null; connect: () => void; progress: QuestProgress | undefined }) {
  const otherMarketplace = useSyncExternalStore(subscribeTick, () => readTick(address), () => false);

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>BNB Chain · Set and Earn</span>
          <h1>
            Hire three.
            <br />
            Build one.
          </h1>
          <p>Finish both tracks before 5 November, 12:00 UTC. The first 100 wallets to qualify are rewarded.</p>
          <div className={styles.heroActions}>
            <a className="manage-btn manage-btn--primary" href={SET_AND_EARN_OFFICIAL_URL} rel="noreferrer" target="_blank">
              Register for the campaign
              <CategoryGlyph color="currentColor" name="external" size={14} strokeWidth={2} />
            </a>
            <a className="manage-btn manage-btn--quiet" href={SET_AND_EARN_OFFICIAL_URL} rel="noreferrer" target="_blank">
              Official rules
            </a>
          </div>
          <div className={styles.countdown}>
            <CategoryGlyph color="currentColor" name="clock" size={15} strokeWidth={2} />
            <Countdown />
          </div>
        </div>
        <ProgressCard address={address} connect={connect} otherMarketplace={otherMarketplace} progress={progress} />
      </section>

      <div className={styles.tracks}>
        <HireTrack address={address} otherMarketplace={otherMarketplace} progress={progress} />
        <BuildTrack address={address} progress={progress} />
      </div>

      <section aria-labelledby="rules-heading" className={styles.rules}>
        <h2 id="rules-heading">The small print that matters</h2>
        <div className={styles.ruleGrid}>
          {RULES.map((group) => (
            <div className={styles.ruleCard} key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={styles.risk}>
          Agents can manage real funds. Check permissions and spend caps before you hire, deposit only what you can afford to lose, and revoke access when you&apos;re done. BNB Chain&apos;s decision on who qualifies is final.
        </p>
      </section>
    </>
  );
}
