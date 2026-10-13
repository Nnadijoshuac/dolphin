import Link from "next/link";

import { SET_AND_QUEST_URL } from "@/constants/site";

/*
 * THE ONE STORY (owner, 2026-10-14: "think of it as though you didn't build it... then criticise it").
 * A first-time visitor could not tell what Dolphin is for. The best consumer-finance homepages (Robinhood,
 * Phantom; campaign/research/ui-refs-2026-10-13) give one idea per block with its own picture. Ours is three
 * steps, each a real page, each with the approved art (campaign/assets/ART-STYLE.md).
 */
const STEPS = [
  {
    n: "1",
    title: "Test it",
    body: "Pick when to buy and when to sell. See what that would have made over the last year, fees counted.",
    href: "/test?ref=home-steps",
    cta: "Test a strategy",
    art: "/test/art-assassin.jpg",
  },
  {
    n: "2",
    title: "Run it",
    body: "One tap and it trades by your rules on practice money. Switch to real money from your own wallet when you trust it.",
    href: "/trade",
    cta: "See live traders",
    art: "/test/art-survivor.jpg",
  },
  {
    n: "3",
    title: "Sell it",
    body: "Publish it on BNB Chain. Others see its record and pay to run it. You keep the rules, they get the results.",
    href: "/docs/traders",
    cta: "How selling works",
    art: "/home-hero-pod.jpg",
  },
] as const;

export function HomeStory() {
  return (
    <section aria-labelledby="home-story" className="test-dark py-10 sm:py-24">
      <div className="mx-auto w-[min(100%-32px,1240px)]">
        <h2 className="text-2xl leading-tight font-bold sm:text-4xl" id="home-story">
          From an idea to an agent that trades it
        </h2>
        <p className="mt-2 max-w-xl text-base text-muted">Three steps. You can stop after any of them.</p>
        {/* Phones: a plain numbered list (no pictures); wider screens: three art cards. */}
        <ol className="mt-6 grid gap-0 md:mt-8 md:grid-cols-3 md:gap-4">
          {STEPS.map((step) => (
            <li className="group relative isolate flex flex-col overflow-hidden border-t border-line md:min-h-[380px] md:rounded-2xl md:border" key={step.n}>
              {/* A wrapper, not `hidden` on the img: the site's global img rule is unlayered and beats Tailwind's. */}
              <div className="absolute inset-0 -z-10 hidden md:block">
                {/* eslint-disable-next-line @next/next/no-img-element -- a static, pre-sized artwork */}
                <img alt="" className="h-full w-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-[1.03]" src={step.art} />
                <div className="absolute inset-0 bg-gradient-to-t from-[#080807] via-[#080807]/80 to-[#080807]/10" />
              </div>
              <div className="mt-auto py-5 md:p-6">
                <p className="text-sm font-semibold text-[#f3c13a]">Step {step.n}</p>
                <h3 className="mt-1 text-2xl font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4" href={step.href}>
                  {step.cta} →
                </Link>
              </div>
            </li>
          ))}
        </ol>
        <QuestBanner />
      </div>
    </section>
  );
}

/** Set and Earn is where the first capital comes from (owner): a clear way in, not a nav word. */
function QuestBanner() {
  return (
    <Link
      className="mt-6 flex flex-col gap-4 border-t border-line pt-5 no-underline sm:flex-row sm:items-center sm:justify-between md:rounded-2xl md:border md:border-[#f3c13a]/40 md:bg-gradient-to-r md:from-[#f3c13a]/15 md:to-transparent md:p-6"
      href={`${SET_AND_QUEST_URL}?ref=home-banner`}
    >
      <div>
        <p className="text-sm font-semibold text-[#f3c13a]">BNB Chain Set and Earn · until 5 Nov</p>
        <p className="mt-1 text-base font-semibold text-ink md:text-xl md:font-bold">Dolphin is one of nine marketplaces in the quest. Take part through us →</p>
      </div>
      <span className="hidden h-11 shrink-0 items-center justify-center rounded-md bg-accent px-6 text-[15px] font-semibold text-[#171813] md:inline-flex">Take part →</span>
    </Link>
  );
}
