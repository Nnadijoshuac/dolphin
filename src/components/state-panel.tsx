import { ActivityIndicator, Text, View } from "react-native";

import { CategoryGlyph } from "@/components/category-glyph";
import { colors, radii } from "@/constants/theme";

type StatePanelProps = {
  title: string;
  body: string;
  state?: "syncing" | "unavailable" | "empty";
  compact?: boolean;
};

export function StatePanel({
  title,
  body,
  state = "empty",
  compact = false,
}: StatePanelProps) {
  return (
    <View
      className="items-center justify-center"
      style={{
        minHeight: compact ? 132 : 220,
        borderRadius: radii.large,
        borderColor: colors.line,
        borderWidth: 1,
        borderStyle: "dashed",
        backgroundColor: "rgba(255,255,255,0.58)",
        padding: 24,
      }}
    >
      {state === "syncing" ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <View
          className="items-center justify-center"
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: state === "unavailable" ? colors.coral : colors.goldSoft,
          }}
        >
          <CategoryGlyph name="agents" size={20} />
        </View>
      )}
      <Text
        className="mt-4 text-center text-[16px] font-bold"
        style={{ color: colors.ink }}
      >
        {title}
      </Text>
      <Text
        className="mt-2 max-w-[320px] text-center text-[13px] leading-5"
        style={{ color: colors.muted }}
      >
        {body}
      </Text>
    </View>
  );
}

