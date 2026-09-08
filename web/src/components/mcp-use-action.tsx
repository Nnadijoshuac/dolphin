"use client";

import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { PearlButton } from "@/components/pearl-button";
import type { Agent } from "@/types/agent";

export function McpUseAction({ agent }: { agent: Agent }) {
  const endpoint = agent.services[0]?.endpoint ?? null;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!endpoint) return;
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement("textarea");
      textarea.value = endpoint;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const toolCount = agent.skills.length;

  return (
    <div className="surface-raised p-5 sm:p-6 rounded-2xl border border-line bg-paper shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-xs uppercase tracking-wider text-muted font-bold">
            Integration
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.04em] text-ink">
            Free to Connect
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-900 border border-purple-200">
          <CategoryGlyph color="currentColor" name="layers" size={12} strokeWidth={2.2} />
          {toolCount > 0 ? `${toolCount} MCP ${toolCount === 1 ? "Tool" : "Tools"}` : "MCP Server"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        Connect this MCP server directly to your AI client without paying gas or escrow fees.
      </p>

      <div className="mt-5">
        <PearlButton
          disabled={!endpoint}
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Endpoint Copied!" : "Copy MCP Endpoint"}
        </PearlButton>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        {copied
          ? "Ready to paste into Claude Desktop, Cursor, Cline, or your AI client"
          : "Paste directly into Claude Desktop, Cursor, Cline, or your AI client"}
      </p>

      {endpoint ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-line bg-paper-muted px-3.5 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink/80">
            {endpoint}
          </code>
          <button
            aria-label="Copy endpoint URL"
            className="interactive shrink-0 text-muted hover:text-ink"
            onClick={handleCopy}
            type="button"
          >
            <CategoryGlyph
              color="currentColor"
              name={copied ? "check" : "copy"}
              size={15}
              strokeWidth={2}
            />
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-paper-muted p-3 text-xs text-muted text-center">
          No public endpoint published for this MCP server.
        </div>
      )}

      <p className="mt-4 text-center text-[11px] leading-relaxed text-faint border-t border-line/60 pt-3">
        Dolphin confirmed this server answers and lists tools · Verified live
      </p>
    </div>
  );
}
