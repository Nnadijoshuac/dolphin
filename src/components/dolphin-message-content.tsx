import { useMemo, useState } from "react";
import {
  Platform,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
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
  | { type: "agent-link"; label: string; agentKey: string };

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

  // Tokenize code spans (`code`) and bold spans (**bold** or __bold__)
  const tokenRegex = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)/g;
  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const preText = text.slice(lastIndex, match.index);
    if (preText) {
      nodes.push(...parseTextWithAgents(preText));
    }

    if (match[2] !== undefined) {
      nodes.push({ type: "code", text: match[2] });
    } else if (match[4] !== undefined) {
      nodes.push({
        type: "bold",
        children: parseTextWithAgents(match[4]),
      });
    } else if (match[6] !== undefined) {
      nodes.push({
        type: "bold",
        children: parseTextWithAgents(match[6]),
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

    // Markdown header
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

    // Bold title line as header, e.g. "**What you can do right now**"
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

    // Bullet list item
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

    // Numbered list item
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

    // Wrapped or continuation line
    if (currentBulletList) {
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
 * Extracts smart prompt suggestions from Dolphin's response text.
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
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const agentMap = useMemo(() => {
    return buildAgentNameMap(dynamicAgents, toolCalls);
  }, [dynamicAgents, toolCalls]);

  const blocks = useMemo(() => parseBlocks(content), [content]);
  const suggestions = useMemo(() => extractSuggestedActions(content), [content]);

  const handleCopy = async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderInline = (nodes: InlineNode[], keyPrefix: string) => {
    return nodes.map((node, i) => {
      const key = `${keyPrefix}-${i}`;
      if (node.type === "text") {
        return <Text key={key}>{node.text}</Text>;
      }
      if (node.type === "code") {
        return (
          <Text
            key={key}
            style={{
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 13,
              fontWeight: "600",
              color: colors.goldDark,
              backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
            }}
          >
            {` ${node.text} `}
          </Text>
        );
      }
      if (node.type === "bold") {
        return (
          <Text key={key} style={{ fontWeight: "700", color: colors.ink }}>
            {renderInline(node.children, `${key}-b`)}
          </Text>
        );
      }
      if (node.type === "agent-link") {
        return (
          <Text
            key={key}
            onPress={() => {
              void Haptics.selectionAsync();
              router.push({ pathname: "/agent/[id]", params: { id: node.agentKey } });
            }}
            style={{
              fontWeight: "700",
              color: colors.goldDark,
              textDecorationLine: "underline",
              textDecorationColor: `${colors.goldDark}55`,
            }}
          >
            {node.label}
          </Text>
        );
      }
      return null;
    });
  };

  return (
    <View style={{ position: "relative" }}>
      {showCopyButton ? (
        <View style={{ position: "absolute", top: -2, right: 0, zIndex: 5 }}>
          <PressableScale
            accessibilityLabel="Copy message"
            onPress={handleCopy}
            containerStyle={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
              borderWidth: 0.5,
              borderColor: colors.goldBorder,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CategoryGlyph
              color={colors.inkSecondary}
              name={copied ? "check" : "copy"}
              size={11}
              strokeWidth={2}
            />
            <Text style={{ fontSize: 10, fontWeight: "600", color: colors.inkSecondary }}>
              {copied ? "Copied" : "Copy"}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        {blocks.map((block, idx) => {
          if (block.type === "header") {
            return (
              <Text
                key={idx}
                selectable
                style={{
                  fontSize: 15.5,
                  fontWeight: "700",
                  color: colors.ink,
                  marginTop: 6,
                  marginBottom: 2,
                }}
              >
                {renderInline(parseInline(block.text, agentMap), `h-${idx}`)}
              </Text>
            );
          }

          if (block.type === "bullet-list") {
            return (
              <View key={idx} style={{ marginVertical: 3, gap: 5 }}>
                {block.items.map((item, itemIdx) => (
                  <View
                    key={itemIdx}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 2.5,
                        backgroundColor: colors.goldDark,
                        marginTop: 8,
                      }}
                    />
                    <Text
                      selectable
                      style={{
                        flex: 1,
                        fontSize: 14.5,
                        lineHeight: 22,
                        color: colors.ink,
                      }}
                    >
                      {renderInline(parseInline(item, agentMap), `b-${idx}-${itemIdx}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          }

          if (block.type === "numbered-list") {
            return (
              <View key={idx} style={{ marginVertical: 3, gap: 5 }}>
                {block.items.map((item, itemIdx) => (
                  <View
                    key={itemIdx}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        minWidth: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                        paddingHorizontal: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: colors.goldDark,
                          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                        }}
                      >
                        {item.num}
                      </Text>
                    </View>
                    <Text
                      selectable
                      style={{
                        flex: 1,
                        fontSize: 14.5,
                        lineHeight: 22,
                        color: colors.ink,
                      }}
                    >
                      {renderInline(parseInline(item.text, agentMap), `n-${idx}-${itemIdx}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          }

          return (
            <Text
              key={idx}
              selectable
              style={{
                fontSize: 14.5,
                lineHeight: 22,
                color: colors.ink,
                marginVertical: 1,
              }}
            >
              {renderInline(parseInline(block.text, agentMap), `p-${idx}`)}
            </Text>
          );
        })}
      </View>

      {/* Suggested prompt chips for user convenience */}
      {onSelectPrompt && suggestions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10, paddingTop: 4 }}>
          {suggestions.map((prompt, i) => (
            <PressableScale
              key={i}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectPrompt(prompt);
              }}
              containerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 16,
                backgroundColor: colors.canvas,
                borderWidth: 1,
                borderColor: colors.goldBorder,
              }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.goldDark }}>›</Text>
              <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.inkSecondary }}>
                {prompt}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
    </View>
  );
}
