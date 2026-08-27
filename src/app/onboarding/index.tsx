import { useState, useRef } from "react";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark, BnbBadge } from "@/components/brand-mark";
import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth || 390, 480);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const setHasCompletedOnboarding = useAppStore(
    (state) => state.setHasCompletedOnboarding,
  );

  const goToSlide = (index: number) => {
    flatListRef.current?.scrollToIndex({ index, animated: true });
    setCurrentIndex(index);
  };

  const handleNext = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < 3) {
      goToSlide(currentIndex + 1);
    } else {
      setHasCompletedOnboarding(true);
      router.replace("/(tabs)");
    }
  };

  const handleBack = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex > 0) {
      goToSlide(currentIndex - 1);
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
    if (index !== currentIndex && index >= 0 && index <= 3) {
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
      <ConstellationBg opacity={0.35} />

      <View style={{ flex: 1, maxWidth: "100%", width: contentWidth }}>
        {/* Top Header */}
        <View className="flex-row items-center justify-between px-6 pt-3">
          <View className="flex-row items-center gap-2.5">
            <BrandMark size={28} />
            <View>
              <Text
                className="text-[15px] font-black uppercase tracking-[1.5px]"
                style={{ color: colors.ink }}
              >
                DOLPHIN
              </Text>
              <Text
                className="text-[9px] font-semibold uppercase tracking-[1px]"
                style={{ color: colors.muted }}
              >
                ERC-8004 AI AGENT MARKETPLACE
              </Text>
            </View>
          </View>
          {currentIndex < 3 ? (
            <PressableScale
              accessibilityLabel="Skip onboarding"
              accessibilityRole="button"
              onPress={handleSkip}
              containerStyle={{ paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <View className="flex-row items-center gap-1">
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: colors.muted }}
                >
                  Skip
                </Text>
                <CategoryGlyph color={colors.muted} name="chevron-right" size={12} />
              </View>
            </PressableScale>
          ) : null}
        </View>

        {/* Slides Carousel */}
        <FlatList
          ref={flatListRef}
          data={[0, 1, 2, 3]}
          getItemLayout={(_, index) => ({
            index,
            length: contentWidth,
            offset: contentWidth * index,
          })}
          keyExtractor={(item) => item.toString()}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
          renderItem={({ item: index }) => (
            <View
              style={{ width: contentWidth }}
              className="flex-1 justify-between px-6 py-4"
            >
              {/* SLIDE 1 */}
              {index === 0 ? (
                <View className="flex-1 justify-between">
                  <View className="items-center justify-center pt-2">
                    <View
                      className="items-center justify-center"
                      style={{ height: 260, width: "100%" }}
                    >
                      <Image
                        contentFit="contain"
                        source={require("../../../assets/images/onboarding-dolphin.png")}
                        style={{ height: "100%", width: "100%" }}
                      />
                    </View>
                  </View>

                  <View className="mb-4">
                    <View className="mb-2 self-start">
                      <BnbBadge />
                    </View>
                    <Text
                      className="text-[32px] font-extrabold tracking-[-1px] leading-[38px]"
                      style={{ color: colors.ink }}
                    >
                      AI agents,{"\n"}made understandable
                    </Text>
                    <Text
                      className="mt-3 text-[15px] leading-6"
                      style={{ color: colors.muted }}
                    >
                      Explore registered identities across monitoring, trading, risk,
                      and yield—with unavailable evidence labeled clearly.
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* SLIDE 2: Four ways agents help */}
              {index === 1 ? (
                <View className="flex-1 justify-between pt-2">
                  <View>
                    <View className="mb-1 self-start">
                      <Text
                        className="text-[11px] font-bold uppercase tracking-[1.5px]"
                        style={{ color: colors.goldDark }}
                      >
                        AI AGENTS FOR DEFI
                      </Text>
                    </View>
                    <Text
                      className="text-[28px] font-extrabold tracking-[-0.8px]"
                      style={{ color: colors.ink }}
                    >
                      Four ways{"\n"}agents can help
                    </Text>

                    {/* 2x2 Grid */}
                    <View className="mt-5 flex-row flex-wrap gap-3">
                      {/* Monitoring */}
                      <View
                        className="rounded-3xl border bg-white p-4"
                        style={{
                          borderColor: colors.line,
                          width: "48%",
                          ...shadows.subtle,
                        }}
                      >
                        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#F5F3EB]">
                          <CategoryGlyph name="monitoring" size={22} />
                        </View>
                        <Text
                          className="mt-3 text-[15px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          Monitoring
                        </Text>
                        <Text
                          className="mt-1 text-[12px] leading-4"
                          style={{ color: colors.muted }}
                        >
                          Watch wallets and markets
                        </Text>
                      </View>

                      {/* Grid Trading */}
                      <View
                        className="rounded-3xl border bg-white p-4"
                        style={{
                          borderColor: colors.line,
                          width: "48%",
                          ...shadows.subtle,
                        }}
                      >
                        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#FAF5E6]">
                          <CategoryGlyph name="grid-trading" size={22} />
                        </View>
                        <Text
                          className="mt-3 text-[15px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          Grid trading
                        </Text>
                        <Text
                          className="mt-1 text-[12px] leading-4"
                          style={{ color: colors.muted }}
                        >
                          Work inside a price range
                        </Text>
                      </View>

                      {/* Health Factor */}
                      <View
                        className="rounded-3xl border bg-white p-4"
                        style={{
                          borderColor: colors.line,
                          width: "48%",
                          ...shadows.subtle,
                        }}
                      >
                        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#F9F3F0]">
                          <CategoryGlyph name="health-factor" size={22} />
                        </View>
                        <Text
                          className="mt-3 text-[15px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          Health factor
                        </Text>
                        <Text
                          className="mt-1 text-[12px] leading-4"
                          style={{ color: colors.muted }}
                        >
                          Track borrowing risk
                        </Text>
                      </View>

                      {/* Yield */}
                      <View
                        className="rounded-3xl border bg-white p-4"
                        style={{
                          borderColor: colors.line,
                          width: "48%",
                          ...shadows.subtle,
                        }}
                      >
                        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#F0F7F2]">
                          <CategoryGlyph name="yield" size={22} />
                        </View>
                        <Text
                          className="mt-3 text-[15px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          Yield
                        </Text>
                        <Text
                          className="mt-1 text-[12px] leading-4"
                          style={{ color: colors.muted }}
                        >
                          Find earning opportunities
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* SLIDE 3: Know what you approve */}
              {index === 2 ? (
                <View className="flex-1 justify-between pt-1">
                  <View>
                    <View className="items-center justify-center">
                      <View style={{ height: 160, width: 160 }}>
                        <Image
                          contentFit="contain"
                          source={require("../../../assets/images/onboarding-shield.png")}
                          style={{ height: "100%", width: "100%" }}
                        />
                      </View>
                    </View>

                    <Text
                      className="mt-2 text-[26px] font-extrabold tracking-[-0.8px]"
                      style={{ color: colors.ink }}
                    >
                      Know what you approve
                    </Text>

                    <View className="mt-4 gap-2.5">
                      <View
                        className="flex-row items-center gap-3.5 rounded-2xl border bg-white p-3.5"
                        style={{ borderColor: colors.line, ...shadows.subtle }}
                      >
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#F5F3EB]">
                          <CategoryGlyph name="monitoring" size={18} />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-[14px] font-bold"
                            style={{ color: colors.ink }}
                          >
                            Read-only agents
                          </Text>
                          <Text
                            className="text-[12px]"
                            style={{ color: colors.muted }}
                          >
                            Use only a public address to monitor
                          </Text>
                        </View>
                      </View>

                      <View
                        className="flex-row items-center gap-3.5 rounded-2xl border bg-white p-3.5"
                        style={{ borderColor: colors.line, ...shadows.subtle }}
                      >
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#FAF5E6]">
                          <CategoryGlyph name="agents" size={18} />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-[14px] font-bold"
                            style={{ color: colors.ink }}
                          >
                            Action agents
                          </Text>
                          <Text
                            className="text-[12px]"
                            style={{ color: colors.muted }}
                          >
                            Show availability and permissions before any signature
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Notice Callout */}
                    <View
                      className="mt-3.5 flex-row items-center gap-2 rounded-xl bg-[#F5F3EB] p-2.5"
                    >
                      <CategoryGlyph color={colors.muted} name="info" size={15} />
                      <Text
                        className="flex-1 text-[11px] font-medium"
                        style={{ color: colors.inkSecondary }}
                      >
                        Mobile action authorization is not connected yet. Dolphin never
                        asks for a private key.
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* SLIDE 4: Find the right agent */}
              {index === 3 ? (
                <View className="flex-1 justify-between pt-2">
                  <View>
                    <View className="mb-1 self-start">
                      <Text
                        className="text-[11px] font-bold uppercase tracking-[1.5px]"
                        style={{ color: colors.goldDark }}
                      >
                        STEP 4 OF 4
                      </Text>
                    </View>
                    <Text
                      className="text-[28px] font-extrabold tracking-[-0.8px]"
                      style={{ color: colors.ink }}
                    >
                      Find the right agent
                    </Text>
                    <Text
                      className="mt-2 text-[14px] leading-5"
                      style={{ color: colors.muted }}
                    >
                      Browse registry identities, review available evidence, and save a
                      local setup preview—without submitting a transaction.
                    </Text>

                    {/* Hub categories grid */}
                    <View className="mt-6 gap-3">
                      <View className="flex-row gap-3">
                        <View
                          className="flex-1 items-center justify-center rounded-2xl border bg-white p-4"
                          style={{ borderColor: colors.line, ...shadows.subtle }}
                        >
                          <CategoryGlyph name="monitoring" size={24} />
                          <Text className="mt-2 text-[13px] font-bold" style={{ color: colors.ink }}>
                            Monitoring
                          </Text>
                        </View>
                        <View
                          className="flex-1 items-center justify-center rounded-2xl border bg-white p-4"
                          style={{ borderColor: colors.line, ...shadows.subtle }}
                        >
                          <CategoryGlyph name="grid-trading" size={24} />
                          <Text className="mt-2 text-[13px] font-bold" style={{ color: colors.ink }}>
                            Grid Trading
                          </Text>
                        </View>
                      </View>

                      <View className="flex-row gap-3">
                        <View
                          className="flex-1 items-center justify-center rounded-2xl border bg-white p-4"
                          style={{ borderColor: colors.line, ...shadows.subtle }}
                        >
                          <CategoryGlyph name="health-factor" size={24} />
                          <Text className="mt-2 text-[13px] font-bold" style={{ color: colors.ink }}>
                            Health Factor
                          </Text>
                        </View>
                        <View
                          className="flex-1 items-center justify-center rounded-2xl border bg-white p-4"
                          style={{ borderColor: colors.line, ...shadows.subtle }}
                        >
                          <CategoryGlyph name="yield" size={24} />
                          <Text className="mt-2 text-[13px] font-bold" style={{ color: colors.ink }}>
                            Yield
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          )}
        />

        {/* Bottom Controls */}
        <View className="px-6 pb-8 pt-2">
          {/* Stepper Indicators */}
          <View className="mb-5 flex-row items-center justify-center gap-2">
            {[0, 1, 2, 3].map((step) => (
              <View
                key={step}
                className="items-center justify-center"
                style={{
                  height: 18,
                  width: step === currentIndex ? 24 : 18,
                }}
              >
                {step < currentIndex ? (
                  <CategoryGlyph name="check" size={16} />
                ) : (
                  <View
                    className={`rounded-full transition-all ${
                      step === currentIndex
                        ? "h-2.5 w-6 bg-[#F5B300]"
                        : "h-2 w-2 bg-[#DCD8CD]"
                    }`}
                  />
                )}
              </View>
            ))}
          </View>

          {/* Primary Action CTA */}
          <Button
            iconRight={
              <CategoryGlyph
                color={colors.ink}
                name="arrow-right"
                size={16}
                strokeWidth={2.5}
              />
            }
            label={currentIndex === 3 ? "Start discovering" : "Continue"}
            onPress={handleNext}
            size="large"
            variant="gold"
          />

          {/* Secondary Back action if not on slide 0 */}
          {currentIndex > 0 ? (
            <View className="mt-2.5 items-center">
              <PressableScale
                accessibilityLabel="Go back"
                accessibilityRole="button"
                onPress={handleBack}
                containerStyle={{ padding: 6 }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={{ color: colors.muted }}
                >
                  Back
                </Text>
              </PressableScale>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
