"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { BrandMark, BnbBadge } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";

const categories = [
  { name: "Rebalancing", icon: "rebalancing", description: "Reset LP ranges automatically" },
  { name: "Grid trading", icon: "grid-trading", description: "Place orders across a price ladder" },
  { name: "Health factor", icon: "health-factor", description: "Track borrowing risk" },
  { name: "Yield", icon: "yield", description: "Find earning opportunities" },
] as const;

export function MobileOnboarding({ finish }: { finish: (skipped: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  function goTo(next: number) {
    if (next > 3) { finish(false); return; }
    rail.current?.scrollTo({ left: next * rail.current.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return <div className="mobile-onboarding">
    <header><div><BrandMark size={28} /><div><strong>Dolphin</strong><p>ERC-8004 AI agent marketplace</p></div></div>{index < 3 && <button type="button" onClick={() => finish(true)}>Skip <CategoryGlyph name="chevron-right" size={12} /></button>}</header>
    <div className="mobile-onboarding-rail" ref={rail} onScroll={event => setIndex(Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))}>
      <section aria-label="Introduction" aria-hidden={index !== 0}><Image className="mobile-onboarding-splash" src="/promos/onboarding-splash.jpeg" width={320} height={260} alt="Dolphin" /><div><BnbBadge /><h1>AI agents,<br />made understandable</h1><p>Discover onchain helpers that watch, protect, trade, and find yield.</p></div></section>
      <section aria-label="What agents do" aria-hidden={index !== 1}><div><small>AI agents for DeFi</small><h2>Four ways<br />agents can help</h2><div className="mobile-onboarding-grid">{categories.map(category => <article key={category.icon}><span><CategoryGlyph name={category.icon} size={22} /></span><h3>{category.name}</h3><p>{category.description}</p></article>)}</div></div></section>
      <section aria-label="Permissions" aria-hidden={index !== 2}><div><Image className="mobile-onboarding-shield" src="/promos/onboarding-shield.png" width={160} height={160} alt="" /><h2>Know what you approve</h2><div className="mobile-onboarding-permissions"><article><CategoryGlyph name="monitoring" size={24} /><div><h3>Read-only agents</h3><p>Use only a public address to monitor</p></div></article><article><CategoryGlyph name="agents" size={24} /><div><h3>Action agents</h3><p>Show availability and permissions before any signature</p></div></article></div><p className="mobile-onboarding-notice">Dolphin never asks for a private key. Paying for a task is a separate choice you review before signing.</p></div></section>
      <section aria-label="Start discovering" aria-hidden={index !== 3}><div><small>Step 4 of 4</small><h2>Find the right agent</h2><p>Browse registry identities and review available evidence without submitting a transaction.</p><div className="mobile-onboarding-grid mobile-onboarding-grid--compact">{categories.map(category => <article key={category.icon}><CategoryGlyph name={category.icon} size={24} /><h3>{category.name}</h3></article>)}</div></div></section>
    </div>
    <footer><div className="mobile-onboarding-dots" aria-label={`Step ${index + 1} of 4`}>{[0, 1, 2, 3].map(step => <button aria-label={`Go to step ${step + 1}`} aria-current={index === step ? "step" : undefined} type="button" onClick={() => goTo(step)} key={step}>{step < index ? <CategoryGlyph name="check" color="#f5b300" size={16} /> : <span />}</button>)}</div><button className="mobile-onboarding-continue" type="button" onClick={() => goTo(index + 1)}>{index === 3 ? "Start discovering" : "Continue"}<CategoryGlyph name="arrow-right" size={16} /></button>{index > 0 && <button className="mobile-onboarding-back" type="button" onClick={() => goTo(index - 1)}>Back</button>}</footer>
  </div>;
}
