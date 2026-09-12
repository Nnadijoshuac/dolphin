"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { MobileOnboarding } from "@/components/mobile-onboarding";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { track } from "@/lib/analytics";
import { useAppStore } from "@/store/use-app-store";

/**
 * ===========================================================================
 * ONBOARDING, WHICH THE WEBSITE DID NOT HAVE AT ALL. (2026-09-08)
 * ===========================================================================
 *
 * project-scope.md SS8 is titled "Onboarding (Do Not Skip)" and SS11 makes
 * "understandable and usable by someone who has never heard of BNB Agent
 * Studio" a non-negotiable. The mobile app has it. The website had no route, no
 * component and no copy - and `hasCompletedOnboarding` sat in the Zustand store,
 * persisted, read by nothing, which is the fossil of the intention.
 *
 * A cold visitor landed on a background video, a search box, and a grid of cards
 * headed "ERC-8004 #302257". Every noun on that screen assumes the thing this
 * page exists to explain.
 *
 * ===========================================================================
 * WHY IT IS A ROUTE AND NOT A FORCED INTERSTITIAL
 * ===========================================================================
 * Nothing redirects into this. A first-time visitor gets a dismissible prompt on
 * Discover (components/onboarding-prompt.tsx) and can ignore it forever.
 *
 * Blocking the catalog behind a carousel would be worse than having none: it
 * would put four screens of explanation between a person and the thing they
 * came to see, on a site whose entire proposition is that you can inspect an
 * agent before committing to anything. The offer is the right shape here; the
 * interception is not.
 *
 * ===========================================================================
 * NO JARGON IN THE BODY COPY
 * ===========================================================================
 * The terms this page is allowed to use before defining them: wallet, agent.
 * "ERC-8004", "escrow", "registry" and "session" each appear exactly once, in
 * the step that defines them. If a sentence here needs the reader to already
 * know what the product does, it has failed at its only job.
 */

type Step = {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
};

const STEPS: readonly Step[] = [
  {
    eyebrow: "What this is",
    title: "Agents are programs you can hire",
    body: "An onchain agent is a piece of software someone published, which does one job — watching a loan, moving money between yield sources, running a trading strategy. Dolphin is a catalogue of them.",
    points: [
      "Each agent was published by someone with a public address.",
      "Every agent here is registered on BNB Smart Chain, so who published it is checkable.",
      "Dolphin did not write these agents and does not vouch for them.",
    ],
  },
  {
    eyebrow: "What you can check",
    title: "Every number says where it came from",
    body: "The reason to look at an agent here rather than on its own website is that Dolphin will not print a figure without saying which source it read and when. When there is no source, it says so instead of guessing.",
    points: [
      "Live values are read from the protocol itself — Venus, PancakeSwap, Aave.",
      "A value Dolphin cannot source reads “Not available”, never a plausible number.",
      "Reviews come only from wallets that actually hired the agent and kept it a day.",
    ],
  },
  {
    /*
     * The title used to be "Hiring costs nothing and grants nothing".
     *
     * Every word of that was true, and it made the product explain - on slide
     * three of four, before the reader had done anything - that its primary
     * action is defined by what it withholds. Two negations as the headline of
     * a conversion step is a self-own, and it arrives earlier in the funnel
     * than the same admission on My agents, which the 2026-09-06 audit called
     * admirably honest and commercially fatal.
     *
     * The facts are unchanged and none of them is softened; the order is. Say
     * what hiring DOES, then what it does not cost and does not grant - which
     * is reassurance rather than apology, and is the actual reason a cautious
     * person should be willing to press the button.
     *
     * This is a copy fix on a real gap. Hiring is still a saved record: when
     * it produces an artifact - a tool call run against the agent, an answer
     * kept - this slide should describe that instead.
     */
    eyebrow: "What hiring does",
    title: "Hiring saves an agent to your wallet",
    body: "It records the agent against your address so you can find it again, keep track of it, and review it once you have had it a day. No money moves and no permission is granted — paying an agent for a task is a separate, deliberate step.",
    points: [
      "No agent can spend from your wallet. There is no approval to give.",
      "Paying for a task is a separate, deliberate choice, and the money is held in escrow on the chain until the work is delivered.",
      "You can end a hire at any time from My agents.",
    ],
  },
  {
    eyebrow: "Your wallet",
    title: "Dolphin only reads your address",
    body: "Connecting a wallet lets Dolphin see which agents are yours. It asks you to sign one message to prove the address is yours — that signature moves nothing and authorises nothing.",
    points: [
      "Dolphin never asks for a private key or a seed phrase. Nothing here will.",
      "The one signature is a login, not a transaction.",
      "You can browse the whole catalogue without connecting anything.",
    ],
  },
];

export function OnboardingClient() {
  const isMobile = useMobileLayout();
  const router = useRouter();
  const setCompleted = useAppStore((state) => state.setHasCompletedOnboarding);
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  useEffect(() => {
    track("onboarding_step_viewed", { step: index + 1, total: STEPS.length });
  }, [index]);

  function finish(skipped: boolean) {
    setCompleted(true);
    track("onboarding_completed", { skipped });
    router.push("/");
  }

  if (isMobile) return <MobileOnboarding finish={finish} />;

  return (
    <div className="site-frame page-shell">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <p
            aria-live="polite"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-faint"
          >
            {index + 1} of {STEPS.length}
          </p>
          <button
            className="interactive text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => finish(true)}
            type="button"
          >
            Skip
          </button>
        </div>

        {/* Progress, as a real element rather than dots, so it is legible at a glance. */}
        <div
          aria-hidden="true"
          className="mt-4 flex gap-1.5"
        >
          {STEPS.map((entry, position) => (
            <span
              className={`h-1 flex-1 rounded-full ${
                position <= index ? "bg-accent" : "bg-line"
              }`}
              key={entry.title}
            />
          ))}
        </div>

        <div className="mt-10">
          <p className="eyebrow">{step.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
            {step.title}
          </h1>
          <p className="body-copy mt-5">{step.body}</p>

          <ul className="mt-8 border-t border-line">
            {step.points.map((point) => (
              <li
                className="flex gap-3 border-b border-line py-4 text-sm leading-6 text-muted"
                key={point}
              >
                <span aria-hidden="true" className="mt-1 shrink-0 text-accent-ink">
                  <CategoryGlyph
                    color="currentColor"
                    name="check"
                    size={16}
                    strokeWidth={2}
                  />
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          {index > 0 ? (
            <button
              className="interactive min-h-11 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink hover:bg-canvas"
              onClick={() => setIndex((current) => current - 1)}
              type="button"
            >
              Back
            </button>
          ) : null}

          {isLast ? (
            <button
              className="interactive inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover"
              onClick={() => finish(false)}
              type="button"
            >
              Browse agents
              <CategoryGlyph
                color="currentColor"
                name="arrow-right"
                size={15}
                strokeWidth={2}
              />
            </button>
          ) : (
            <button
              className="interactive min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover"
              onClick={() => setIndex((current) => current + 1)}
              type="button"
            >
              Next
            </button>
          )}

          <Link
            className="interactive ml-auto text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            href="/search"
          >
            Straight to search
          </Link>
        </div>
      </div>
    </div>
  );
}
