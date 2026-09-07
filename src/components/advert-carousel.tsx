import { Image } from "expo-image";
import React from "react";
import { View, Text, ScrollView, useWindowDimensions, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { PressableScale } from "./pressable-scale";
import type { Agent } from "@/types/agent";

interface AdvertProps {
  onPress: () => void;
  imageSource: any;
  title: string;
  subtitle: string;
  categoryLabel: string;
}

const AdvertCard = ({ onPress, imageSource, title, subtitle, categoryLabel }: AdvertProps) => {
  const { width } = useWindowDimensions();
  const cardWidth = width * 0.9;

  return (
    <View style={{ width: cardWidth, paddingLeft: 16 }}>
      <PressableScale
        onPress={onPress}
        containerStyle={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.04)",
          height: 180,
          backgroundColor: "#F5F5F5",
        }}
      >
        <Image
          source={imageSource}
          style={{ width: "100%", height: "100%", position: "absolute" }}
          contentFit="cover"
        />
        {/* Gradient Overlay for Text Readability */}
        <View
          style={{
            ...StyleSheet.absoluteFill,
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        />

        <View className="flex-1 p-4 justify-end">
          <Text className="text-[11px] font-bold text-white/80 uppercase tracking-wider mb-1">
            {categoryLabel}
          </Text>
          <Text className="text-[20px] font-black text-white leading-[24px] tracking-tight mb-1">
            {title}
          </Text>
          <Text className="text-[12px] text-white/90 leading-[16px] max-w-[85%]">
            {subtitle}
          </Text>
        </View>
      </PressableScale>
    </View>
  );
};

interface AdvertCarouselProps {
  agents: Agent[];
  onAgentPress: (agent: Agent) => void;
}

const promoImages = {
  brainOnBnb: require("../../assets/images/promos/health.jpg"),
  rebalancing: require("../../assets/images/promos/rebalancing.jpg"),
  yield: require("../../assets/images/promos/yield.jpg"),
  security: require("../../assets/images/promos/security.jpg"),
};

export const AdvertCarousel = ({ agents, onAgentPress }: AdvertCarouselProps) => {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = width * 0.9;

  const promos = [
    {
      id: "promo-brain-on-bnb",
      imageSource: promoImages.brainOnBnb,
      title: "Brain on BNB",
      subtitle: "Venus Health Factor Monitor: 24/7 liquidation protection.",
      categoryLabel: "Featured Agent",
      targetCategory: "health-factor",
      targetTokenId: "302257",
    },
    {
      id: "promo-rebalancing",
      imageSource: promoImages.rebalancing,
      title: "Automate LP Management",
      subtitle: "Agents that reset your liquidity range 24/7.",
      categoryLabel: "Featured Collection",
      targetCategory: "rebalancing",
    },
    {
      id: "promo-yield",
      imageSource: promoImages.yield,
      title: "Maximize Staking Yields",
      subtitle: "Discover the most profitable vault strategies.",
      categoryLabel: "Top Yield Agents",
      targetCategory: "yield",
    },
    {
      id: "promo-security",
      imageSource: promoImages.security,
      title: "Never Get Liquidated",
      subtitle: "Health factor monitors that act before it's too late.",
      categoryLabel: "Essential Security",
      targetCategory: "health-factor",
    },
  ];

  return (
    <View className="py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        contentContainerStyle={{ paddingRight: 16 }}
      >
        {promos.map((promo) => {
          const targetAgent = agents.find(
            (a) =>
              (promo.targetTokenId && a.tokenId === promo.targetTokenId) ||
              a.category === promo.targetCategory
          );

          const handlePress = () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (targetAgent) {
              onAgentPress(targetAgent);
            } else if (promo.targetTokenId) {
              router.push({
                pathname: "/agent/[id]",
                params: { id: promo.targetTokenId },
              });
            } else if (promo.targetCategory) {
              router.push({
                pathname: "/category/[slug]",
                params: { slug: promo.targetCategory },
              });
            }
          };

          return (
            <AdvertCard
              key={promo.id}
              onPress={handlePress}
              imageSource={promo.imageSource}
              title={promo.title}
              subtitle={promo.subtitle}
              categoryLabel={promo.categoryLabel}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};
