"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState, type DragEvent } from "react";

import { knowledgeApi } from "@/convex/api";

/**
 * KNOWLEDGE, IN THE DRAFT PANEL (owner, 2026-10-03; Agent/PLAN-2026-10-03-knowledge-mcps.md, step 1).
 *
 * The builder adds Markdown, text or PDF files; Dolphin keeps their text as
 * sections (convex/knowledgeIngest.ts) and deletes the files. The limits here
 * mirror convex/lib/knowledge.ts so a file that cannot fit is refused before
 * it is uploaded.
 */

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_AGENT_TEXT_CHARS = 300_000;
const ACCEPT = ".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf";

function kb(chars: number): string {
  return chars < 1000 ? `${chars} characters` : `${Math.round(chars / 1000).toLocaleString("en")}k characters`;
}

function reason(cause: unknown): string {
  if (cause instanceof ConvexError && typeof cause.data === "string") return cause.data;
  return "That file could not be added. Try again.";
}

export function KnowledgeSection({ conversationKey }: { conversationKey: string }) {
  const documents = useQuery(knowledgeApi.knowledge.documents, { conversationKey });
  const uploadUrl = useMutation(knowledgeApi.knowledge.uploadUrl);
  const remove = useMutation(knowledgeApi.knowledge.removeDocument);
  const addDocument = useAction(knowledgeApi.knowledgeIngest.addDocument);
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "done"; text: string } | null>(null);
  const [over, setOver] = useState(false);

  const used = (documents ?? []).reduce((sum, document) => sum + document.textChars, 0);

  async function add(files: FileList | File[]) {
    setMessage(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setMessage({ tone: "error", text: `${file.name} is over 2 MB. Dolphin reads files up to 2 MB.` });
        continue;
      }
      if (!/\.(md|markdown|txt|pdf)$/i.test(file.name)) {
        setMessage({ tone: "error", text: `${file.name}: Dolphin reads Markdown, plain text and PDF files.` });
        continue;
      }
      setReading(file.name);
      try {
        const { uploadUrl: url } = await uploadUrl({ conversationKey });
        const response = await fetch(url, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
        if (!response.ok) throw new Error("upload");
        const { storageId } = (await response.json()) as { storageId: string };
        const added = await addDocument({ conversationKey, storageId, fileName: file.name });
        setMessage({
          tone: "done",
          text: `Read ${added.name}: ${added.sections.length} ${added.sections.length === 1 ? "section" : "sections"}, ${kb(added.textChars)} of text.`,
        });
      } catch (cause) {
        setMessage({ tone: "error", text: reason(cause) });
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
                    {document.sections.length === 1 ? "section" : "sections"} · {kb(document.textChars)}
                  </span>
                </div>
                <button
                  aria-label={`Remove ${document.name}`}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper hover:text-ink"
                  onClick={() => void remove({ conversationKey, documentId: document.id }).catch((cause) => setMessage({ tone: "error", text: reason(cause) }))}
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

      <input accept={ACCEPT} className="sr-only" multiple onChange={(event) => event.target.files && void add(event.target.files)} ref={input} tabIndex={-1} type="file" />
      <button
        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 !text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
        disabled={reading !== null}
        onClick={() => input.current?.click()}
        type="button"
      >
        {reading ? `Reading ${reading}…` : "Add documents"}
      </button>
      {message ? (
        <p className={`mt-1.5 text-[0.7rem] leading-relaxed ${message.tone === "error" ? "text-danger" : "text-ink-soft"}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
