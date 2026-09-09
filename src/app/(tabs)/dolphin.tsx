import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { DolphinGridBackground } from "@/components/dolphin-grid-background";
import {
  DolphinHistoryDrawer,
  DolphinHistoryPanel,
} from "@/components/dolphin-history";
import { DolphinLoader } from "@/components/dolphin-loader";
import { DolphinTurnView } from "@/components/dolphin-transcript";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import {
  useDolphinChat,
  useDolphinConversation,
} from "@/hooks/use-dolphin-conversation";
import { useAppStore } from "@/store/use-app-store";

/**
 * Dolphin's chat surface. Conversation capability keys are cached only on the
 * current device; transcripts remain authoritative in Convex.
 */
export default function DolphinScreen() {
  const params = useLocalSearchParams<{ agentKey?: string }>();
  const seedAgentKey = typeof params.agentKey === "string" ? params.agentKey : null;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const { conversationKey, send, reset, openConversation, isSending, sendError } =
    useDolphinChat(seedAgentKey);
  const { exists, isLoading, title, turns, agentDirectory } =
    useDolphinConversation(conversationKey);
  const history = useAppStore((state) => state.chatHistory);
  const upsertHistory = useAppStore((state) => state.upsertChatHistory);
  const removeHistory = useAppStore((state) => state.removeChatHistory);
  const clearHistory = useAppStore((state) => state.clearChatHistory);

  useEffect(() => {
    if (!conversationKey || turns.length === 0) return;
    const firstQuestion = turns.find((turn) => turn.role === "user")?.content.trim();
    const newestTurn = turns[turns.length - 1];
    upsertHistory({
      conversationKey,
      title: title && title !== "New conversation" ? title : firstQuestion || "New conversation",
      updatedAt: newestTurn.completedAt ?? newestTurn.createdAt,
    });
  }, [conversationKey, title, turns, upsertHistory]);

  const submit = useCallback(
    (text: string) => {
      if (text.trim().length === 0 || isSending) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDraft("");
      void send(text);
    },
    [isSending, send],
  );

  const startNew = useCallback(() => {
    reset();
    setDraft("");
    setHistoryOpen(false);
    inputRef.current?.focus();
  }, [reset]);

  const openSavedConversation = useCallback(
    (conversationKeyToOpen: string) => {
      openConversation(conversationKeyToOpen);
      setDraft("");
      setHistoryOpen(false);
    },
    [openConversation],
  );

  const removeSavedConversation = useCallback(
    (conversationKeyToRemove: string) => {
      removeHistory(conversationKeyToRemove);
      if (conversationKeyToRemove === conversationKey) reset();
    },
    [conversationKey, removeHistory, reset],
  );

  const isEmpty = turns.length === 0;
  const historyProps = {
    activeKey: conversationKey,
    entries: history,
    onClear: clearHistory,
    onClose: () => setHistoryOpen(false),
    onNew: startNew,
    onOpen: openSavedConversation,
    onRemove: removeSavedConversation,
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <DolphinGridBackground />

      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              minHeight: 56,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
              backgroundColor: "rgba(251,249,244,0.72)",
            }}
          >
            <PressableScale
              accessibilityLabel="Back to Discover"
              containerStyle={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={() => {
                void Haptics.selectionAsync();
                router.back();
              }}
            >
              <CategoryGlyph color="#0F172A" name="chevron-left" size={20} strokeWidth={2.2} />
            </PressableScale>

            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <BrandMark size={20} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A" }}>
                Dolphin
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              {!isWide ? (
                <PressableScale
                  accessibilityLabel="Open chat history"
                  containerStyle={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onPress={() => setHistoryOpen(true)}
                >
                  <CategoryGlyph color="#475569" name="clock" size={18} strokeWidth={1.9} />
                </PressableScale>
              ) : null}
              {!isEmpty ? (
                <PressableScale onPress={startNew} containerStyle={{ padding: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#475569" }}>
                    New
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
            style={{ flex: 1 }}
          >
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              showsVerticalScrollIndicator={false}
            >
              {conversationKey && isLoading ? (
                <View style={{ alignItems: "center", paddingTop: "25%" }}>
                  <DolphinLoader label="Loading conversation…" />
                </View>
              ) : conversationKey && !exists ? (
                <View style={{ alignItems: "center", paddingTop: "25%", gap: 8 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A" }}>
                    Conversation unavailable
                  </Text>
                  <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center" }}>
                    This locally saved chat can no longer be opened.
                  </Text>
                </View>
              ) : isEmpty ? (
                <View style={{ alignItems: "center", paddingTop: "25%" }}>
                  <BrandMark size={48} />
                  <Text
                    style={{
                      marginTop: 16,
                      fontSize: 24,
                      fontWeight: "800",
                      color: "#0F172A",
                      textAlign: "center",
                    }}
                  >
                    Ask the marketplace
                  </Text>
                </View>
              ) : (
                turns.map((turn) => (
                  <DolphinTurnView
                    dynamicAgents={agentDirectory}
                    key={turn.id}
                    onSelectPrompt={(prompt) => submit(prompt)}
                    turn={turn}
                  />
                ))
              )}

              {sendError ? (
                <Text style={{ marginTop: 8, fontSize: 13, color: colors.danger }}>
                  {sendError}
                </Text>
              ) : null}
            </ScrollView>

            <View
              pointerEvents="box-none"
              style={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: isWide ? 20 : 92,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  padding: 8,
                  borderRadius: 26,
                  borderWidth: 1.2,
                  borderColor: "rgba(148,163,184,0.52)",
                  backgroundColor:
                    Platform.OS === "ios" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.96)",
                  boxShadow: "0 12px 38px rgba(15,23,42,0.12)",
                  overflow: "hidden",
                }}
              >
                <BlurView
                  intensity={92}
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { zIndex: 0 }]}
                  tint={
                    Platform.OS === "ios"
                      ? "systemThinMaterialLight"
                      : "systemChromeMaterialLight"
                  }
                />

                <TextInput
                  accessibilityLabel="Message Dolphin"
                  multiline
                  onChangeText={setDraft}
                  placeholder="Ask about an agent, a position, or a yield…"
                  placeholderTextColor="#94A3B8"
                  ref={inputRef}
                  underlineColorAndroid="transparent"
                  style={{
                    flex: 1,
                    maxHeight: 120,
                    minHeight: 38,
                    paddingHorizontal: 10,
                    paddingTop: 9,
                    paddingBottom: 9,
                    fontSize: 15,
                    color: "#0F172A",
                    position: "relative",
                    zIndex: 1,
                    ...(Platform.OS === "web"
                      ? ({
                          outline: "none",
                          outlineWidth: 0,
                          outlineStyle: "none",
                          outlineColor: "transparent",
                          boxShadow: "none",
                        } as object)
                      : null),
                  }}
                  value={draft}
                />
                <PressableScale
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: draft.trim().length === 0 || isSending }}
                  disabled={draft.trim().length === 0 || isSending}
                  containerStyle={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor:
                      draft.trim().length > 0 && !isSending ? "#0F172A" : "#CBD5E1",
                  }}
                  onPress={() => submit(draft)}
                  style={{ zIndex: 1 }}
                >
                  <Text style={{ fontSize: 17, fontWeight: "700", color: "#FFFFFF" }}>↑</Text>
                </PressableScale>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>

        {isWide ? (
          <View style={{ width: 304 }}>
            <DolphinHistoryPanel {...historyProps} onClose={undefined} />
          </View>
        ) : null}
      </View>

      {!isWide ? <DolphinHistoryDrawer {...historyProps} visible={historyOpen} /> : null}
    </SafeAreaView>
  );
}
