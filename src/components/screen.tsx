import type { PropsWithChildren, ReactNode } from "react";
import type { ScrollViewProps, StyleProp, ViewStyle } from "react-native";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ScrollViewProps["refreshControl"];
  footer?: ReactNode;
  edges?: ("top" | "right" | "bottom" | "left")[];
}>;

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
  refreshControl,
  footer,
  edges = ["top", "left", "right"],
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.canvas }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            { paddingHorizontal: 20, paddingBottom: footer ? 150 : 116 },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          <View className="mx-auto w-full max-w-[760px]">{children}</View>
        </ScrollView>
      ) : (
        <View className="mx-auto w-full max-w-[760px] flex-1 px-5">{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

