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
    <View>
      {/* The tag, not a sentence. "Free to use" is the fact a reader needs
          before they decide, and it fits in two words. */}
      <View className="mb-3 flex-row items-center gap-2">
        <View
          className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
          style={{ backgroundColor: colors.mint }}
        >
          <CategoryGlyph color={colors.mintInk} name="check" size={12} strokeWidth={2.6} />
          <Text className="text-[12px] font-bold" style={{ color: colors.mintInk }}>
            Free to use
          </Text>
        </View>
        {toolCount > 0 ? (
          <Text className="text-[12px]" style={{ color: colors.muted }}>
            {toolCount} {toolCount === 1 ? "tool" : "tools"}
          </Text>
        ) : null}
      </View>

      <PressableScale
        accessibilityHint="Copies this agent's MCP endpoint to your clipboard"
        accessibilityLabel={copied ? "Link copied" : "Use this agent"}
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
          color={copied ? colors.mintInk : colors.ink}
          name={copied ? "check" : "copy"}
          size={17}
          strokeWidth={2.4}
        />
        <Text
          className="text-[15px] font-bold tracking-[-0.2px]"
          style={{ color: copied ? colors.mintInk : colors.ink }}
        >
          {copied ? "Link copied" : "Use"}
        </Text>
      </PressableScale>

      <Text
        className="mt-2.5 text-center text-[12px]"
        style={{ color: colors.muted }}
      >
        {copied
          ? "Paste it into Claude Desktop, Cursor, or your own agent."
          : "Copies this agent's link for your AI client."}
      </Text>

      {/* The evidence, quiet. Readable if wanted, never competing with the
          button above it. */}
      <Text
        className="mt-4 text-[11px] leading-[16px]"
        ellipsizeMode="middle"
        numberOfLines={1}
        style={{ color: colors.faint }}
      >
        {endpoint}
      </Text>
      <Text className="mt-1 text-[11px] leading-[16px]" style={{ color: colors.faint }}>
        Dolphin confirmed this server answers and lists its tools. It has not
        reviewed what those tools do.
      </Text>
    </View>
  );
}
