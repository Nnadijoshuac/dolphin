"use client";

import { useEffect, useRef, useState } from "react";

const SITE = "https://www.dolphinamp.xyz";

function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg aria-hidden fill="none" height={14} viewBox="0 0 24 24" width={14}>
      {done ? (
        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      ) : (
        <path d="M9 9V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4M5 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      )}
    </svg>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** One-tap copy for a code block (owner, 2026-10-03: "press copy, copied, finish, go paste it"). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      aria-label={done ? "Copied" : label}
      className="docs-copy"
      data-done={done || undefined}
      onClick={() =>
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        })
      }
      title={done ? "Copied" : label}
      type="button"
    >
      <CopyGlyph done={done} />
      <span>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** The page as plain text for an AI: its title, address and every heading and paragraph. */
function pageText(): string {
  const source = document.querySelector<HTMLElement>("[data-docs-article]");
  const title = document.querySelector("h1")?.textContent?.trim() ?? "Dolphin docs";
  if (!source) return `# ${title}\n`;
  // The page's words only: no heading anchors or copy-button labels.
  const article = source.cloneNode(true) as HTMLElement;
  article.querySelectorAll(".docs-anchor, .docs-copy").forEach((element) => element.remove());
  // innerText needs layout, so measure the clone off-screen.
  article.style.position = "fixed";
  article.style.left = "-10000px";
  document.body.appendChild(article);
  const text = article.innerText.trim();
  article.remove();
  return `# ${title}\n\nSource: ${window.location.origin}${window.location.pathname}\n\n${text}\n`;
}

const ChatGptGlyph = () => (
  <svg aria-hidden height={15} viewBox="0 0 24 24" width={15}>
    <path
      d="M12 2.5a4.6 4.6 0 0 1 4.4 3.2 4.6 4.6 0 0 1 3.9 6.6 4.6 4.6 0 0 1-3.3 6.9 4.6 4.6 0 0 1-7.4 1.6 4.6 4.6 0 0 1-6-4.3 4.6 4.6 0 0 1 1.1-7.3A4.6 4.6 0 0 1 12 2.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  </svg>
);
const ClaudeGlyph = () => (
  <svg aria-hidden height={15} viewBox="0 0 24 24" width={15}>
    <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
  </svg>
);

/**
 * COPY PAGE, OR ASK AN AI ABOUT IT (owner, 2026-10-03, after nextra.site): copy the page as text
 * for any assistant, or open ChatGPT or Claude with a message about this page already typed -
 * the person only presses Enter.
 */
export function CopyPageMenu({ title, path }: { title: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const prompt = `Read ${SITE}${path} - Dolphin's "${title}" page - and help me with it. Answer from that page.`;
  const copyPage = () =>
    void copyText(pageText()).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setOpen(false);
      window.setTimeout(() => setCopied(false), 1600);
    });

  return (
    <div className="docs-copypage" ref={box}>
      <button className="docs-copypage__main" onClick={copyPage} type="button">
        <CopyGlyph done={copied} />
        {copied ? "Copied" : "Copy page"}
      </button>
      <button aria-expanded={open} aria-haspopup="menu" aria-label="More ways to use this page" className="docs-copypage__more" onClick={() => setOpen((value) => !value)} type="button">
        <svg aria-hidden fill="none" height={12} viewBox="0 0 24 24" width={12}>
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      </button>
      {open ? (
        <div className="docs-copypage__menu" role="menu">
          <button onClick={copyPage} role="menuitem" type="button">
            <CopyGlyph done={false} />
            <span>
              <strong>Copy page</strong>
              <small>Copy this page as text for any AI</small>
            </span>
          </button>
          <a href={`https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`} onClick={() => setOpen(false)} rel="noreferrer" role="menuitem" target="_blank">
            <ChatGptGlyph />
            <span>
              <strong>Open in ChatGPT ↗</strong>
              <small>Ask questions about this page</small>
            </span>
          </a>
          <a href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} onClick={() => setOpen(false)} rel="noreferrer" role="menuitem" target="_blank">
            <ClaudeGlyph />
            <span>
              <strong>Open in Claude ↗</strong>
              <small>Ask questions about this page</small>
            </span>
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** "On this page", following the reader down the page. */
export function Toc({ items }: { items: { id: string; title: string }[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => Boolean(el));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page" className="docs-toc">
      <p className="docs-toc__title">On this page</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a aria-current={active === item.id ? "location" : undefined} href={`#${item.id}`}>
              {item.title}
            </a>
          </li>
        ))}
      </ul>
      <div className="docs-toc__extra">
        <a href="https://x.com/dolphin_Agents" rel="noreferrer" target="_blank">
          Question? Ask us on X ↗
        </a>
      </div>
    </nav>
  );
}
