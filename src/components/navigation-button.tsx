import { Text } from "react-native";

import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";

type NavigationButtonProps = {
  label?: string;
  onPress: () => void;
  kind?: "back" | "close";
};

export function NavigationButton({
  label,
  onPress,
  kind = "back",
}: NavigationButtonProps) {
  const glyph = kind === "back" ? "‹" : "×";

  return (
    <PressableScale
      accessibilityLabel={label ?? (kind === "back" ? "Go back" : "Close")}
      accessibilityRole="button"
      onPress={onPress}
      pressedScale={0.94}
      containerStyle={{
        minWidth: label ? 88 : 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: label ? 13 : 0,
        ...shadows.card,
      }}
    >
      <Text style={{ color: colors.ink, fontSize: label ? 13 : 27, fontWeight: "700" }}>
        {label ?? glyph}
      </Text>
    </PressableScale>
  );
}

