import { Modal, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";

/**
 * The one-time hint that says what the Use button does.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS, AND WHY IT LEAVES
 * ---------------------------------------------------------------------------
 * "Use" is a verb, not an outcome. A reader arriving on an MCP agent's page for
 * the first time has no way to know the button puts a link on their clipboard
 * rather than running something, and the difference matters - one of those they
 * can undo by ignoring, the other they cannot.
 *
 * So it is said once, plainly, and then it is possible to never see it again.
 * A hint that reappears on every visit stops being help and becomes a toll:
 * "Okay" dismisses it for this visit, "Don't show again" writes
 * `hasDismissedUseHint` and it is gone for good.
 *
 * It is deliberately NOT a tutorial. One sentence, two buttons, no page of
 * protocol explanation - the reader came to get a link, and anything that is
 * not that is in their way.
 */
export function UseHintSheet({
  visible,
  onDismiss,
  onNeverShowAgain,
}: {
  visible: boolean;
  onDismiss: () => void;
  onNeverShowAgain: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: colors.overlay }}>
        <View
          className="px-6 pb-9 pt-5"
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            ...shadows.card,
          }}
        >
          <View
            className="mb-6 self-center rounded-full"
            style={{ backgroundColor: colors.line, height: 4, width: 40 }}
          />

          <View
            className="mb-4 h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: colors.goldSoft }}
          >
            <CategoryGlyph color={colors.goldDark} name="copy" size={22} strokeWidth={2.2} />
          </View>

          <Text
            className="text-[22px] font-bold tracking-[-0.5px]"
            style={{ color: colors.ink }}
          >
            Tap Use to copy the link
          </Text>
          <Text
            className="mt-2 text-[14px] leading-[21px]"
            style={{ color: colors.muted }}
          >
            This agent is free. Use puts its link on your clipboard — paste it
            into Claude Desktop, Cursor, or your own agent to give it these
            tools.
          </Text>

          <View className="mt-7 gap-2.5">
            <PressableScale
              accessibilityLabel="Okay"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDismiss();
              }}
              containerStyle={{
                alignItems: "center",
                backgroundColor: colors.gold,
                borderRadius: radii.pill,
                height: 52,
                justifyContent: "center",
                ...shadows.goldGlow,
              }}
            >
              <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                Okay
              </Text>
            </PressableScale>

            <PressableScale
              accessibilityLabel="Don't show again"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onNeverShowAgain();
              }}
              containerStyle={{
                alignItems: "center",
                height: 44,
                justifyContent: "center",
              }}
            >
              <Text className="text-[14px] font-semibold" style={{ color: colors.muted }}>
                Don&apos;t show again
              </Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}
