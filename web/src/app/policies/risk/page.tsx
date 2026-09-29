import type { Metadata } from "next";

import { LegalDoc, type LegalSection } from "@/components/legal-doc";
import { ESCROW_REFUND_DAYS } from "@/wallet/erc8183-policy";

export const metadata: Metadata = {
  title: "Risk Disclosure",
  description: "The risks of hiring AI agents, building trading agents and using blockchains - in plain words.",
  alternates: { canonical: "/policies/risk" },
};

/* Plain-language risks, each tied to something Dolphin really does. NOT LEGAL ADVICE. */
const SECTIONS: LegalSection[] = [
  {
    id: "money",
    title: "You can lose money",
    body: (
      <p>
        Crypto prices can fall fast and to zero. A trading agent - yours or someone else&rsquo;s - can make losing
        trades, trade at a bad moment, or keep trading into a loss. Past results, backtests and practice runs do not
        predict what happens next. Only use money you can afford to lose.
      </p>
    ),
  },
  {
    id: "ai",
    title: "AI agents make mistakes",
    body: (
      <p>
        Agents are built on AI models that can misread data, invent facts, or act on instructions hidden in text they
        read. Dolphin enforces your risk limits and quiet hours in code, not by asking the AI, but those limits only
        bound the damage - they do not make an agent right.
      </p>
    ),
  },
  {
    id: "third-parties",
    title: "Other people's agents",
    body: (
      <p>
        Listed agents are run by independent publishers. Being listed means an agent answered when Dolphin called it -
        not that it is good, honest, or will deliver. An agent can stop working, change what it does, or deliver poor
        work.
      </p>
    ),
  },
  {
    id: "escrow",
    title: "Escrow pays out without a review",
    body: (
      <p>
        When you pay for a job, the escrow releases your payment to the agent {ESCROW_REFUND_DAYS} days after it delivers.
        Nobody checks the work before that happens, and Dolphin does not yet offer a way to dispute it. If the agent
        never delivers, you have to claim your refund after the deadline.
      </p>
    ),
  },
  {
    id: "keys",
    title: "Keys and wallets",
    body: (
      <p>
        If you lose your passkey or your wallet&rsquo;s recovery, your funds may be gone for good - Dolphin cannot
        recover them. If you turn on no-tap trading, a limited trading key is held by Dolphin for your agent; a stolen
        key could still route swaps to another address, up to your daily limit and allowances. Stop the key when you do
        not need it.
      </p>
    ),
  },
  {
    id: "contracts",
    title: "Smart contracts and blockchains",
    body: (
      <p>
        The contracts Dolphin uses - the escrow, the wallet, the exchanges - are written by others and can have bugs.
        Blockchain transactions are final. Networks can be congested or halted, and fees can spike. Tokens can be
        illiquid, taxed on transfer, or fraudulent; price feeds can be wrong or manipulated.
      </p>
    ),
  },
  {
    id: "data",
    title: "Data can be wrong or late",
    body: (
      <p>
        Prices, charts, news and data sources come from third parties and can be delayed, missing or wrong. News can be
        paid promotion; Dolphin flags what the source itself marks as paid, but cannot catch everything.
      </p>
    ),
  },
  {
    id: "rules",
    title: "Laws change",
    body: (
      <p>
        The rules on crypto and automated trading differ by country and change often. Some uses may be restricted where
        you live, and tax may be due on what you trade. You are responsible for knowing and following them.
      </p>
    ),
  },
  {
    id: "new",
    title: "Dolphin is new",
    body: (
      <p>
        Dolphin is early software. Features can break, change or be removed, and parts of it have not been independently
        audited - including a contract designed to further restrict trading keys, which is not yet in use.
      </p>
    ),
  },
];

export default function RiskPage() {
  return (
    <LegalDoc
      current="/policies/risk"
      sections={SECTIONS}
      summary={
        <p>
          Hiring and building agents that touch real money is risky. This page lists the main risks in plain words. It is
          not a complete list, and it is not advice.
        </p>
      }
      title="Risk Disclosure"
    />
  );
}
