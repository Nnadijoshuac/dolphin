import { Modal, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import type { AgentProtocol } from "@/hooks/use-agents";

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  protocol: AgentProtocol | null;
  onSelectProtocol: (protocol: AgentProtocol | null) => void;
}

/**
 * FilterModal
 *
 * A minimalist, serene centered modal for choosing agent kind:
 * All Agents, Hire, or Tools. 1 tap selects and applies cleanly.
 */
export function FilterModal({
  visible,
  onClose,
  protocol,
  onSelectProtocol,
}: FilterModalProps) {
  if (!visible) return null;

  const options = [
    {
      value: null,
      title: "All agents",
      desc: "Everything verified across protocols",
      glyph: "agents" as const,
    },
    {
      value: "a2a" as const,
      title: "Hire",
      desc: "Paid tasks · ERC-8183 escrow",
      glyph: "dollar" as const,
    },
    {
      value: "mcp" as const,
      title: "Tools",
      desc: "Free tools · Call directly via MCP",
      glyph: "spanner" as const,
    },
  ];

  const handleSelect = (val: AgentProtocol | null) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectProtocol(val);
    onClose();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View
        className="flex-1 justify-center items-center px-6"
        style={{ backgroundColor: colors.overlay }}
      >
        <Pressable
          accessibilityLabel="Dismiss modal backdrop"
          className="absolute inset-0"
          onPress={onClose}
        />

        <View
          className="w-full rounded-3xl overflow-hidden"
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            ...shadows.card,
            maxWidth: 360,
          }}
        >
          {/* Header */}
          <View
            className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b"
            style={{ borderColor: colors.line, backgroundColor: colors.canvas }}
          >
            <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
              Filter by Kind
            </Text>

            <PressableScale
              accessibilityLabel="Close filter modal"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              containerStyle={{
                height: 30,
                width: 30,
                borderRadius: 15,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: "center",
                justifyContent: "center",
                ...shadows.subtle,
              }}
            >
              <CategoryGlyph color={colors.ink} name="close" size={13} strokeWidth={2.2} />
            </PressableScale>
          </View>

          {/* 3 Calm Selection Options */}
          <View className="p-4 gap-2.5">
            {options.map((opt) => {
              const isSelected = protocol === opt.value;
              return (
                <PressableScale
                  key={opt.title}
                  accessibilityLabel={opt.title}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => handleSelect(opt.value)}
                  containerStyle={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: radii.medium,
                    backgroundColor: isSelected ? colors.goldSoft : colors.surfaceSubtle,
                    borderColor: isSelected ? colors.gold : colors.line,
                    borderWidth: isSelected ? 1.5 : 1,
                    ...shadows.subtle,
                  }}
                >
                  <View
                    className="h-10 w-10 rounded-2xl items-center justify-center mr-3"
                    style={{
                      backgroundColor: isSelected ? colors.gold : colors.surface,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.goldBorder : colors.line,
                    }}
                  >
                    <CategoryGlyph
                      color={isSelected ? colors.ink : colors.muted}
                      name={opt.glyph}
                      size={18}
                    />
                  </View>

                  <View className="flex-1 mr-2">
                    <Text
                      className="text-[15px]"
                      style={{
                        color: colors.ink,
                        fontWeight: isSelected ? "700" : "600",
                      }}
                    >
                      {opt.title}
                    </Text>
                    <Text className="text-[12px] text-zinc-500 mt-0.5">
                      {opt.desc}
                    </Text>
                  </View>

                  {/* Radio indicator */}
                  <View
                    className="h-5 w-5 rounded-full items-center justify-center"
                    style={{
                      borderColor: isSelected ? colors.goldDark : colors.line,
                      borderWidth: isSelected ? 2 : 1.5,
                      backgroundColor: isSelected ? colors.gold : colors.surface,
                    }}
                  >
                    {isSelected ? (
                      <CategoryGlyph color={colors.ink} name="check" size={11} strokeWidth={2.5} />
                    ) : null}
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
