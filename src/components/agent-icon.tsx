import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { CategoryGlyph } from "@/components/category-glyph";
import { colors } from "@/constants/theme";
import type { AgentCategory } from "@/types/agent";

const categoryBackgrounds: Record<AgentCategory, string> = {
  monitoring: "#F5F3EB",
  rebalancing: "#EAF1FB",
  "grid-trading": "#FAF5E6",
  "health-factor": "#F9F3F0",
  yield: "#F0F7F2",
  trading: "#F4F0FA",
};

const categoryIconColors: Record<AgentCategory, string> = {
  monitoring: colors.ink,
  rebalancing: colors.ink,
  "grid-trading": colors.ink,
  "health-factor": colors.ink,
  yield: colors.ink,
  trading: colors.ink,
};

/**
 * The generated tier: a deterministic DiceBear avatar for an agent that
 * published no icon of its own.
 *
 * NOTHING IS STORED. This is a URL built from the seed the backend already
 * sends, rendered like any other remote image. The previous pipeline generated
 * the same avatar server-side and wrote the SVG bytes into Convex file storage
 * - a redundant write of a pure function of the seed, repeated per agent,
 * against a table that had accumulated 6,038 rows with no listed agent behind
 * them. `convex/schema.ts` says `iconUrl` is "a URL, NEVER a blob, and never a
 * stored DiceBear render"; this is the client half of that contract.
 *
 * MIRRORED BY HAND in web/src/components/agent-icon.tsx. Same style, same
 * seeding rule, so one agent renders the same face on both products. Edit both
 * in one change.
 *
 * `bottts-neutral` is the robot style this app already uses for the account
 * that acts on a person's behalf (see WalletAvatar), which makes it the
 * consistent mark for an agent rather than a second visual vocabulary.
 */
const DICEBEAR_STYLE = "bottts-neutral";

function dicebearUri(seed: string): string {
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(seed)}`;
}

type AgentIconProps = {
  category: AgentCategory;
  uri?: string | null;
  /**
   * `agent.iconSeed` - the backend sends it on every agent precisely so this
   * fallback can exist without the client knowing that a tokenId happens to be
   * the seed. Omitted only where a call site genuinely has no agent resolved,
   * in which case the category mark is still drawn.
   */
  seed?: string | null;
  size?: number;
};

export function AgentIcon({ category, uri, seed, size = 60 }: AgentIconProps) {
  /**
   * URLs that have already failed to load, so each tier is tried once and the
   * component falls through rather than retrying a dead image forever.
   *
   * This matters more since the rebuild than it did before: `iconUrl` is now
   * whatever URL the publisher registered, not bytes Dolphin cached, so a
   * publisher whose image 404s used to leave a blank square where an agent
   * should be.
   */
  const [failed, setFailed] = useState<readonly string[]>([]);

  const borderRadius = Math.round(size * 0.32);
  const shell = {
    width: size,
    height: size,
    borderRadius,
    backgroundColor: categoryBackgrounds[category] ?? "#F5F3EB",
    borderWidth: 1,
    borderColor: "#EFECE4",
    overflow: "hidden" as const,
  };

  // Publisher icon first, then the generated one. Both are skipped once they
  // have failed, which is what makes this a fall-through and not a loop.
  const source =
    [uri, seed ? dicebearUri(seed) : null].find(
      (candidate): candidate is string => Boolean(candidate) && !failed.includes(candidate!),
    ) ?? null;

  if (source) {
    return (
      <Image
        accessibilityLabel={`${category} agent icon`}
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => {
          setFailed((previous) =>
            previous.includes(source) ? previous : [...previous, source],
          );
        }}
        source={{ uri: source }}
        style={shell}
        transition={180}
      />
    );
  }

  // No icon, no seed, or both failed: the category mark, as before.
  return (
    <View className="items-center justify-center relative" style={shell}>
      <CategoryGlyph
        color={categoryIconColors[category] ?? colors.ink}
        name={category}
        size={Math.round(size * 0.44)}
      />
      {/* Little gold accent dot */}
      <View
        className="absolute h-2 w-2 rounded-full"
        style={{
          backgroundColor: colors.gold,
          top: size * 0.15,
          right: size * 0.15,
        }}
      />
    </View>
  );
}
