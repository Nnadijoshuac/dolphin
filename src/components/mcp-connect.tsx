import { useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii } from "@/constants/theme";
import type { Agent } from "@/types/agent";

/**
 * How you actually use an MCP agent: you take its endpoint and plug it into
 * your own client.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACED "not wired up yet"
 * ---------------------------------------------------------------------------
 * The MCP branch of the detail page ended on the line "Running its tools from
 * inside Dolphin is not wired up yet." That sentence sat in front of 26 of the
 * 28 live agents, and it was a dead end printed directly on top of the answer -
 * because Dolphin already holds everything the reader needs.
 *
 * An MCP agent is not commissioned, it is CONNECTED TO. Nobody hires an MCP
 * server; they add its URL to Claude Desktop, Cursor, Cline, or their own agent
 * and call its tools. Building a tool-runner inside Dolphin would mean
 * inventing argument forms and result rendering for tools it cannot anticipate,
 * to reproduce something the reader's own client already does well.
 *
 * Dolphin is a platform for DISCOVERING agents. Discovery ends when the reader
 * has the thing they came for, and for an MCP agent that thing is the endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COPIED IS THE ENDPOINT THE PROBE PROVED
 * ---------------------------------------------------------------------------
 * `services[0].endpoint` is not the URL the publisher advertised. It is the one
 * convex/lib/probe.ts completed an MCP `initialize` handshake against and then
 * read a real `tools/list` from - see the schema note on `agents.endpoint` for
 * why those differ across most of this catalog, and why posting to the
 * advertised one frequently 404s.
 *
 * That is the whole value Dolphin adds here, and it is worth being precise
 * about in the copy: it verified the server ANSWERS and publishes tools. It has
 * not reviewed what those tools do, and it must not imply it has. An MCP
 * endpoint is a URL a stranger published, and the reader is about to give their
 * own agent permission to call it.
 */

/** A config key a human will recognise in their own file. */
function configKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "agent";
}

/**
 * The `mcpServers` shape, which is what the common clients read.
 *
 * Offered as a convenience, and the copy says clients differ rather than
 * claiming this drops into all of them - the exact key and whether a remote
 * server needs a transport hint is not uniform across clients, and asserting
 * otherwise would be inventing a fact about someone else's software. The
 * endpoint above it is the part that is unambiguously correct, which is why it
 * is the primary control and this is the secondary one.
 */
function configSnippet(name: string, endpoint: string): string {
  return JSON.stringify(
    { mcpServers: { [configKey(name)]: { url: endpoint } } },
    null,
    2,
  );
}

export function McpConnect({ agent }: { agent: Agent }) {
  const endpoint = agent.services[0]?.endpoint ?? null;
  const [copied, setCopied] = useState<"endpoint" | "config" | null>(null);

  if (!endpoint) return null;

  const copy = async (value: string, which: "endpoint" | "config") => {
    await Clipboard.setStringAsync(value);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(which);
  };

  const toolCount = agent.skills.length;

  return (
    <View className="mt-3 gap-3">
      <View>
        <Text
          className="text-[11px] font-bold uppercase tracking-[0.8px]"
          style={{ color: colors.faint }}
        >
          Endpoint
        </Text>
        <PressableScale
          accessibilityHint="Copies the endpoint to your clipboard"
          accessibilityLabel="Copy endpoint"
          accessibilityRole="button"
          onPress={() => void copy(endpoint, "endpoint")}
          containerStyle={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderRadius: radii.small,
            borderWidth: 1,
            flexDirection: "row",
            gap: 10,
            marginTop: 6,
            paddingHorizontal: 12,
            paddingVertical: 11,
          }}
        >
          <Text
            className="flex-1 text-[12px]"
            ellipsizeMode="middle"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {endpoint}
          </Text>
          <CategoryGlyph
            color={copied === "endpoint" ? colors.success : colors.goldDark}
            name={copied === "endpoint" ? "check" : "copy"}
            size={15}
          />
        </PressableScale>
      </View>

      <Text className="text-[12px] leading-[18px]" style={{ color: colors.muted }}>
        Add this to your MCP client — Claude Desktop, Cursor, Cline, or your own
        agent — and its{" "}
        {toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "tools"}{" "}
        become available to it.
      </Text>

      <PressableScale
        accessibilityLabel="Copy config snippet"
        accessibilityRole="button"
        onPress={() => void copy(configSnippet(agent.name, endpoint), "config")}
        containerStyle={{
          alignItems: "center",
          alignSelf: "flex-start",
          flexDirection: "row",
          gap: 7,
        }}
      >
        <CategoryGlyph
          color={copied === "config" ? colors.success : colors.goldDark}
          name={copied === "config" ? "check" : "copy"}
          size={14}
        />
        <Text className="text-[12px] font-bold" style={{ color: colors.goldDark }}>
          {copied === "config" ? "Config copied" : "Copy config snippet"}
        </Text>
      </PressableScale>

      {/*
       * The one thing that must not be softened. Dolphin verified the server
       * answers; it did not review the tools, and the reader is about to let
       * their own agent call them.
       */}
      <Text className="text-[11px] leading-[16px]" style={{ color: colors.faint }}>
        Dolphin confirmed this server answers and lists its tools. It has not
        reviewed what those tools do — connect it the way you would any server
        someone else runs.
      </Text>
    </View>
  );
}
