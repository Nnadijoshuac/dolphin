import { Text } from "react-native";

import { CategoryGlyph } from "@/components/category-glyph";
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
      {/*
        A drawn chevron rather than the "‹" / "×" text characters this used
        before. Those are typographic marks, not icons: their weight, size and
        vertical centring are decided by the font rather than by us, which is
        why the button read as misaligned and thin next to the drawn icons
        around it.
      */}
      {label ? (
        <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "700" }}>
          {label}
        </Text>
      ) : (
        <CategoryGlyph
          color={colors.ink}
          name={kind === "back" ? "chevron-left" : "close"}
          size={20}
          strokeWidth={2.2}
        />
      )}
    </PressableScale>
  );
}

