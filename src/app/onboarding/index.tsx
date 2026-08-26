import { useState, useRef } from "react";
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

const { width } = Dimensions.get("window");

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
    title: "AI Agents on BNB Chain",
    subtitle:
      "Autonomous intelligences registered on-chain with verifiable identities, skills, and track records.",
    points: [
      {
        title: "Verifiable Identity",
        desc: "Each agent is minted on the ERC-8004 registry with audited skills and verifiable addresses.",
      },
      {
        title: "24/7 Autonomy",
        desc: "Agents execute algorithmic workflows, monitor feeds, and safeguard positions continuously.",
      },
    ],
  },
  {
    id: "2",
    glyph: "grid-trading",
    badge: "Four Core Categories",
    title: "Built for Every Need",
    subtitle:
      "Every category provides dedicated on-chain metrics and specialized execution tooling.",
    points: [
      {
        title: "Monitoring & Health Factor",
        desc: "Watch real-time risk, liquidation buffers, and market anomalies before they impact you.",
      },
      {
        title: "Grid Trading & Yield",
        desc: "Automate range trades on DEXes and compound DeFi yields across top BSC protocols.",
      },
    ],
  },
  {
    id: "3",
    glyph: "wallet",
    badge: "Security & Control",
    title: "Safe, Scoped Hiring",
    subtitle:
      "You always stay in control. Agents never receive your private key or unbounded custody.",
    points: [
      {
        title: "Zero-Risk Monitoring",
        desc: "Read-only agents watch public addresses without requiring wallet permissions or transactions.",
      },
      {
        title: "Bounded Spend Caps",
        desc: "Action agents operate strictly within preset spend limits and expire automatically.",
      },
    ],
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
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
    const index = Math.round(offsetX / width);
    if (index !== currentIndex && index >= 0 && index < slides.length) {
      setCurrentIndex(index);
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: colors.canvas }}
    >
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
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View style={{ width }} className="flex-1 justify-between px-7 py-6">
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
    </SafeAreaView>
  );
}
