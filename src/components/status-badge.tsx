import { Text, View } from "react-native";

import { colors, radii } from "@/constants/theme";
import type { LiveMetricStatus } from "@/types/agent";

type BadgeTone = LiveMetricStatus | "indexed" | "preview" | "warning" | "neutral";

const tones: Record<BadgeTone, { background: string; foreground: string }> = {
  live: { background: colors.mint, foreground: colors.mintInk },
  stale: { background: colors.goldSoft, foreground: "#725500" },
  syncing: { background: colors.blue, foreground: colors.blueInk },
  unavailable: { background: colors.coral, foreground: colors.coralInk },
  indexed: { background: colors.lilac, foreground: colors.lilacInk },
  preview: { background: colors.goldSoft, foreground: "#725500" },
  warning: { background: colors.coral, foreground: colors.coralInk },
  neutral: { background: "#ECEAE4", foreground: colors.muted },
};

type StatusBadgeProps = {
  label: string;
  tone?: BadgeTone;
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const palette = tones[tone];

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: radii.pill,
        backgroundColor: palette.background,
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text
        style={{
          color: palette.foreground,
          fontSize: 10,
          fontWeight: "800",
          letterSpacing: 0.35,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

