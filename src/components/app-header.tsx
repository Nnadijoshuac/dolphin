import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { BrandMark, BnbBadge } from "@/components/brand-mark";
import { colors } from "@/constants/theme";

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  showBnbBadge?: boolean;
  action?: ReactNode;
  compact?: boolean;
};

export function AppHeader({
  title = "Dolphin",
  subtitle = "ERC-8004 AI agent marketplace",
  showBnbBadge = true,
  action,
  compact = false,
}: AppHeaderProps) {
  return (
    <View className="flex-row items-center justify-between px-6 pt-3 pb-3">
      <View className="flex-row items-center gap-3">
        <BrandMark size={compact ? 32 : 38} />
        <View>
          <Text
            className="text-[17px] font-extrabold tracking-tight"
            style={{ color: colors.ink }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              className="text-[11px] font-medium tracking-tight"
              style={{ color: colors.muted }}
            >
              {subtitle}
            </Text>
          ) : null}
          {showBnbBadge ? (
            <View className="mt-0.5">
              <BnbBadge />
            </View>
          ) : null}
        </View>
      </View>
      {action}
    </View>
  );
}
