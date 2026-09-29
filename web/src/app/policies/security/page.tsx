import type { Metadata } from "next";

import { LegalDoc, type LegalSection } from "@/components/legal-doc";
import { LEGAL, contactLine } from "@/constants/legal";

export const metadata: Metadata = {
  title: "Security Policy",
  description: "How to report a security problem in Dolphin, what is in scope, and what to expect from us.",
  alternates: { canonical: "/policies/security" },
};

/*
 * No paid bounty exists, so none is implied. security.txt (RFC 9116) is not
 * published yet because it needs a real Contact address - add it with
 * LEGAL.email. NOT LEGAL ADVICE.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "report",
    title: "How to report",
    body: (
      <>
        <p>If you find a security problem in Dolphin, please tell us privately: {contactLine()}.</p>
        <p>Include what you found, where, the steps to reproduce it, and what an attacker could do with it.</p>
        <p>Please give us a reasonable chance to fix it before you tell anyone else.</p>
      </>
    ),
  },
  {
    id: "scope",
    title: "In scope",
    body: (
      <ul>
        <li>The Dolphin website ({LEGAL.site}).</li>
        <li>Dolphin&rsquo;s backend functions that the website calls.</li>
        <li>The endpoints Dolphin hosts for agents built on it.</li>
        <li>The transactions Dolphin builds for you to sign, and the trading keys it holds for no-tap trading.</li>
      </ul>
    ),
  },
  {
    id: "out-of-scope",
    title: "Out of scope",
    body: (
      <ul>
        <li>Agents published by others in the catalog - report those to their publishers.</li>
        <li>Third-party contracts and services: PancakeSwap, Venus, Altana, the ERC-8004 and ERC-8183 contracts, wallets.</li>
        <li>Denial-of-service, spam, social engineering, and physical attacks.</li>
      </ul>
    ),
  },
  {
    id: "safe-harbour",
    title: "Good-faith research",
    body: (
      <p>
        We will not pursue anyone who researches in good faith: who stays in scope, avoids harming users, their funds and
        their data, uses only their own accounts and wallets, stops as soon as they have confirmed a problem, and reports
        it to us privately.
      </p>
    ),
  },
  {
    id: "expect",
    title: "What to expect",
    body: (
      <p>
        We will acknowledge your report, keep you informed while we fix it, and credit you if you would like. Dolphin
        does not currently run a paid bug bounty.
      </p>
    ),
  },
];

export default function SecurityPage() {
  return (
    <LegalDoc
      current="/policies/security"
      sections={SECTIONS}
      summary={<p>Found a way to break Dolphin? Please tell us first, privately, and we will work with you to fix it.</p>}
      title="Security Policy"
    />
  );
}
