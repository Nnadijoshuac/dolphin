import {
  ActivityIndicator,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { categoryLabel, categoryVisual } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import { useAgentList, useCategoryFacets } from "@/hooks/use-agents";
import { sortHireableFirst } from "@/services/hireability";

/**
 * ONE CATEGORY, PAGINATED.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED (2026-09-07)
 * ---------------------------------------------------------------------------
 * `useAgentsByCategory` fetched the whole catalog and filtered it in memory. It
 * is now `useAgentList({ category })`, an index range on
 * `by_status_category_rank` - cost is the page size, not the catalog size.
 *
 * The slug is no longer cast to a closed union with a "rebalancing" default.
 * Categories are open strings now, so an unrecognised slug is a real
 * possibility, and silently redirecting one to a different category would show
 * a user agents they did not ask for. It renders its own honest empty state.
 *
 * ---------------------------------------------------------------------------
 * THE REPUTATION SORT IS GONE, AND THAT IS A CORRECTNESS FIX
 * ---------------------------------------------------------------------------
 * It sorted the agents currently in memory by reputation. Under pagination that
 * means every "Show more" reshuffles the list under the reader, and page two is
 * sorted independently of page one - so an agent can appear twice and another
 * never appear at all.
 *
 * A cursor is a position in an index, so the ordering has to BE the index. The
 * backend's `rank` is that stored, indexed field. Re-adding a user-chosen sort
 * means adding an index for it, not sorting a page - which is a real feature
 * with a real cost, not something to fake locally.
 */
export default function CategoryDetailRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const categorySlug = (slug ?? "").trim();

  const { categories } = useCategoryFacets();
  const facet = categories.find((c) => c.slug === categorySlug);
  const label = facet?.label ?? categoryLabel(categorySlug);
  const visual = categoryVisual(categorySlug);

  const { agents, status, isLoading, loadMore, isEmpty } = useAgentList({
    category: categorySlug,
    enabled: categorySlug.length > 0,
  });

  // Hireable first, as a stable partition, so the backend's ranking survives
  // inside each half.
  const sortedAgents = sortHireableFirst(agents);

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <View
        className="flex-row items-center justify-between px-6 pt-2 pb-3 border-b"
        style={{ borderColor: colors.line }}
      >
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          containerStyle={{
            height: 38,
            width: 38,
            borderRadius: 19,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            alignItems: "center",
            justifyContent: "center",
            ...shadows.card,
          }}
        >
          <CategoryGlyph
            color={colors.ink}
            name="chevron-left"
            size={18}
            strokeWidth={2.2}
          />
        </PressableScale>

        <Text
          className="text-[16px] font-bold"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {label}
        </Text>

        <View className="h-9 w-9" />
      </View>

      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 60 }}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const nearBottom =
            layoutMeasurement.height + contentOffset.y >= contentSize.height - 600;
          if (nearBottom && status === "CanLoadMore") loadMore();
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View className="mt-5 p-5 rounded-2xl bg-slate-900" style={{ ...shadows.card }}>
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <CategoryGlyph color="#FFFFFF" name={categorySlug} size={24} />
            </View>
            <View className="flex-1">
              <Text className="text-[22px] font-extrabold text-white">{label}</Text>
              <Text className="mt-1 text-[13px] text-slate-300">
                {facet
                  ? `${facet.count} verified ${facet.count === 1 ? "agent" : "agents"} · ${visual.subtitle}`
                  : visual.subtitle}
              </Text>
            </View>
          </View>
        </View>

        <View className="mt-6">
          <SectionHeading title={`All ${label} agents`} />
        </View>

        {isLoading ? (
          <View className="py-12">
            <StatePanel
              body="Reading the agents Dolphin has verified in this category."
              state="syncing"
              title="Loading"
            />
          </View>
        ) : !isEmpty ? (
          <View className="mt-3 gap-4">
            {sortedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/agent/[id]",
                    params: { id: agent.tokenId },
                  });
                }}
              />
            ))}

            {status === "LoadingMore" ? (
              <View className="items-center py-6">
                <ActivityIndicator color={colors.goldDark} />
              </View>
            ) : null}

            {status === "CanLoadMore" ? (
              <PressableScale
                accessibilityLabel="Load more agents"
                accessibilityRole="button"
                onPress={() => loadMore()}
                containerStyle={{
                  alignItems: "center",
                  backgroundColor: colors.surface,
                  borderColor: colors.line,
                  borderRadius: 14,
                  borderWidth: 1,
                  paddingVertical: 14,
                }}
              >
                <Text className="text-[14px] font-semibold" style={{ color: colors.ink }}>
                  Show more
                </Text>
              </PressableScale>
            ) : null}
          </View>
        ) : (
          <View className="py-12">
            <StatePanel
              body={
                facet
                  ? "No agent in this category is answering its endpoint right now. One is relisted automatically as soon as a probe succeeds."
                  : `Dolphin has no category called "${categorySlug}". Categories come from the catalog itself, so this one either holds no verified agents or does not exist.`
              }
              state="unavailable"
              title="Nothing here yet"
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
