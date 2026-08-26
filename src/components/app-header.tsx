import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { BrandMark } from "@/components/brand-mark";
import { colors } from "@/constants/theme";

type AppHeaderProps = {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  compact?: boolean;
};

export function AppHeader({
  title = "Dolphin",
  eyebrow = "BNB Chain agents",
  action,
  compact = false,
}: AppHeaderProps) {
  return (
    <View className="mb-6 flex-row items-center justify-between pt-2">
      <View className="flex-row items-center gap-3">
        <BrandMark size={compact ? 32 : 38} />
        <View>
          <Text
            className={compact ? "text-[18px] font-bold" : "text-[22px] font-bold"}
            style={{ color: colors.ink, letterSpacing: -0.6 }}
          >
            {title}
          </Text>
          <Text
            className="mt-0.5 text-[10px] font-bold uppercase tracking-[1.5px]"
            style={{ color: colors.muted }}
          >
            {eyebrow}
          </Text>
        </View>
      </View>
      {action}
    </View>
  );
}

