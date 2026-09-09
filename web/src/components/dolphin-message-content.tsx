"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { buildAgentNameMap } from "@/lib/dolphin-agents";

interface DolphinMessageContentProps {
  content: string;
  toolCalls?: Array<{ agentName: string; agentKey: string }>;
  dynamicAgents?: Array<{ name: string; agentKey: string }>;
  onSelectPrompt?: (prompt: string) => void;
  showCopyButton?: boolean;
}

type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "agent-link"; label: string; agentKey: string }
  | { type: "nav-link"; label: string; url: string };

type BlockNode =
  | { type: "header"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "numbered-list"; items: Array<{ num: string; text: string }> };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parses inline string into code spans, bold spans, and hyperlinked agent mentions.
 */
function parseInline(text: string, agentMap: Map<string, string>): InlineNode[] {
  if (!text) return [];

  const agentNames = Array.from(agentMap.keys()).sort((a, b) => b.length - a.length);

  function parseTextWithAgents(str: string): InlineNode[] {
    if (!str || agentNames.length === 0) {
      return str ? [{ type: "text", text: str }] : [];
    }

    const pattern = new RegExp(`(${agentNames.map(escapeRegex).join("|")})`, "g");
    const parts = str.split(pattern);
    const nodes: InlineNode[] = [];

    for (const part of parts) {
      if (!part) continue;
      const key = agentMap.get(part);
      if (key) {
        nodes.push({ type: "agent-link", label: part, agentKey: key });
      } else {
        nodes.push({ type: "text", text: part });
      }
    }

    return nodes;
  }

  // Tokenize code spans (`code`), bold spans (**bold** or __bold__), and markdown links ([label](url))
  // Regex matches:
  // 2: `code`
  // 4: **bold**
  // 6: __bold__
  // 8: [label]
  // 9: (url)
  const tokenRegex = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\[([^\]]+)\]\(([^)]+)\))/g;
  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const preText = text.slice(lastIndex, match.index);
    if (preText) {
      nodes.push(...parseTextWithAgents(preText));
    }

    if (match[2] !== undefined) {
      // Code span
      nodes.push({ type: "code", text: match[2] });
    } else if (match[4] !== undefined) {
      // **bold** span
      nodes.push({
        type: "bold",
        children: parseTextWithAgents(match[4]),
      });
    } else if (match[6] !== undefined) {
      // __bold__ span
      nodes.push({
        type: "bold",
        children: parseTextWithAgents(match[6]),
      });
    } else if (match[8] !== undefined && match[9] !== undefined) {
      // Markdown link: [label](url)
      nodes.push({
        type: "nav-link",
        label: match[8],
        url: match[9],
      });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) {
    nodes.push(...parseTextWithAgents(remaining));
  }

  return nodes;
}

/**
 * Parses markdown blocks: headers, bullet lists, numbered lists, paragraphs.
 */
function parseBlocks(markdown: string): BlockNode[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: BlockNode[] = [];
  let currentBulletList: string[] | null = null;
  let currentNumList: Array<{ num: string; text: string }> | null = null;
  let currentParagraph: string[] | null = null;

  const flush = () => {
    if (currentBulletList && currentBulletList.length > 0) {
      blocks.push({ type: "bullet-list", items: currentBulletList });
      currentBulletList = null;
    }
    if (currentNumList && currentNumList.length > 0) {
      blocks.push({ type: "numbered-list", items: currentNumList });
      currentNumList = null;
    }
    if (currentParagraph && currentParagraph.length > 0) {
      blocks.push({ type: "paragraph", text: currentParagraph.join("\n") });
      currentParagraph = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flush();
      continue;
    }

    // Check for Markdown headers: #, ##, ###
    const mdHeaderMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (mdHeaderMatch) {
      flush();
      blocks.push({
        type: "header",
        level: mdHeaderMatch[1].length,
        text: mdHeaderMatch[2],
      });
      continue;
    }

    // Check for standalone bold line as a header, e.g. "**What you can do right now**"
    const boldHeaderMatch = line.match(/^\*\*([^*]+)\*\*:?$/) || line.match(/^__([^_]+)__:?$/);
    if (boldHeaderMatch) {
      flush();
      blocks.push({
        type: "header",
        level: 3,
        text: boldHeaderMatch[1],
      });
      continue;
    }

    // Check for bullet list item: "- item" or "* item" or "• item"
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (currentNumList) {
        blocks.push({ type: "numbered-list", items: currentNumList });
        currentNumList = null;
      }
      if (currentParagraph) {
        blocks.push({ type: "paragraph", text: currentParagraph.join("\n") });
        currentParagraph = null;
      }
      if (!currentBulletList) currentBulletList = [];
      currentBulletList.push(bulletMatch[1]);
      continue;
    }

    // Check for numbered list item: "1. item" or "1) item"
    const numMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numMatch) {
      if (currentBulletList) {
        blocks.push({ type: "bullet-list", items: currentBulletList });
        currentBulletList = null;
      }
      if (currentParagraph) {
        blocks.push({ type: "paragraph", text: currentParagraph.join("\n") });
        currentParagraph = null;
      }
      if (!currentNumList) currentNumList = [];
      currentNumList.push({ num: numMatch[1], text: numMatch[2] });
      continue;
    }

    // Regular paragraph line
    if (currentBulletList) {
      // Indented or wrapped list item text
      currentBulletList[currentBulletList.length - 1] += ` ${line}`;
      continue;
    }
    if (currentNumList) {
      currentNumList[currentNumList.length - 1].text += ` ${line}`;
      continue;
    }

    if (!currentParagraph) currentParagraph = [];
    currentParagraph.push(line);
  }

  flush();
  return blocks;
}

/**
 * Extracts smart prompt suggestions from Dolphin's response text if it offers next steps.
 */
function extractSuggestedActions(text: string): string[] {
  const suggestions: string[] = [];
  const lower = text.toLowerCase();

  if (lower.includes("pancakeswap grid trader") || lower.includes("grid trader")) {
    suggestions.push("Check PancakeSwap grid stats");
    suggestions.push("Verify grid agent liveness");
  } else if (lower.includes("venus")) {
    suggestions.push("Check Venus liquidation health");
    suggestions.push("Compare Venus lending yield");
  } else if (lower.includes("yield")) {
    suggestions.push("Find highest yield agents");
  } else if (lower.includes("token safety") || lower.includes("security")) {
    suggestions.push("Audit BNB token safety");
  }

  if (lower.includes("reachable") || lower.includes("liveness")) {
    if (!suggestions.includes("Verify agent liveness")) {
      suggestions.push("Verify agent liveness");
    }
  }

  return suggestions.slice(0, 3);
}

export function DolphinMessageContent({
  content,
  toolCalls,
  dynamicAgents,
  onSelectPrompt,
  showCopyButton = true,
}: DolphinMessageContentProps) {
  const [copied, setCopied] = useState(false);

  const agentMap = useMemo(() => {
    return buildAgentNameMap(dynamicAgents, toolCalls);
  }, [dynamicAgents, toolCalls]);

  const blocks = useMemo(() => parseBlocks(content), [content]);
  const suggestions = useMemo(() => extractSuggestedActions(content), [content]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderInline = (nodes: InlineNode[]) => {
    return nodes.map((node, i) => {
      if (node.type === "text") {
        return <span key={i}>{node.text}</span>;
      }
      if (node.type === "code") {
        return (
          <code
            className="mx-0.5 rounded border border-line/60 bg-paper-subtle/90 px-1.5 py-0.5 font-mono text-[0.82em] font-medium text-accent-ink"
            key={i}
          >
            {node.text}
          </code>
        );
      }
      if (node.type === "bold") {
        return (
          <strong className="font-semibold text-ink" key={i}>
            {renderInline(node.children)}
          </strong>
        );
      }
      if (node.type === "agent-link") {
        return (
          <Link
            className="inline-flex items-center gap-1 font-semibold text-accent-ink underline decoration-accent-ink/40 underline-offset-2 transition-colors hover:decoration-accent-ink"
            href={`/agent/${encodeURIComponent(node.agentKey)}`}
            key={i}
            title={`View ${node.label} on BNB Chain`}
          >
            {node.label}
          </Link>
        );
      }
      if (node.type === "nav-link") {
        return (
          <Link
            className="inline-flex items-center gap-1 font-semibold text-accent-ink underline decoration-accent-ink/40 underline-offset-2 transition-colors hover:decoration-accent-ink"
            href={node.url}
            key={i}
          >
            {node.label}
          </Link>
        );
      }
      return null;
    });
  };

  return (
    <div className="relative group/msg">
      {showCopyButton ? (
        <button
          aria-label="Copy message text"
          className="absolute right-0 top-0 hidden rounded-lg border border-line/60 bg-paper px-2 py-1 text-[0.7rem] font-medium text-muted opacity-0 shadow-sm transition-all hover:bg-paper-subtle hover:text-ink group-hover/msg:opacity-100 sm:inline-flex"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      ) : null}

      <div className="space-y-3.5 text-[0.92rem] leading-[1.7] text-ink">
        {blocks.map((block, idx) => {
          if (block.type === "header") {
            return (
              <div
                className="mt-3.5 font-semibold text-ink text-[0.96rem] tracking-tight first:mt-0"
                key={idx}
              >
                {renderInline(parseInline(block.text, agentMap))}
              </div>
            );
          }

          if (block.type === "bullet-list") {
            return (
              <ul className="my-1.5 space-y-1.5 pl-0.5" key={idx}>
                {block.items.map((item, itemIdx) => (
                  <li className="flex items-start gap-2 text-ink" key={itemIdx}>
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-ink/70" />
                    <span className="flex-1">
                      {renderInline(parseInline(item, agentMap))}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }

          if (block.type === "numbered-list") {
            return (
              <ol className="my-1.5 space-y-1.5 pl-0.5" key={idx}>
                {block.items.map((item, itemIdx) => (
                  <li className="flex items-start gap-2.5 text-ink" key={itemIdx}>
                    <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-accent-soft/80 font-mono text-[0.68rem] font-bold text-accent-ink">
                      {item.num}
                    </span>
                    <span className="flex-1">
                      {renderInline(parseInline(item.text, agentMap))}
                    </span>
                  </li>
                ))}
              </ol>
            );
          }

          return (
            <p className="my-1 whitespace-pre-wrap leading-[1.7]" key={idx}>
              {renderInline(parseInline(block.text, agentMap))}
            </p>
          );
        })}
      </div>

      {/* Suggested quick action chips to make it effortless for the user */}
      {onSelectPrompt && suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 pt-1">
          {suggestions.map((prompt, i) => (
            <button
              className="inline-flex cursor-pointer items-center rounded-full border border-line/80 bg-paper px-2.5 py-1 text-xs font-medium text-ink transition-all hover:border-accent-ink/50 hover:bg-accent-soft/40 hover:text-accent-ink"
              key={i}
              onClick={() => onSelectPrompt(prompt)}
              type="button"
            >
              <span className="mr-1 text-accent-ink">›</span>
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
