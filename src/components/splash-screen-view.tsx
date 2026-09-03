import { useEffect, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark, BnbBadge } from "@/components/brand-mark";
import { ConstellationBg } from "@/components/constellation-bg";
import { colors } from "@/constants/theme";

const splashImage = require("../../assets/images/SplashScreen.jpeg");

type SplashScreenViewProps = {
  onFinish?: () => void;
  durationMs?: number;
};

export function SplashScreenView({
  onFinish,
  durationMs = 2200,
}: SplashScreenViewProps) {
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth || 390, 480);
  // Lazy useState rather than useRef(...).current: reading a ref during render
  // is react-hooks/refs under eslint-plugin-react-hooks 7 (SDK 57). The lazy
  // initialiser is also strictly less wasteful - useRef(new Animated.Value(1))
  // constructed a fresh Animated.Value on every render and discarded it.
  const [fadeAnim] = useState(() => new Animated.Value(1));
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }).start(() => {
        setIsVisible(false);
        onFinish?.();
      });
    }, durationMs);

    return () => clearTimeout(timer);
  }, [durationMs, fadeAnim, onFinish]);

  if (!isVisible) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={fadeAnim ? "auto" : "none"}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.canvas,
          zIndex: 99999,
          opacity: fadeAnim,
        },
      ]}
    >
      <SafeAreaView
        className="flex-1 items-center justify-between"
        style={{ backgroundColor: colors.canvas }}
      >
        <ConstellationBg opacity={0.35} />

        <View
          className="flex-1 justify-between px-6 pt-4 pb-12"
          style={{ maxWidth: "100%", width: contentWidth }}
        >
          {/* Top Brand Header */}
          <View className="items-center pt-2">
            <BrandMark size={36} />
            <Text
              className="mt-2 text-[16px] font-black uppercase tracking-[2px]"
              style={{ color: colors.ink }}
            >
              DOLPHIN
            </Text>
            <Text
              className="mt-0.5 text-[9px] font-bold uppercase tracking-[1.2px]"
              style={{ color: colors.muted }}
            >
              ERC-8004 AI AGENT MARKETPLACE
            </Text>
            <View className="mt-2">
              <BnbBadge label="BNB SMART CHAIN" />
            </View>
          </View>

          {/* Center Graphic */}
          <View className="my-auto flex-1 items-center justify-center py-2">
            <Image
              cachePolicy="memory-disk"
              contentFit="contain"
              priority="high"
              source={splashImage}
              style={{
                height: "100%",
                maxHeight: 380,
                width: "100%",
              }}
            />
          </View>

          {/* Bottom Headline & Subtitle (Without continue button) */}
          <View className="px-2 pb-6">
            <Text
              className="text-[32px] font-extrabold tracking-[-1px] leading-[38px]"
              style={{ color: colors.ink }}
            >
              AI agents,{"\n"}made understandable
            </Text>
            <Text
              className="mt-3 text-[15px] font-normal leading-6"
              style={{ color: colors.muted }}
            >
              Discover onchain helpers that watch, protect, trade, and find
              yield.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}
