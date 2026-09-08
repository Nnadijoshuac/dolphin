import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { PressableScale } from "@/components/pressable-scale";
import { colors, radii } from "@/constants/theme";
import type { DolphinToolCall, DolphinTurn } from "@/hooks/use-dolphin-conversation";

/**
 * One turn of the Dolphin conversation, with the agents it consulted.
 *
 * ---------------------------------------------------------------------------
 * THE CITATION ROWS ARE THE POINT
 * ---------------------------------------------------------------------------
 * They are what separates this from a chatbot bolted onto a crypto app: visible
 * proof that real third-party agents were called, with the latency it took, and
 * a tap-through to the agent's own page.
 *
 * They come from `dolphinToolCalls`, which the ACTION writes before and after
 * each call - they are not parsed out of the model's prose. The model is small
 * and free and will claim to have consulted an agent it never called; rendering
 * its own account of its sources would be the fabricated-provenance failure of
 * AGENTS.md §5. If the answer text and these rows disagree, these rows are
 * right.
 *
 * The rows also make the chat a discovery surface: every consulted agent is a
 * tap away from its marketplace page, so the agent feeds the catalog rather
 * than competing with it.
 */

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function CitationRow({ call }: { call: DolphinToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  const pending = call.latencyMs === null;
  const failed = call.transportError !== null;

  return (
    <View
      style={{
        borderRadius: radii.small,
        borderWidth: 1,
        borderColor: failed ? "#E7D3D3" : colors.goldBorder,
        backgroundColor: failed ? "#FDF6F6" : colors.goldMuted,
        marginTop: 8,
        overflow: "hidden",
      }}
    >
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          setExpanded((value) => !value);
        }}
        containerStyle={{ padding: 12 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {pending ? (
            <ActivityIndicator size="small" color={colors.goldDark} />
          ) : (
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: failed ? "#C0564E" : colors.goldDark,
              }}
            />
          )}
          <Text style={{ flex: 1, fontSize: 12, fontWeight: "700", color: colors.ink }}>
            {pending ? "Consulting" : failed ? "Could not reach" : "Consulted"}{" "}
            {call.agentName}
          </Text>
          {call.latencyMs !== null ? (
            <Text style={{ fontSize: 11, color: colors.inkSecondary }}>
              {call.latencyMs}ms
            </Text>
          ) : null}
        </View>

        <Text style={{ fontSize: 11, color: colors.inkSecondary, marginTop: 3 }}>
          {call.toolName}
          {call.isError && !failed ? " — the agent reported an error" : ""}
        </Text>
      </PressableScale>

      {expanded ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          {/*
            Shown verbatim and labelled as the agent's own words. An agent's
            prose is its CLAIM, never an established outcome - a collectFees
            tool in this catalog once answered `note: "Fees collected"` when
            nothing had been collected.
          */}
          <Text style={{ fontSize: 11, color: colors.inkSecondary, fontWeight: "600" }}>
            {failed ? "Why it failed" : `What ${call.agentName} returned`}
          </Text>
          <Text
            selectable
            style={{
              fontSize: 11,
              lineHeight: 16,
              color: colors.inkSecondary,
              fontFamily: "monospace",
            }}
          >
            {call.transportError ?? call.resultText ?? "No content returned."}
          </Text>

          <PressableScale
            onPress={() => {
              void Haptics.selectionAsync();
              router.push(`/agent/${encodeURIComponent(call.agentKey)}`);
            }}
            containerStyle={{ alignSelf: "flex-start" }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.goldDark }}>
              View {call.agentName} →
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

export function DolphinTurnView({ turn }: { turn: DolphinTurn }) {
  if (turn.role === "user") {
    return (
      <View style={{ alignItems: "flex-end", marginBottom: 18 }}>
        <View
          style={{
            maxWidth: "88%",
            backgroundColor: colors.goldSoft,
            borderRadius: 18,
            borderTopRightRadius: 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontSize: 15, lineHeight: 21, color: colors.ink }}>
            {turn.content}
          </Text>
        </View>
      </View>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <View style={{ marginBottom: 22 }}>
      {working ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <ActivityIndicator size="small" color={colors.goldDark} />
          <Text style={{ fontSize: 13, color: colors.inkSecondary }}>
            {turn.status === "thinking"
              ? "Choosing which agents to ask…"
              : "Consulting agents…"}
          </Text>
        </View>
      ) : null}

      {/* Citations first while working, so progress is the visible thing. */}
      {turn.toolCalls.map((call) => (
        <CitationRow key={call.id} call={call} />
      ))}

      {turn.status === "error" ? (
        <View
          style={{
            marginTop: turn.toolCalls.length > 0 ? 12 : 0,
            padding: 14,
            borderRadius: 14,
            backgroundColor: "#FDF6F6",
            borderWidth: 1,
            borderColor: "#E7D3D3",
          }}
        >
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink }}>
            {turn.errorReason ?? "Dolphin could not answer that."}
          </Text>
        </View>
      ) : null}

      {turn.content.length > 0 ? (
        <Text
          selectable
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: colors.ink,
            marginTop: turn.toolCalls.length > 0 ? 14 : 0,
          }}
        >
          {turn.content}
        </Text>
      ) : null}

      {/*
        WHEN the answer was produced, always shown.
        A reused answer keeps its ORIGINAL completedAt (see promptHash on
        dolphinMessages), so a cached reply must not read as fresh. Live metrics
        restated as current when they were read an hour ago is the
        fabricated-liveness failure of AGENTS.md §5 wearing a cache as a
        disguise.
      */}
      {turn.status === "complete" && turn.completedAt !== null ? (
        <Text style={{ fontSize: 10, color: colors.inkSecondary, marginTop: 10 }}>
          Answered {relativeTime(turn.completedAt)}
          {turn.model ? ` · ${turn.model.split("/").pop()?.replace(":free", "")}` : ""}
        </Text>
      ) : null}
    </View>
  );
}
