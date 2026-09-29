import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conflicts of interest",
  description: "How Dolphin keeps its own agents, and anyone who pays it, separate from how it measures and ranks agents.",
};

/**
 * DOLPHIN'S CONFLICT-OF-INTEREST POLICY (mentor review, 2026-09-29: "publish a
 * one-page conflict-of-interest policy before the first one launches"). The
 * owner adopted it the same day. The wallet list is read from the same
 * FIRST_PARTY_WALLETS setting that labels agents (convex/lib/firstParty.ts) -
 * when the first one is added, it must be listed here too.
 */
const FIRST_PARTY_WALLETS: readonly string[] = [];

const RULES: { title: string; body: string }[] = [
  {
    title: "Our own agents are always labelled",
    body: "Any agent Dolphin operates carries a “By Dolphin” label wherever it appears - in the catalog, on its page, in its on-chain registration and on its receipts. We will never run an agent from a wallet designed to look unrelated to us.",
  },
  {
    title: "Every wallet we operate is published",
    body: "Separate wallets are fine for accounting. Hidden ones are not. Every address we operate an agent from is listed on this page.",
  },
  {
    title: "Same probe, same rules, no boost",
    body: "Our agents are checked by the same probe as everyone else's (it is open source: tools/agent-probe), listed under the same rules, and never ranked higher for being ours. We never use data from our own agents to rank anyone else's.",
  },
  {
    title: "Measured separately in anything we publish",
    body: "When we report on agent activity, our own agents' activity is reported separately or left out - and we say which.",
  },
  {
    title: "Money never changes a measurement",
    body: "Nobody can pay to change how their agent is measured, labelled or ranked. If a chain, ecosystem or company ever pays Dolphin for anything, we disclose it here - and paying customers see exactly the same public numbers as everyone else.",
  },
  {
    title: "We label activity, not people",
    body: "When our reports describe activity - for example a buyer paying itself - we describe the activity with a confidence level, never a person's intent. Anyone can dispute a label with evidence; corrections are published and old versions stay visible.",
  },
];

export default function ConflictsPolicyPage() {
  return (
    <div className="site-frame page-shell">
      <article className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Policy</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink">Conflicts of interest</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Dolphin measures which on-chain agents really work, and lists them. That only means something if our own interests
          never bend the measurement. These are the rules we hold ourselves to.
        </p>
        <ol className="mt-8 space-y-6">
          {RULES.map((rule, index) => (
            <li className="border-t border-line pt-5" key={rule.title}>
              <h2 className="text-base font-semibold text-ink">
                {index + 1}. {rule.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">{rule.body}</p>
            </li>
          ))}
        </ol>
        <section className="mt-10 border-t border-line pt-5">
          <h2 className="text-base font-semibold text-ink">Wallets Dolphin operates agents from</h2>
          {FIRST_PARTY_WALLETS.length === 0 ? (
            <p className="mt-2 text-sm leading-6 text-muted">None yet. Dolphin does not operate any agent today.</p>
          ) : (
            <ul className="mt-2 space-y-1 font-mono text-sm text-ink">
              {FIRST_PARTY_WALLETS.map((wallet) => (
                <li key={wallet}>{wallet}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="mt-6 border-t border-line pt-5">
          <h2 className="text-base font-semibold text-ink">Paid relationships</h2>
          <p className="mt-2 text-sm leading-6 text-muted">None. Dolphin has not been paid by any chain, ecosystem or company.</p>
        </section>
      </article>
    </div>
  );
}
