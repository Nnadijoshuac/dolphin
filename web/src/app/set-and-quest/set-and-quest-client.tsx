"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { MobileMenuButton } from "@/components/mobile-nav";
import { SET_AND_EARN_OFFICIAL_URL } from "@/constants/site";
import { builtAgentsApi, type BuiltAgentPublic } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { convexClient } from "@/providers/convex-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

import styles from "./set-and-quest.module.css";

const CAMPAIGN_CATEGORIES = new Set(["yield", "grid", "grid-trading", "rebalancing", "health-factor"]);
const DAILY_EVENT = "dolphin:set-and-quest-daily";
const DAILY_KEY = "dolphin:set-and-quest:last-dive";

type Quest = {
  title: string;
  detail: string;
  note: string;
  current: number | null;
  target: number;
  icon: GlyphName;
  action: string;
  href: string;
};

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function subscribeDaily(listener: () => void) {
  window.addEventListener(DAILY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DAILY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function dailySnapshot() {
  return window.localStorage.getItem(DAILY_KEY) === utcDay();
}

function RiverMeter({ current, target }: { current: number | null; target: number }) {
  const safeCurrent = current === null ? 0 : Math.min(Math.max(current, 0), target);
  const percent = target > 0 ? Math.round((safeCurrent / target) * 100) : 0;
  const style = { "--river-progress": `${percent}%` } as CSSProperties;

  return (
    <div className={styles.meterBlock}>
      <div
        aria-label={current === null ? "Progress verification not connected" : `${safeCurrent} of ${target} complete`}
        aria-valuemax={target}
        aria-valuemin={0}
        aria-valuenow={current === null ? undefined : safeCurrent}
        className={styles.river}
        role="progressbar"
        style={style}
      >
        <span className={styles.water} />
      </div>
      <div className={styles.meterLabels}>
        <span>{current === null ? "Verification not connected" : `${safeCurrent} / ${target}`}</span>
        <span>{current === null ? "—" : `${percent}%`}</span>
      </div>
    </div>
  );
}

function QuestCard({ quest }: { quest: Quest }) {
  return (
    <article className={styles.questCard}>
      <div className={styles.questTop}>
        <span aria-hidden="true" className={styles.questIcon}>
          <CategoryGlyph color="currentColor" name={quest.icon} size={23} strokeWidth={1.9} />
        </span>
        <div>
          <h3>{quest.title}</h3>
          <p>{quest.detail}</p>
        </div>
      </div>
      <RiverMeter current={quest.current} target={quest.target} />
      <div className={styles.questFoot}>
        <p>{quest.note}</p>
        <Link href={quest.href}>{quest.action}</Link>
      </div>
    </article>
  );
}

function QuestSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.questSection}>
      <header className={styles.sectionHead}>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function DailyDive() {
  const complete = useSyncExternalStore(subscribeDaily, dailySnapshot, () => false);

  function markComplete() {
    window.localStorage.setItem(DAILY_KEY, utcDay());
    window.dispatchEvent(new Event(DAILY_EVENT));
  }

  return (
    <article className={`${styles.questCard} ${styles.dailyCard}`}>
      <div className={styles.questTop}>
        <span aria-hidden="true" className={styles.questIcon}>
          <CategoryGlyph color="currentColor" name="clock" size={23} strokeWidth={1.9} />
        </span>
        <div>
          <span className={styles.optional}>Optional · resets 00:00 UTC</span>
          <h3>Daily dive</h3>
          <p>Return once a day and review what your wallet still needs.</p>
        </div>
      </div>
      <RiverMeter current={complete ? 1 : 0} target={1} />
      <div className={styles.questFoot}>
        <p>This builds your routine. It does not count toward official qualification.</p>
        <button disabled={complete} onClick={markComplete} type="button">
          {complete ? "Checked in today" : "Log today’s dive"}
        </button>
      </div>
    </article>
  );
}

function registeredBuildProgress(built: BuiltAgentPublic[] | undefined) {
  if (built === undefined) return null;
  const registered = built.filter((agent) => agent.status === "registered");
  const eligible = registered.filter((agent) => CAMPAIGN_CATEGORIES.has(agent.category));
  return { registered, eligible };
}

function questBoard(
  dolphinHireCount: number | null,
  registeredCount: number | null,
  eligibleCount: number,
  connected: boolean,
) {
  const waiting = connected ? "Reading your Dolphin activity…" : "Connect your campaign wallet to read this evidence.";
  const hireQuests: Quest[] = [
    {
      title: "Hire 3 different agents",
      detail: "Each needs a qualifying onchain hire event from this registered wallet.",
      note:
        dolphinHireCount === null
          ? waiting
          : `${dolphinHireCount} Dolphin hire record${dolphinHireCount === 1 ? "" : "s"} found. Event qualification is not indexed yet.`,
      current: null,
      target: 3,
      icon: "agents",
      action: "Find agents",
      href: "/search",
    },
    {
      title: "Use 2 marketplaces",
      detail: "Your three qualifying hires must span at least two shortlisted marketplaces.",
      note: "Dolphin cannot yet read the other marketplaces’ verified hire events.",
      current: null,
      target: 2,
      icon: "layers",
      action: "Read the rules",
      href: SET_AND_EARN_OFFICIAL_URL,
    },
  ];

  const buildQuests: Quest[] = [
    {
      title: "Register and list your agent",
      detail: "Own an ERC-8004 agent on chain 56 or 97 and list it publicly.",
      note:
        registeredCount === null
          ? connected ? "Reading agents owned by this wallet…" : "Connect your campaign wallet to read owned registrations."
          : registeredCount === 0
            ? "No confirmed Dolphin-built registration found for this wallet."
            : eligibleCount > 0
              ? "Eligible-category registration found. Public listing still needs campaign review."
              : "A registration was found, but its declared category needs review.",
      current: registeredCount === null ? null : registeredCount > 0 ? 1 : 0,
      target: 2,
      icon: "sparkle",
      action: "Build an agent",
      href: "/dolphin",
    },
    {
      title: "Stay discoverable and live",
      detail: "Serve a resolvable agent card and answer random invocation probes.",
      note: "Endpoint reachability is not connected to this board yet.",
      current: null,
      target: 2,
      icon: "discover",
      action: "Open My agents",
      href: "/my-agents",
    },
    {
      title: "Earn 3 independent hires",
      detail: "Three distinct wallets must complete hires without being yours or funded by you.",
      note: "Independent completed-hire verification is not connected yet.",
      current: null,
      target: 3,
      icon: "wallet",
      action: "View your agents",
      href: "/my-agents",
    },
    {
      title: "Execute 5 onchain actions",
      detail: "Your agent must act onchain in a way that matches its declared category.",
      note: "Category-aware action indexing is not connected yet.",
      current: null,
      target: 5,
      icon: "check",
      action: "Review activity",
      href: "/my-agents",
    },
    {
      title: "Be active on 3 separate days",
      detail: "The five actions must be spread across at least three calendar days.",
      note: "Distinct execution-day verification is not connected yet.",
      current: null,
      target: 3,
      icon: "clock",
      action: "Review activity",
      href: "/my-agents",
    },
  ];

  return { hireQuests, buildQuests };
}

function QuestBoardSections({ hireQuests, buildQuests }: { hireQuests: Quest[]; buildQuests: Quest[] }) {
  return (
    <>
      <QuestSection eyebrow="Track one" title="Hire across the ecosystem">
        <div className={styles.questGrid}>
          {hireQuests.map((quest) => <QuestCard key={quest.title} quest={quest} />)}
        </div>
      </QuestSection>

      <QuestSection eyebrow="Track two" title="Build something that works">
        <div className={styles.questGrid}>
          {buildQuests.map((quest) => <QuestCard key={quest.title} quest={quest} />)}
        </div>
      </QuestSection>
    </>
  );
}

function WalletQuestBoard({ address }: { address: string | null }) {
  const hires = useHiredAgents(address);
  const built = useQuery(
    builtAgentsApi.builtAgents.forOwner,
    address ? { ownerAddress: address } : "skip",
  );
  const buildProgress = registeredBuildProgress(built);
  const registeredCount = address ? buildProgress?.registered.length ?? null : null;
  const eligibleCount = address ? buildProgress?.eligible.length ?? 0 : 0;
  const dolphinHireCount = address ? hires?.length ?? null : null;
  const quests = questBoard(dolphinHireCount, registeredCount, eligibleCount, Boolean(address));

  return (
    <>
      {address ? (
        <div className={styles.walletRibbon}>
          <span>Tracking wallet</span>
          <strong>{`${address.slice(0, 6)}…${address.slice(-4)}`}</strong>
          <em>Live Dolphin evidence only</em>
        </div>
      ) : (
        <section className={styles.connectPanel}>
          <span aria-hidden="true"><CategoryGlyph color="currentColor" name="wallet" size={28} /></span>
          <div>
            <h2>Connect your campaign wallet</h2>
            <p>The quests stay visible. Connecting lets Dolphin fill them with evidence it can verify.</p>
          </div>
          <WalletConnectButton connectLabel="Connect wallet" />
        </section>
      )}
      <QuestBoardSections {...quests} />
    </>
  );
}

function UnavailableQuestBoard() {
  const quests = questBoard(null, null, 0, false);
  return (
    <>
      <section className={styles.connectPanel}>
        <span aria-hidden="true"><CategoryGlyph color="currentColor" name="info" size={28} /></span>
        <div>
          <h2>Progress is unavailable</h2>
          <p>This deployment is not connected to Dolphin’s backend, so no evidence can be read.</p>
        </div>
      </section>
      <QuestBoardSections {...quests} />
    </>
  );
}

export function SetAndQuestClient() {
  const wallet = useWallet();

  return (
    <div className={styles.page}>
      <header className={`${styles.mobileHead} mobile-only`}>
        <Link href="/">Dolphin</Link>
        <MobileMenuButton className={styles.menuButton} />
      </header>

      <div aria-hidden="true" className={styles.currentOne} />
      <div aria-hidden="true" className={styles.currentTwo} />

      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>BNB Chain · Set and Earn</span>
            <h1>Set the course.<br /><em>Complete the quest.</em></h1>
            <p>
              Hire three agents across two marketplaces. Build one that stays live, gets hired,
              and acts onchain. Your wallet leaves the evidence.
            </p>
            <div className={styles.heroActions}>
              {!wallet.isConnected ? <WalletConnectButton connectLabel="Connect campaign wallet" /> : null}
              <a href={SET_AND_EARN_OFFICIAL_URL}>Official rules</a>
            </div>
          </div>
          <div aria-label="Campaign window" className={styles.campaignSeal}>
            <span>Quest window</span>
            <strong>01 OCT</strong>
            <i />
            <strong>05 NOV</strong>
            <small>Ends 12:00 UTC</small>
          </div>
        </section>

        {convexClient ? (
          <WalletQuestBoard address={wallet.isConnected && wallet.address ? wallet.address : null} />
        ) : (
          <UnavailableQuestBoard />
        )}

        <QuestSection eyebrow="Bonus rhythm" title="Come back with the tide">
          <div className={styles.dailyGrid}><DailyDive /></div>
        </QuestSection>

        <footer className={styles.disclaimer}>
          <CategoryGlyph color="currentColor" name="shield" size={18} strokeWidth={1.9} />
          <p>
            This board reports evidence Dolphin can verify; it does not decide eligibility.
            BNB Chain reviews qualification after the campaign and its determination is final.
          </p>
        </footer>
      </div>
    </div>
  );
}
