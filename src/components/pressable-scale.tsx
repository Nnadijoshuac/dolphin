import type { PropsWithChildren } from "react";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

type PressableScaleProps = PropsWithChildren<
  PressableProps & {
    containerStyle?: StyleProp<ViewStyle>;
    pressedScale?: number;
    className?: string;
  }
>;

export function PressableScale({
  children,
  containerStyle,
  style,
  className,
  onPressIn,
  onPressOut,
  pressedScale = 0.98,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      {...props}
      className={className}
      style={style}
      onPressIn={(event) => {
        scale.value = withSpring(pressedScale, { damping: 18, stiffness: 260 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { damping: 18, stiffness: 260 });
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[containerStyle, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}


