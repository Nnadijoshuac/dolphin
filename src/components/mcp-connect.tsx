import { useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { Agent } from "@/types/agent";

/**
 * The primary action on an MCP agent's page: take its endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE WHOLE ACTION
 * ---------------------------------------------------------------------------
 * An MCP agent is not commissioned, it is CONNECTED TO. Nobody hires an MCP
 * server; they put its URL into Claude Desktop, Cursor, Cline or their own
 * agent, and its tools become available there. Dolphin is a platform for
 * discovering agents, so for this kind of agent discovery ends the moment the
 * reader has the endpoint - and everything between arriving on the page and
 * holding it is friction.
 *
 * So it is one button. Not a card explaining the protocol, not an endpoint
 * printed for the reader to select by hand, not a config block they must
 * understand before they can act. Tap Use, the link is on the clipboard.
 *
 * The endpoint is still shown underneath, because a person about to paste a URL
 * into their own agent is entitled to see it first, and because it is the
 * evidence behind the claim. It is deliberately quiet: available to read,
 * impossible to mistake for the control.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COPIED IS THE ENDPOINT THE PROBE PROVED
 * ---------------------------------------------------------------------------
 * `services[0].endpoint` is not the URL the publisher advertised. It is the one
 * convex/lib/probe.ts completed an MCP `initialize` handshake against and then
 * read a real `tools/list` from. Those differ across most of this catalog - the
 * registered service is frequently a static discovery document whose directory
 * holds the endpoint, and posting to the document 404s. That resolution is the
 * value Dolphin adds, and it is why copying from here beats reading the
 * registry.
 *
 * The safety line is not softened: Dolphin verified the server ANSWERS. It has
 * not reviewed what its tools do, and the reader is about to give their own
 * agent permission to call them.
 */

export function McpUseButton({ agent }: { agent: Agent }) {
  const endpoint = agent.services[0]?.endpoint ?? null;
  const [copied, setCopied] = useState(false);

  if (!endpoint) return null;

  const handleUse = async () => {
    await Clipboard.setStringAsync(endpoint);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
  };

  const toolCount = agent.skills.length;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderRadius: radii.large,
        borderWidth: 1,
        padding: 16,
        ...shadows.subtle,
      }}
    >
      <View className="flex-row items-center justify-between mb-3.5">
        <View>
          <Text
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: colors.inkSecondary }}
          >
            Integration
          </Text>
          <Text
            className="text-[18px] font-black mt-0.5"
            style={{ color: colors.ink }}
          >
            Free to Connect
          </Text>
        </View>
        <View
          className="flex-row items-center gap-1.5 px-3 py-1 rounded-full"
          style={{
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.line,
            borderWidth: 1,
          }}
        >
          <CategoryGlyph color={colors.inkSecondary} name="layers" size={12} strokeWidth={2.4} />
          <Text className="text-[11.5px] font-bold" style={{ color: colors.inkSecondary }}>
            {toolCount > 0 ? `${toolCount} MCP ${toolCount === 1 ? "Tool" : "Tools"}` : "MCP Server"}
          </Text>
        </View>
      </View>

      <PressableScale
        accessibilityHint="Copies this agent's MCP endpoint to your clipboard"
        accessibilityLabel={copied ? "Endpoint copied" : "Use MCP Agent"}
        accessibilityRole="button"
        onPress={() => void handleUse()}
        containerStyle={{
          alignItems: "center",
          backgroundColor: copied ? colors.mint : colors.gold,
          borderRadius: radii.pill,
          flexDirection: "row",
          gap: 8,
          height: 52,
          justifyContent: "center",
          ...(copied ? {} : shadows.goldGlow),
        }}
      >
        <CategoryGlyph
          color={colors.ink}
          name={copied ? "check" : "copy"}
          size={16}
          strokeWidth={2.4}
        />
        <Text
          className="text-[16px] font-bold tracking-[-0.2px]"
          style={{ color: colors.ink }}
        >
          {copied ? "Endpoint Copied" : "Copy MCP Endpoint"}
        </Text>
      </PressableScale>

      <Text
        className="mt-2.5 text-center text-[11.5px]"
        style={{ color: colors.inkSecondary }}
      >
        {copied
          ? "Ready to paste into Claude Desktop, Cursor, or Cline"
          : "Paste directly into Claude Desktop, Cursor, Cline, or your AI client"}
      </Text>

      {/* The verified endpoint box */}
      <View
        className="mt-3.5 flex-row items-center justify-between px-3 py-2 rounded-xl"
        style={{
          backgroundColor: colors.surfaceSubtle,
          borderColor: colors.lineLight,
          borderWidth: 1,
        }}
      >
        <Text
          className="text-[11px] font-mono flex-1 mr-2"
          ellipsizeMode="middle"
          numberOfLines={1}
          style={{ color: colors.inkSecondary }}
        >
          {endpoint}
        </Text>
        <CategoryGlyph color={colors.inkSecondary} name="copy" size={12} strokeWidth={2} />
      </View>

      <Text
        className="mt-2 text-center text-[10.5px] leading-[15px]"
        style={{ color: colors.inkSecondary }}
      >
        Dolphin confirmed this server answers and lists tools · Verified live
      </Text>
    </View>
  );
}
