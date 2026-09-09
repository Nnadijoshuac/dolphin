import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { DolphinLoader } from "@/components/dolphin-loader";
import { PressableScale } from "@/components/pressable-scale";
import { colors } from "@/constants/theme";
import type { DolphinToolCall, DolphinTurn } from "@/hooks/use-dolphin-conversation";

/**
 * One turn of the Dolphin conversation, with the agents it consulted.
 *
 * The web build of this is web/src/app/dolphin/dolphin-client.tsx and
 * web/src/components/dolphin-tool-calls.tsx. Same design, same information, in
 * React Native - kept deliberately parallel so a change to one is obviously
 * portable to the other. Two frontends against one backend is a documented
 * decision (Agent/DECISION-2026-09-08-two-frontends.md) whose one real cost is
 * drift.
 *
 * ---------------------------------------------------------------------------
 * THE CONSULTED-AGENTS BLOCK IS THE PRODUCT
 * ---------------------------------------------------------------------------
 * Everything else here is a chat interface, and chat interfaces are a
 * commodity. That block is what says Dolphin did not answer from its own
 * weights: it called these third-party agents, asked them these things, and got
 * these answers, in this many milliseconds.
 *
 * Every row comes from `dolphinToolCalls`, which convex/dolphin.ts writes
 * BEFORE each call and patches after. It is never parsed out of the model's
 * prose - the model is small and free and will claim to have consulted an agent
 * it never called. If the answer text and these rows disagree, these rows are
 * right.
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

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/**
 * The consulted agents' icons, overlapped and alternately tilted.
 *
 * Deduplicated by AGENT rather than by call: Dolphin frequently asks the same
 * agent twice in one turn, and four identical stacked icons would imply four
 * sources where there is one.
 */
function StackedIcons({ calls }: { calls: DolphinToolCall[] }) {
  const seen = new Set<string>();
  const unique = calls.filter((call) => {
    if (seen.has(call.agentKey)) return false;
    seen.add(call.agentKey);
    return true;
  });
  const shown = unique.slice(0, 5);

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((call, index) => (
        <View
          key={call.agentKey}
          style={{
            marginLeft: index === 0 ? 0 : -8,
            zIndex: index,
            transform: [{ rotate: shown.length > 1 ? (index % 2 === 0 ? "8deg" : "-8deg") : "0deg" }],
          }}
        >
          {/*
            The agent's own icon, not a generic glyph. `seed` produces the same
            deterministic fallback the catalog draws when a publisher serves no
            image, so a consulted agent looks here as it looks on its own card.
          */}
          <AgentIcon category="monitoring" seed={call.agentKey} size={26} />
        </View>
      ))}
      {unique.length > shown.length ? (
        <View
          style={{
            marginLeft: -8,
            width: 26,
            height: 26,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.goldMuted,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: "600", color: colors.inkSecondary }}>
            +{unique.length - shown.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ToolCallRow({ call, isLast }: { call: DolphinToolCall; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const failed = call.transportError !== null;
  const pending = call.latencyMs === null;

  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {/* Icon column with the connector line down to the next call. */}
      <View style={{ alignItems: "center" }}>
        <AgentIcon category="monitoring" seed={call.agentKey} size={26} />
        {!isLast ? (
          <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: colors.goldBorder }} />
        ) : null}
      </View>

      <View style={{ flex: 1, paddingBottom: 10 }}>
        <PressableScale
          accessibilityLabel={`Details of the call to ${call.agentName}`}
          onPress={() => {
            void Haptics.selectionAsync();
            setOpen((value) => !value);
          }}
          containerStyle={{ flexDirection: "row", alignItems: "center", gap: 5 }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink, flexShrink: 1 }}>
            {failed
              ? `Could not reach ${call.agentName}`
              : pending
                ? `Asking ${call.agentName}…`
                : `Asked ${call.agentName}`}
          </Text>
          {call.latencyMs !== null ? (
            <Text style={{ fontSize: 10.5, color: colors.inkSecondary }}>
              {call.latencyMs}ms
            </Text>
          ) : null}
          <CategoryGlyph
            color={colors.inkSecondary}
            name={open ? "chevron-left" : "chevron-right"}
            size={12}
            strokeWidth={2.4}
          />
        </PressableScale>

        <Text style={{ fontSize: 11, color: colors.inkSecondary, marginTop: 1 }}>
          {call.toolName.replace(/[_-]/g, " ")}
          {call.isError && !failed ? " · the agent reported an error" : ""}
        </Text>

        {open ? (
          <View
            style={{
              marginTop: 8,
              borderRadius: 12,
              backgroundColor: colors.goldMuted,
              padding: 11,
              gap: 10,
            }}
          >
            <View>
              <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.inkSecondary }}>
                Dolphin asked
              </Text>
              <Text
                selectable
                style={{
                  fontSize: 10.5,
                  lineHeight: 15,
                  color: colors.inkSecondary,
                  fontFamily: "monospace",
                  marginTop: 3,
                }}
              >
                {prettyJson(call.argumentsJson)}
              </Text>
            </View>

            <View>
              <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.inkSecondary }}>
                {failed ? "Why it failed" : `${call.agentName} answered`}
              </Text>
              {/*
                Verbatim, labelled as that agent's own words. An agent's output
                is its CLAIM, never an established outcome - a collectFees tool
                in this catalog once answered `note: "Fees collected"` when
                nothing had been collected.
              */}
              <Text
                selectable
                style={{
                  fontSize: 10.5,
                  lineHeight: 15,
                  color: colors.inkSecondary,
                  fontFamily: "monospace",
                  marginTop: 3,
                }}
              >
                {call.transportError ??
                  call.resultText ??
                  (pending ? "Still waiting…" : "No content returned.")}
              </Text>
            </View>

            <PressableScale
              onPress={() => {
                void Haptics.selectionAsync();
                router.push({ pathname: "/agent/[id]", params: { id: call.agentKey } });
              }}
              containerStyle={{ alignSelf: "flex-start" }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.goldDark }}>
                View {call.agentName} →
              </Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ConsultedAgents({ calls }: { calls: DolphinToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  const agentCount = new Set(calls.map((call) => call.agentKey)).size;
  const pending = calls.some((call) => call.latencyMs === null);

  return (
    <View style={{ marginTop: 6 }}>
      <PressableScale
        accessibilityLabel={`${agentCount} agents consulted`}
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen((value) => !value);
        }}
        containerStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 6,
        }}
      >
        <StackedIcons calls={calls} />
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.inkSecondary, flexShrink: 1 }}>
          {pending ? "Consulting" : "Consulted"} {agentCount} agent
          {agentCount > 1 ? "s" : ""} · {calls.length} call{calls.length > 1 ? "s" : ""}
        </Text>
        <CategoryGlyph
          color={colors.inkSecondary}
          name={open ? "chevron-left" : "chevron-right"}
          size={14}
          strokeWidth={2.4}
        />
      </PressableScale>

      {open ? (
        <View style={{ paddingTop: 4 }}>
          {calls.map((call, index) => (
            <ToolCallRow call={call} isLast={index === calls.length - 1} key={call.id} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Wallet icon avatar — same glyph as the tab bar wallet icon */
function UserAvatar() {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.goldBorder,
        backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
      }}
    >
      <CategoryGlyph color={colors.inkSecondary} name="wallet" size={16} strokeWidth={1.8} />
    </View>
  );
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Linkified content — agent names in the response become tappable links
 * to their marketplace pages.
 */
function LinkifiedContent({
  text,
  toolCalls,
}: {
  text: string;
  toolCalls: DolphinToolCall[];
}) {
  const router = useRouter();

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const call of toolCalls) {
      if (call.agentName && call.agentKey && !map.has(call.agentName)) {
        map.set(call.agentName, call.agentKey);
      }
    }
    return map;
  }, [toolCalls]);

  if (agentMap.size === 0) {
    return (
      <Text selectable style={{ fontSize: 14.5, lineHeight: 22, color: colors.ink }}>
        {text}
      </Text>
    );
  }

  const names = Array.from(agentMap.keys()).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${names.map(escapeRegex).join("|")})`, "g");
  const parts = text.split(pattern);

  return (
    <Text selectable style={{ fontSize: 14.5, lineHeight: 22, color: colors.ink }}>
      {parts.map((part, i) => {
        const agentKey = agentMap.get(part);
        if (agentKey) {
          return (
            <Text
              key={i}
              onPress={() => {
                void Haptics.selectionAsync();
                router.push({ pathname: "/agent/[id]", params: { id: agentKey } });
              }}
              style={{
                fontWeight: "700",
                color: colors.goldDark,
                textDecorationLine: "underline",
                textDecorationColor: `${colors.goldDark}55`,
              }}
            >
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

export function DolphinTurnView({
  turn,
}: {
  turn: DolphinTurn;
}) {
  if (turn.role === "user") {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          gap: 8,
          paddingVertical: 8,
        }}
      >
        <View
          style={{
            maxWidth: "80%",
            backgroundColor: colors.goldSoft,
            borderRadius: 18,
            borderBottomRightRadius: 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontSize: 14.5, lineHeight: 21, color: colors.ink }}>
            {turn.content}
          </Text>
        </View>
        <UserAvatar />
      </View>
    );
  }

  const working = turn.status === "thinking" || turn.status === "consulting";

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Loading state — the 3D motion rings */}
        {working && turn.content.length === 0 && turn.toolCalls.length === 0 ? (
          <DolphinLoader
            label={
              turn.status === "thinking"
                ? "Thinking…"
                : "Consulting agents…"
            }
          />
        ) : null}

        {/* Error state */}
        {turn.status === "error" ? (
          <View
            style={{
              backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
              borderRadius: 18,
              borderBottomLeftRadius: 6,
              paddingHorizontal: 14,
              paddingVertical: 11,
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink }}>
              {turn.errorReason ?? "Dolphin could not answer that."}
            </Text>
          </View>
        ) : null}

        {/* The answer bubble — with agent names hyperlinked */}
        {turn.content.length > 0 ? (
          <View
            style={{
              backgroundColor: colors.surfaceSubtle ?? colors.goldMuted,
              borderRadius: 18,
              borderBottomLeftRadius: 6,
              paddingHorizontal: 14,
              paddingVertical: 11,
            }}
          >
            <LinkifiedContent text={turn.content} toolCalls={turn.toolCalls} />
          </View>
        ) : null}

        {/* Working indicator while awaiting content after tool calls */}
        {working && turn.content.length === 0 && turn.toolCalls.length > 0 ? (
          <DolphinLoader label="Writing…" />
        ) : null}

        {/* Consulted agents — BELOW the response bubble */}
        <ConsultedAgents calls={turn.toolCalls} />

        {turn.status === "complete" && turn.completedAt !== null ? (
          <Text style={{ fontSize: 10, color: colors.inkSecondary, marginTop: 6, paddingLeft: 4 }}>
            {relativeTime(turn.completedAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
