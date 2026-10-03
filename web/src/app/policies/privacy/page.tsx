import type { Metadata } from "next";
import Link from "next/link";

import { LegalDoc, type LegalSection } from "@/components/legal-doc";
import { LEGAL, contactLine } from "@/constants/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Dolphin collects, why, where it goes, how long it is kept, and what you can do about it.",
  alternates: { canonical: "/policies/privacy" },
};

/*
 * Every line below is checked against the code as of 2026-09-29 - the table
 * names and files are in Agent/BRIEF-2026-09-28-privacy-and-security-policy.md.
 * AGENTS.md §5 applies here as hard as anywhere: never state a practice the
 * code does not follow. NOT LEGAL ADVICE; review with counsel before launch.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "stored",
    title: "What we store",
    body: (
      <>
        <p>Dolphin&rsquo;s database runs on Convex, in the EU (Ireland). It holds:</p>
        <ul>
          <li>
            <strong>Your wallet address and sign-in sessions.</strong> We store only a one-way hash of your sign-in
            token, never the token itself.
          </li>
          <li>
            <strong>Your conversations with Dolphin</strong> - the chat, the agent builder and test runs - including
            what you type, which may include wallet addresses or anything else you choose to write.
          </li>
          <li>
            <strong>Agents you draft and publish,</strong> and the agents you favourite, hire and review, your jobs,
            and a record of wallet actions taken from their on-chain receipts.
          </li>
          <li>
            <strong>Documents you give your agent:</strong> only their text, which your browser extracts before
            anything is sent; the file itself is not uploaded. The text is stored compressed to answer questions, and a
            fingerprint of it goes into your agent&rsquo;s public registration when you put it on-chain.
          </li>
          <li>
            <strong>Your agent&rsquo;s trading rules, its paper trades and limits,</strong> and the trades your own
            server reports back. The token your server reports with is stored only as a one-way hash.
          </li>
          <li>
            <strong>API keys you save</strong> for your own agents, encrypted (AES-256-GCM). We only ever show you their
            name and last four characters, and we decrypt them only to run your agent.
          </li>
          <li>
            <strong>Your email address,</strong> if you sign up for liquidation alerts.
          </li>
          <li>
            <strong>Anonymous counts</strong> of how often each agent is viewed and opened, per day, with no link to
            who you are. These are deleted after 60 days.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "device",
    title: "What stays on your device",
    body: (
      <p>
        Some things are kept only in your browser and never sent to our database: your sign-in token, the reference to
        your Dolphin Wallet passkey, your list of chats and preferences, your last conversation and unsent text, and how
        you have arranged panels and the builder canvas. Clearing your browser&rsquo;s site data removes them.
      </p>
    ),
  },
  {
    id: "why",
    title: "Why we use it",
    body: (
      <ul>
        <li>To run Dolphin: sign you in, show your agents and hires, and run the agents you build.</li>
        <li>To keep it safe and working, and to find and fix problems. The operator can see recent conversations for this purpose.</li>
        <li>To send the alerts you asked for.</li>
        <li>To understand how Dolphin is used, from anonymous counts. We do not sell your data or use it for advertising.</li>
      </ul>
    ),
  },
  {
    id: "shared",
    title: "Who else receives data",
    body: (
      <>
        <p>Using Dolphin sends data to these services, each under its own privacy terms:</p>
        <ul>
          <li>
            <strong>AI model providers.</strong> OpenRouter runs Dolphin&rsquo;s own chat and builder, and writes each
            chat&rsquo;s short title from its first message. Agents you build
            use the model provider on your own key. What you type is sent to them to produce a reply.
          </li>
          <li>
            <strong>Agents in the catalog.</strong> When you, Dolphin or your agent uses another agent, what is sent goes
            to that agent&rsquo;s publisher. They are independent third parties.
          </li>
          <li>
            <strong>Your data sources.</strong> Addresses you give your agent to read from are called with your key.
          </li>
          <li>
            <strong>Wallet and chain services:</strong> WalletConnect / Reown to connect your wallet, Altana for the
            Dolphin Wallet, and public BNB Chain nodes.
          </li>
          <li>
            <strong>Market data:</strong> charts and prices are loaded by your browser directly from DexScreener and
            GeckoTerminal, and security checks come from GoPlus. These services can see your IP address. Dolphin&rsquo;s
            servers read public candles from Binance to check trading rules; nothing about you is sent.
          </li>
          <li>
            <strong>Your own server:</strong> if you run your agent yourself, it talks to Binance directly with your keys.
            Those keys and your exchange account details are never sent to Dolphin; only the trades it reports.
          </li>
          <li>
            <strong>Hosting and delivery:</strong> Vercel hosts the site and provides cookieless analytics; Resend sends
            alert emails; Cloudinary and DiceBear serve images.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "public",
    title: "What is public by nature",
    body: (
      <p>
        Anything on BNB Chain is public and permanent: agent registrations, on-chain reviews, escrow jobs, trades and
        transfers, and the wallet addresses involved. Dolphin cannot hide or delete them.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <p>
        You can delete any chat yourself, from its menu in the chat list, or all of them at once. Deleting a chat removes
        its messages and everything sent to and received from agents from our database. We keep only an anonymous
        record of it - which mode it was, how many messages, and which agents&rsquo; tools it used - with no text and
        nothing that links it to you. If an agent was built from the chat, the agent itself stays. Anonymous counts are
        deleted after 60 days. Everything else we store is kept while Dolphin runs, until you ask us to delete it.
        Sign-in sessions expire on their own.
      </p>
    ),
  },
  {
    id: "choices",
    title: "Your choices and rights",
    body: (
      <>
        <ul>
          <li>You can use most of Dolphin without connecting a wallet.</li>
          <li>You can delete your chats, your saved API keys and your alerts yourself at any time.</li>
          <li>
            You can ask us for a copy of the data we hold about your wallet, or ask us to correct or delete it - we will
            do so for everything that is not on-chain.
          </li>
        </ul>
        <p>Depending on where you live, you may have further rights under data protection law. To use them: {contactLine()}.</p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We protect data with encryption where it matters most (your saved keys, sign-in tokens) and access controls on
        the rest. No system is perfectly secure. If you find a problem, please tell us - see the{" "}
        <Link href="/policies/security">Security Policy</Link>.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Dolphin is not for anyone under 18, and we do not knowingly collect their data.</p>,
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        We will update this page when our practices change, and change the date at the top.{" "}
        {LEGAL.entity ? `The data controller is ${LEGAL.entity}. ` : ""}Privacy questions and requests: {contactLine()}.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      current="/policies/privacy"
      sections={SECTIONS}
      summary={
        <p>
          In short: we store what we need to run Dolphin - your wallet address, your conversations and your agents - and
          encrypt the keys you give us. We do not sell your data. Anything on-chain is public, and we cannot delete it.
        </p>
      }
      title="Privacy Policy"
    />
  );
}
