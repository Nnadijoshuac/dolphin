"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryGlyph } from "@/components/category-glyph";

export function MobileStackHeader({ title, fallback = "/", share = false }: { title: string; fallback?: string; share?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function sharePage() {
    try {
      if (navigator.share) await navigator.share({ title, url: location.href });
      else { await navigator.clipboard.writeText(location.href); setMessage("Link copied"); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Could not share this link");
    }
  }
  return (
    <header className="mobile-only mobile-stack-header">
      <button className="mobile-circle" type="button" aria-label="Go back" onClick={() => window.history.length > 1 ? router.back() : router.push(fallback)}><CategoryGlyph name="chevron-left" size={20} /></button>
      <p>{title}</p>
      {share && <button className="mobile-circle" type="button" aria-label="Share agent" onClick={() => void sharePage()}><CategoryGlyph name="share" size={18} /></button>}
      <span className="sr-only" role="status">{message}</span>
    </header>
  );
}
