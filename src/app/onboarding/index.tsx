import { useState, useRef } from "react";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

interface Slide {
  id: string;
  glyph: "discover" | "grid-trading" | "wallet" | "agents";
  badge: string;
  title: string;
  subtitle: string;
  points: { title: string; desc: string }[];
}

const slides: Slide[] = [
  {
    id: "1",
    glyph: "discover",
    badge: "BNB Smart Chain · ERC-8004",
    title: "AI agents, clearly sourced",
    subtitle:
      "Discover agents published under ERC-8004, with identity and evidence kept separate from publisher claims.",
    points: [
      {
        title: "Registry identity",
        desc: "A BSC token can identify an agent and its publisher. It does not prove the advertised service works.",
      },
      {
        title: "Evidence before claims",
        desc: "Missing performance, reputation, or activity stays labeled syncing or unavailable—never filled with demo numbers.",
      },
    ],
  },
  {
    id: "2",
    glyph: "grid-trading",
    badge: "Four Core Categories",
    title: "Find the right evidence",
    subtitle:
      "Monitoring, grid trading, health factor, and yield each need different data before you can make an informed call.",
    points: [
      {
        title: "Monitoring & health factor",
        desc: "Review published assets, alert history, lending risk, and response evidence when a source provides it.",
      },
      {
        title: "Grid trading & yield",
        desc: "Separate protocol opportunities from an agent’s own audited track record and authorization readiness.",
      },
    ],
  },
  {
    id: "3",
    glyph: "wallet",
    badge: "Security & Control",
    title: "Control starts with honesty",
    subtitle:
      "Dolphin shows what can run today, what still needs integration, and what a saved preview actually does.",
    points: [
      {
        title: "Read-only first",
        desc: "A monitoring service can observe a public address without signing authority. Saving a preview does not start that service.",
      },
      {
        title: "Actions stay unavailable for now",
        desc: "The tested Altana SDK cannot use this app’s WalletConnect signer. Dolphin will never ask for your private key as a workaround.",
      },
    ],
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth, 520);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const setHasCompletedOnboarding = useAppStore(
    (state) => state.setHasCompletedOnboarding,
  );

  const handleNext = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
      setCurrentIndex(currentIndex + 1);
    } else {
      setHasCompletedOnboarding(true);
      router.replace("/(tabs)");
    }
  };

  const handleSkip = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHasCompletedOnboarding(true);
    router.replace("/(tabs)");
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / contentWidth);
    if (index !== currentIndex && index >= 0 && index < slides.length) {
      setCurrentIndex(index);
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{
        alignItems: "center",
        backgroundColor: colors.canvas,
        overflow: "hidden",
      }}
    >
      <View style={{ flex: 1, maxWidth: "100%", width: contentWidth }}>
      {/* Top Header with Skip button */}
      <View className="flex-row items-center justify-between px-6 pt-3">
        <View className="flex-row items-center gap-2">
          <View
            className="h-8 w-8 items-center justify-center rounded-xl bg-slate-900"
            style={{ ...shadows.card }}
          >
            <CategoryGlyph color="#FFFFFF" name="agents" size={18} />
          </View>
          <Text
            className="text-[17px] font-bold tracking-tight"
            style={{ color: colors.ink }}
          >
            Dolphin
          </Text>
        </View>
        {currentIndex < slides.length - 1 ? (
          <Button
            label="Skip"
            onPress={handleSkip}
            tone="ghost"
          />
        ) : null}
      </View>

      {/* Carousel */}
      <FlatList
        ref={flatListRef}
        data={slides}
        getItemLayout={(_, index) => ({
          index,
          length: contentWidth,
          offset: contentWidth * index,
        })}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View
            style={{ width: contentWidth }}
            className="flex-1 justify-between px-7 py-6"
          >
            <View className="mt-4">
              <View className="mb-4 inline-flex self-start rounded-full bg-slate-200/60 px-3.5 py-1.5">
                <Text
                  className="text-[11px] font-bold uppercase tracking-wider text-slate-700"
                >
                  {item.badge}
                </Text>
              </View>

              <Text
                className="text-[34px] font-extrabold tracking-[-1px] leading-[40px]"
                style={{ color: colors.ink }}
              >
                {item.title}
              </Text>
              <Text
                className="mt-3 text-[16px] leading-[23px]"
                style={{ color: colors.muted }}
              >
                {item.subtitle}
              </Text>

              <View className="mt-8 gap-4">
                {item.points.map((pt: { title: string; desc: string }) => (
                  <View
                    key={pt.title}
                    className="rounded-2xl border p-4"
                    style={{
                      backgroundColor: colors.surface,
                      borderColor: colors.line,
                      ...shadows.card,
                    }}
                  >
                    <Text
                      className="text-[15px] font-bold"
                      style={{ color: colors.ink }}
                    >
                      {pt.title}
                    </Text>
                    <Text
                      className="mt-1 text-[13px] leading-5"
                      style={{ color: colors.muted }}
                    >
                      {pt.desc}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
        style={{ maxWidth: "100%", width: contentWidth }}
      />

      {/* Bottom controls */}
      <View className="px-7 pb-8 pt-2">
        {/* Pagination Dots */}
        <View className="mb-6 flex-row justify-center gap-2">
          {slides.map((_, i) => (
            <View
              key={i}
              className={`h-2 rounded-full transition-all ${
                currentIndex === i
                  ? "w-7 bg-slate-950"
                  : "w-2 bg-slate-300"
              }`}
            />
          ))}
        </View>

        <Button
          label={
            currentIndex === slides.length - 1
              ? "Get Started"
              : "Continue"
          }
          onPress={handleNext}
          tone="primary"
        />
      </View>
      </View>
    </SafeAreaView>
  );
}
