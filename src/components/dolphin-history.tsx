import { Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import type { ChatHistoryEntry } from "@/store/use-app-store";

function historyTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

type HistoryProps = {
  activeKey: string | null;
  entries: ChatHistoryEntry[];
  onClear: () => void;
  onClose?: () => void;
  onNew: () => void;
  onOpen: (conversationKey: string) => void;
  onRemove: (conversationKey: string) => void;
};

export function DolphinHistoryPanel({
  activeKey,
  entries,
  onClear,
  onClose,
  onNew,
  onOpen,
  onRemove,
}: HistoryProps) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 16,
        borderLeftWidth: 1,
        borderLeftColor: "#E2E8F0",
        backgroundColor: "rgba(255,255,255,0.94)",
      }}
    >
      <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0F172A",
          }}
        >
          <CategoryGlyph color="#FFFFFF" name="clock" size={17} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A" }}>
            Chat history
          </Text>
          <Text style={{ marginTop: 1, fontSize: 10.5, color: "#64748B" }}>
            Saved on this device
          </Text>
        </View>
        {onClose ? (
          <PressableScale
            accessibilityLabel="Close chat history"
            containerStyle={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={onClose}
          >
            <CategoryGlyph color="#475569" name="close" size={18} strokeWidth={2} />
          </PressableScale>
        ) : null}
      </View>

      <PressableScale
        containerStyle={{
          minHeight: 46,
          marginTop: 12,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          backgroundColor: "#0F172A",
        }}
        onPress={onNew}
      >
        <Text style={{ fontSize: 18, lineHeight: 20, color: "#FFFFFF" }}>+</Text>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFFFFF" }}>
          New conversation
        </Text>
      </PressableScale>

      <ScrollView
        contentContainerStyle={{ paddingTop: 18, paddingBottom: 12, gap: 6 }}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, minHeight: 0 }}
      >
        {entries.length === 0 ? (
          <View
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: "#CBD5E1",
              borderRadius: 18,
              padding: 16,
              backgroundColor: "rgba(255,255,255,0.58)",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#1E293B" }}>
              No saved chats yet
            </Text>
            <Text style={{ marginTop: 4, fontSize: 12, lineHeight: 18, color: "#64748B" }}>
              Your first question will appear here automatically.
            </Text>
          </View>
        ) : (
          entries.map((entry) => {
            const active = entry.conversationKey === activeKey;
            return (
              <View
                key={entry.conversationKey}
                style={{
                  minHeight: 58,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  padding: 4,
                  borderRadius: 16,
                  borderWidth: active ? 1 : 0,
                  borderColor: "#A7F3D0",
                  backgroundColor: active ? "#ECFDF5" : "transparent",
                }}
              >
                <PressableScale
                  containerStyle={{ paddingHorizontal: 10, paddingVertical: 7 }}
                  onPress={() => onOpen(entry.conversationKey)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 13, fontWeight: "600", color: "#0F172A" }}
                  >
                    {entry.title}
                  </Text>
                  <Text style={{ marginTop: 3, fontSize: 10.5, color: "#64748B" }}>
                    {historyTime(entry.updatedAt)}
                  </Text>
                </PressableScale>
                <PressableScale
                  accessibilityLabel={`Remove ${entry.title} from history`}
                  containerStyle={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onPress={() => onRemove(entry.conversationKey)}
                >
                  <CategoryGlyph color="#94A3B8" name="close" size={14} strokeWidth={2} />
                </PressableScale>
              </View>
            );
          })
        )}
      </ScrollView>

      {entries.length > 0 ? (
        <PressableScale containerStyle={{ alignSelf: "flex-start", padding: 8 }} onPress={onClear}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#64748B" }}>
            Clear local history
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function DolphinHistoryDrawer({ visible, ...props }: HistoryProps & { visible: boolean }) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: "rgba(15,23,42,0.25)" }}>
        <PressableScale
          accessibilityLabel="Close chat history"
          onPress={props.onClose}
          style={{ flex: 1 }}
        />
        <SafeAreaView
          edges={["top", "right", "bottom"]}
          style={{ width: "86%", maxWidth: 340, backgroundColor: colors.surface }}
        >
          <DolphinHistoryPanel {...props} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
