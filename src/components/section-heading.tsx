import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { colors } from "@/constants/theme";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
};

export function SectionHeading({ eyebrow, title, action }: SectionHeadingProps) {
  return (
    <View className="mb-4 flex-row items-end justify-between gap-4">
      <View className="flex-1">
        {eyebrow ? (
          <Text
            className="mb-1 text-[11px] font-bold uppercase tracking-[1.8px]"
            style={{ color: colors.muted }}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          className="text-[25px] font-bold tracking-[-0.8px]"
          style={{ color: colors.ink }}
        >
          {title}
        </Text>
      </View>
      {action}
    </View>
  );
}

