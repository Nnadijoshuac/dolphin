"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState, type DragEvent } from "react";

import { knowledgeApi, type KnowledgeTool } from "@/convex/api";
import { extractDocument } from "@/lib/knowledge-extract";

/**
 * KNOWLEDGE, IN THE DRAFT PANEL (owner, 2026-10-03; Agent/PLAN-2026-10-03-knowledge-mcps.md, steps 1-2).
 *
 * The builder adds Markdown, text or PDF files. Their own browser reads them
 * (lib/knowledge-extract.ts) and sends only the text; Dolphin splits it into
 * sections and proposes the tools buyers will call, each with a suggested
 * price the builder can change, or switch off.
 */

const MAX_AGENT_TEXT_CHARS = 300_000;
const ACCEPT = ".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf";

function size(chars: number): string {
  return chars < 1000 ? `${chars} characters` : `${Math.round(chars / 1000).toLocaleString("en")}k characters`;
}

/**
 * A price as typed, checked here first so a wrong one never costs a server
 * call. Mirrors convex/lib/knowledgeTools.ts parsePriceU, which still decides.
 */
function priceProblem(input: string): string | null {
  const text = input.trim();
  if (text === "" || /^(free|0+(\.0+)?)$/i.test(text)) return null;
  if (!/^\d*\.?\d{1,6}$/.test(text)) return "Type a number, like 0.05, or leave it empty for free.";
  const value = Number(text);
  return value >= 0.001 && value <= 1000 ? null : "A price is between 0.001 and 1,000 U, or empty for free.";
}

function reason(cause: unknown, fallback: string): string {
  if (cause instanceof ConvexError && typeof cause.data === "string") return cause.data;
  if (cause instanceof Error && !(cause instanceof ConvexError) && cause.message && !/\[CONVEX|Server Error/.test(cause.message)) return cause.message;
  return fallback;
}

export function KnowledgeSection({ conversationKey }: { conversationKey: string }) {
  const documents = useQuery(knowledgeApi.knowledge.documents, { conversationKey });
  const toolState = useQuery(knowledgeApi.knowledge.tools, { conversationKey });
  const remove = useMutation(knowledgeApi.knowledge.removeDocument);
  const addDocument = useAction(knowledgeApi.knowledge.addDocument);
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "done"; text: string } | null>(null);
  const [over, setOver] = useState(false);

  const used = (documents ?? []).reduce((sum, document) => sum + document.textChars, 0);

  async function add(files: FileList | File[]) {
    setMessage(null);
    for (const file of Array.from(files)) {
      setReading(file.name);
      try {
        const { kind, text } = await extractDocument(file);
        const added = await addDocument({ conversationKey, fileName: file.name, kind, text });
        setMessage({
          tone: "done",
          text: `Read ${added.name}: ${added.sections.length} ${added.sections.length === 1 ? "section" : "sections"}, ${size(added.textChars)} of text.`,
        });
      } catch (cause) {
        setMessage({ tone: "error", text: reason(cause, `${file.name} could not be added. Try again.`) });
      } finally {
        setReading(null);
      }
    }
    if (input.current) input.current.value = "";
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!reading && event.dataTransfer.files.length) void add(event.dataTransfer.files);
  };

  return (
    <div
      className={`knowledge-drop py-3 ${over ? "is-over" : ""}`}
      onDragLeave={() => setOver(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDrop={onDrop}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Knowledge</p>
        {used / MAX_AGENT_TEXT_CHARS >= 0.01 ? (
          <p className="text-[0.64rem] text-faint">{Math.round((used / MAX_AGENT_TEXT_CHARS) * 100)}% of its room used</p>
        ) : null}
      </div>

      {documents && documents.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {documents.map((document) => (
            <li className="rounded-lg bg-paper-muted/70 px-3 py-2" key={document.id}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8rem] font-medium text-ink">{document.name}</span>
                  <span className="block text-[0.68rem] text-muted">
                    {document.kind === "pdf" ? "PDF" : document.kind === "markdown" ? "Markdown" : "Text"} · {document.sections.length}{" "}
                    {document.sections.length === 1 ? "section" : "sections"} · {size(document.textChars)}
                  </span>
                </div>
                <button
                  aria-label={`Remove ${document.name}`}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper hover:text-ink"
                  onClick={() =>
                    void remove({ conversationKey, documentId: document.id }).catch((cause) =>
                      setMessage({ tone: "error", text: reason(cause, "That document could not be removed.") }),
                    )
                  }
                  type="button"
                >
                  <span aria-hidden className="text-base leading-none">×</span>
                </button>
              </div>
              <p className="mt-1 line-clamp-2 text-[0.68rem] leading-relaxed text-ink-soft">
                {document.sections.map((section) => section.title).join(" · ")}
              </p>
              {document.flags.length > 0 ? (
                <div className="mt-1.5 rounded-md border border-[#d9901a]/40 bg-[#d9901a]/10 px-2 py-1.5 text-[0.68rem] leading-relaxed text-ink-soft">
                  <p className="font-semibold text-ink">Check this before publishing</p>
                  {document.flags.map((flag) => (
                    <p className="mt-0.5" key={flag.reason}>
                      It {flag.reason}: <span className="italic">&ldquo;{flag.excerpt}&rdquo;</span>
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[0.8rem] leading-relaxed text-faint">
          Give your agent documents to answer from: Markdown, text or PDF, up to 2 MB each.
        </p>
      )}

      <input
        accept={ACCEPT}
        className="sr-only"
        multiple
        onChange={(event) => event.target.files && void add(event.target.files)}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      <button
        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 !text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
        disabled={reading !== null}
        onClick={() => input.current?.click()}
        type="button"
      >
        {reading ? `Reading ${reading}…` : "Add documents"}
      </button>
      {message ? (
        <p
          className={`mt-1.5 text-[0.7rem] leading-relaxed ${message.tone === "error" ? "text-danger" : "text-ink-soft"}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      {toolState && toolState.tools.length > 0 ? (
        <div className="mt-4">
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Tools buyers can call</p>
          <p className="mt-0.5 text-[0.68rem] leading-relaxed text-faint">Dolphin suggested these prices. Change any, or leave a box empty for free.</p>
          <ul className="mt-2 space-y-1.5">
            {toolState.tools.map((tool) => (
              <ToolRow conversationKey={conversationKey} hasBrain={toolState.hasBrain} key={tool.name} tool={tool} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ conversationKey, tool, hasBrain }: { conversationKey: string; tool: KnowledgeTool; hasBrain: boolean }) {
  const setTool = useMutation(knowledgeApi.knowledge.setTool);
  const [price, setPrice] = useState(tool.priceU ?? "");
  const [error, setError] = useState<string | null>(null);
  const needsBrain = tool.kind === "ask" && !hasBrain;

  const save = async (change: { price?: string; enabled?: boolean }) => {
    setError(null);
    const problem = change.price !== undefined ? priceProblem(change.price) : null;
    if (problem) {
      setError(problem);
      setPrice(tool.priceU ?? "");
      return;
    }
    try {
      await setTool({ conversationKey, name: tool.name, ...change });
    } catch (cause) {
      setError(reason(cause, "That did not save."));
      if (change.price !== undefined) setPrice(tool.priceU ?? "");
    }
  };

  return (
    <li className={`rounded-lg bg-paper-muted/70 px-3 py-2 ${tool.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Offer ${tool.name}`}
          checked={tool.enabled}
          className="size-3.5 shrink-0 accent-[var(--ink)]"
          disabled={needsBrain && !tool.enabled}
          onChange={(event) => void save({ enabled: event.target.checked })}
          type="checkbox"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[0.76rem] text-ink">{tool.name}</span>
        <label className="flex shrink-0 items-center gap-1 rounded-md border border-line/80 bg-paper px-1.5 py-0.5">
          <span className="sr-only">Price of {tool.name} in U</span>
          <input
            className="w-12 bg-transparent text-right !text-[0.74rem] tabular-nums text-ink outline-none placeholder:text-faint"
            disabled={!tool.enabled}
            inputMode="decimal"
            onBlur={() => {
              if (price.trim() !== (tool.priceU ?? "")) void save({ price });
            }}
            onChange={(event) => setPrice(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            placeholder="Free"
            value={price}
          />
          <span className="text-[0.66rem] text-muted">U</span>
        </label>
      </div>
      <p className="mt-0.5 pl-[22px] text-[0.68rem] leading-relaxed text-muted">
        {needsBrain ? "Answers questions with your own model. Add a Brain to offer it." : tool.description}
      </p>
      {error ? (
        <p className="mt-0.5 pl-[22px] text-[0.68rem] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
