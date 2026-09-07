import { useState } from "react";
import {
  Platform,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentDetail } from "@/components/agent-detail";
import { HireSheet } from "@/components/hire-sheet";
import { UseHintSheet } from "@/components/use-hint-sheet";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useAppStore } from "@/store/use-app-store";

/**
 * The Dolphin website. A shared link has to open somewhere a recipient can
 * actually follow without installing the app, and the site renders the same
 * agent from the same Convex catalog this screen reads.
 *
 * The path is `/agent/<tokenId>`, matching what web/ links to itself
 * (web/src/components/agent-card.tsx and web/src/app/page.tsx both build
 * `/agent/${agent.tokenId}`) - so a link shared from mobile resolves to exactly
 * the page the website would have linked to.
 */
const WEB_BASE_URL = "https://dolphinamp.vercel.app";

export default function AgentDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: agent, isLoading, isError } = useAgentDetail(id);
  const [hireOpen, setHireOpen] = useState(false);

  /*
   * The one-time hint, shown on arrival at an MCP agent rather than an A2A one.
   *
   * It explains the Use button, and only MCP agents have one - an A2A agent's
   * action is Hire, which is a word that already carries its own meaning. It is
   * derived rather than held in state so it cannot get out of step with the
   * store, and `hintClosedThisVisit` is what "Okay" sets: dismissed now,
   * offered again next time, which is the difference between the two buttons.
   */
  const hasDismissedUseHint = useAppStore((state) => state.hasDismissedUseHint);
  const dismissUseHint = useAppStore((state) => state.dismissUseHint);
  const [hintClosedThisVisit, setHintClosedThisVisit] = useState(false);
  const showUseHint =
    agent?.protocol === "mcp" && !hasDismissedUseHint && !hintClosedThisVisit;

  const previewHires = useAppStore((state) => state.previewHires);
  const isPreviewSaved = previewHires.some(
    (preview) =>
      preview.agentId === id || (agent && preview.agentId === agent.tokenId),
  );

  /**
   * Hiring is a sheet, not a destination.
   *
   * It used to push `/hire/[id]`, a whole screen the user navigated away to and
   * back from. Nothing about buying one job from one agent needs its own page -
   * a page implies a process, and this is a decision with a price attached. The
   * route is gone; see components/hire-sheet.tsx.
   */
  const handleAction = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPreviewSaved) {
      router.push({ pathname: "/manage/[id]", params: { id: id! } });
      return;
    }
    setHireOpen(true);
  };

  const handleShare = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!agent) return;

    const url = `${WEB_BASE_URL}/agent/${agent.tokenId}`;
    const message = `Check out ${agent.name} on Dolphin — ${agent.tagline}`;

    try {
      /*
       * The link is delivered differently per platform because Share.share
       * treats `url` differently per platform.
       *
       * Android has no `url` field at all - it is dropped, and a share carrying
       * only `message` would have gone out with no link in it. So the URL is
       * appended to the message there.
       *
       * iOS passes `url` as a distinct activity item, which is what lets
       * Messages, Mail and Safari render a rich link preview rather than raw
       * text. Appending it to `message` as well would put the address in the
       * sheet twice, so on iOS the message carries the words and `url` carries
       * the link.
       */
      await Share.share(
        Platform.OS === "ios"
          ? { title: agent.name, message, url }
          : { title: agent.name, message: `${message}\n\n${url}` },
      );
    } catch {
      // User cancelled or share unavailable
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/*
       * The app bar: back, the name, one action.
       *
       * It carried four controls - back, search, share and a category button -
       * three of them identical 38pt circles crowded against the right edge,
       * which is what made the top of this page read as a toolbar rather than a
       * header. Search is a permanent tab one gesture away; the category is on
       * the record below and did not warrant a control that looked exactly like
       * the two beside it while navigating somewhere else entirely.
       *
       * 40pt and a 20pt gutter, matching the page body's inset below, so the
       * back button sits on the same vertical line as the agent's icon.
       */}
      <View
        className="flex-row items-center gap-3 px-5 pb-2.5 pt-1"
        style={{ backgroundColor: colors.canvas }}
      >
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          containerStyle={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderRadius: 20,
            borderWidth: 1,
            height: 40,
            justifyContent: "center",
            width: 40,
          }}
        >
          <CategoryGlyph
            color={colors.ink}
            name="chevron-left"
            size={20}
            strokeWidth={2.2}
          />
        </PressableScale>

        <Text
          className="flex-1 text-[15px] font-bold tracking-[-0.2px]"
          ellipsizeMode="tail"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {agent?.name ?? "Agent"}
        </Text>

        <PressableScale
          accessibilityLabel="Share agent"
          accessibilityRole="button"
          onPress={handleShare}
          containerStyle={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderRadius: 20,
            borderWidth: 1,
            height: 40,
            justifyContent: "center",
            width: 40,
          }}
        >
          <CategoryGlyph color={colors.ink} name="share" size={18} />
        </PressableScale>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View className="px-5 py-20">
            <StatePanel
              body="Resolving ERC-8004 token identity and verifying contract parameters on BNB Smart Chain..."
              state="syncing"
              title="Loading Agent Specifications"
            />
          </View>
        ) : isError || !agent ? (
          <View className="px-5 py-20">
            <StatePanel
              body="Agent specifications could not be loaded from the registry."
              state="unavailable"
              title="Agent Not Found"
            />
          </View>
        ) : (
          <AgentDetail
            actionLabel={isPreviewSaved ? "Open saved agent" : "Hire this agent"}
            agent={agent}
            onHire={handleAction}
          />
        )}
      </ScrollView>

      <UseHintSheet
        onDismiss={() => setHintClosedThisVisit(true)}
        onNeverShowAgain={() => {
          setHintClosedThisVisit(true);
          dismissUseHint();
        }}
        visible={showUseHint}
      />

      {agent ? (
        <HireSheet
          agent={agent}
          onClose={() => setHireOpen(false)}
          visible={hireOpen}
        />
      ) : null}
    </SafeAreaView>
  );
}
