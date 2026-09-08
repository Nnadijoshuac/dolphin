import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";
import { DolphinTurnView } from "@/components/dolphin-transcript";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import {
  useDolphinChat,
  useDolphinConversation,
} from "@/hooks/use-dolphin-conversation";

/**
 * DOLPHIN - the in-app agent.
 *
 * See Agent/DOLPHIN-AGENT-SCOPE.md for what this is and why it exists. The
 * short version: 26 of the 28 live agents in this catalog speak MCP and can
 * never be hired through the ERC-8183 path, so the marketplace apparatus
 * reaches 2 of 28. They publish 226 working tools. This screen is how a phone
 * user consumes them.
 *
 * The interface deliberately copies the shape of a familiar AI chat so nobody
 * has to learn anything. What is NOT generic is the citation rows under each
 * answer - see components/dolphin-transcript.tsx.
 */

/**
 * The empty state has to TEACH, not just sit there.
 *
 * project-scope.md §11 requires that someone who has never heard of BNB Agent
 * Studio can use this. A blank chat box is a dead end for that person - they do
 * not know what an agent is, let alone what to ask one.
 *
 * These also carry a second job: they are the prompts to pre-run before a demo,
 * so the obvious path is also the cached one and costs no free-tier model
 * calls. Change them and that caching goes with them.
 */
const SUGGESTIONS = [
  "What yield opportunities are on BNB Chain right now?",
  "Which agents can watch a lending position for me?",
  "Find me an agent that trades on a price ladder",
  "What can the agents in this marketplace actually do?",
];

export default function DolphinScreen() {
  const params = useLocalSearchParams<{ agentKey?: string }>();
  const seedAgentKey = typeof params.agentKey === "string" ? params.agentKey : null;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const { conversationKey, send, reset, isSending, sendError } =
    useDolphinChat(seedAgentKey);
  const { turns } = useDolphinConversation(conversationKey);

  const submit = useCallback(
    (text: string) => {
      if (text.trim().length === 0 || isSending) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDraft("");
      void send(text);
    },
    [isSending, send],
  );

  const isEmpty = turns.length === 0;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 20,
          paddingBottom: 12,
        }}
      >
        <BrandMark size={24} />
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "800", color: colors.ink }}>
          Dolphin
        </Text>
        {!isEmpty ? (
          <PressableScale
            accessibilityLabel="Start a new conversation"
            onPress={() => {
              void Haptics.selectionAsync();
              reset();
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.goldDark }}>
              New
            </Text>
          </PressableScale>
        ) : null}
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
          {isEmpty ? (
            <View style={{ paddingTop: 40 }}>
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: "800",
                  color: colors.ink,
                  marginBottom: 8,
                }}
              >
                Ask the marketplace
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  color: colors.inkSecondary,
                  marginBottom: 24,
                }}
              >
                Dolphin answers by calling the agents listed here and showing you
                which ones it asked. It never makes a number up — if the agents it
                can reach do not know, it says so.
              </Text>

              {SUGGESTIONS.map((suggestion) => (
                <PressableScale
                  key={suggestion}
                  onPress={() => submit(suggestion)}
                  containerStyle={{
                    borderWidth: 1,
                    borderColor: colors.goldBorder,
                    backgroundColor: colors.goldMuted,
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 14, color: colors.ink }}>{suggestion}</Text>
                </PressableScale>
              ))}
            </View>
          ) : (
            turns.map((turn) => <DolphinTurnView key={turn.id} turn={turn} />)
          )}

          {/*
            Only reached when the ACTION itself failed - a dropped connection.
            Failures inside a turn are written onto the assistant message and
            render in the transcript where the question was asked.
          */}
          {sendError ? (
            <Text style={{ fontSize: 13, color: "#C0564E", marginTop: 8 }}>
              {sendError}
            </Text>
          ) : null}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 10,
            paddingHorizontal: 20,
            paddingTop: 8,
            // Clears the floating island, which hides itself on keyboard show.
            paddingBottom: 96,
          }}
        >
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="Ask about an agent, a position, a yield…"
            placeholderTextColor="#9A9C96"
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 46,
              borderWidth: 1,
              borderColor: colors.goldBorder,
              backgroundColor: "#FFFFFF",
              borderRadius: 23,
              paddingHorizontal: 16,
              paddingTop: 13,
              paddingBottom: 13,
              fontSize: 15,
              color: colors.ink,
            }}
            value={draft}
          />
          <PressableScale
            accessibilityLabel="Send"
            onPress={() => submit(draft)}
            containerStyle={{
              width: 46,
              height: 46,
              borderRadius: 23,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                draft.trim().length > 0 && !isSending ? colors.gold : colors.goldBorder,
            }}
          >
            <Text style={{ fontSize: 18, color: colors.ink }}>↑</Text>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
